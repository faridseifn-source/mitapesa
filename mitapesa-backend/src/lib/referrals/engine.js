const prisma = require("../prisma");
const { getSetting } = require("../settings");
const { writeAudit } = require("../audit");
const { generateCode, normalizeCode, hashValue, isUniqueViolation, num, addDays } = require("./util");
const { evaluateReferral } = require("./fraud");
const { sendReferralNotice } = require("./messages");
const ai = require("./aiCredits");

const DEAD_ENT = ["cancelled", "capped", "failed", "expired"]; // entitlements that do not count toward caps/budget

async function referralsEnabled() {
  return (await getSetting("referral_enabled")) !== "false";
}

// ── Ledger (append-only) ───────────────────────────────────────────────
async function ledger(ent, type, { actor = "system", note = null, amountTzs = null } = {}) {
  await prisma.rewardTransaction.create({ data: { entitlementId: ent.id, userId: ent.userId, type, actor, note, amountTzs } });
}

// Guarded status change: succeeds only if the row is still in one of the
// expected states, so two workers (or a double click) can't both win.
async function transition(id, from, to, data = {}) {
  const res = await prisma.rewardEntitlement.updateMany({ where: { id, status: { in: from } }, data: { status: to, ...data } });
  return res.count === 1;
}

// ── Campaign / codes ───────────────────────────────────────────────────
async function getActiveCampaign(now = new Date()) {
  const rows = await prisma.referralCampaign.findMany({ where: { status: "active" }, orderBy: { createdAt: "desc" } });
  return rows.find((c) => (!c.startsAt || new Date(c.startsAt) <= now) && (!c.endsAt || new Date(c.endsAt) >= now)) || null;
}

async function getOrCreateCode(userId) {
  const existing = await prisma.referralCode.findUnique({ where: { userId } });
  if (existing) return existing;
  for (let i = 0; i < 6; i++) {
    try {
      return await prisma.referralCode.create({ data: { userId, code: generateCode() } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const again = await prisma.referralCode.findUnique({ where: { userId } });
      if (again) return again; // a concurrent request created it
    }
  }
  throw new Error("Could not allocate a referral code");
}

async function inviteLink(code) {
  const base = (await getSetting("referral_landing_url")) || "";
  if (!base) return null;
  return `${base}${base.includes("?") ? "&" : "?"}ref=${code}`;
}

async function recordDevice(userId, deviceId, ip) {
  const deviceHash = hashValue(deviceId);
  if (!deviceHash) return;
  try {
    await prisma.referralDevice.create({ data: { userId, deviceHash, ipHash: hashValue(ip) } });
  } catch (err) {
    if (!isUniqueViolation(err)) console.error("recordDevice failed:", err.message); // eslint-disable-line no-console
  }
}

const shortName = (u) => `${u.firstName}${u.lastName ? ` ${String(u.lastName).charAt(0)}.` : ""}`;

// ── Attribution ────────────────────────────────────────────────────────
/**
 * Called once at registration. Never throws into the signup: a bad or
 * missing code simply means the customer joins without a referral.
 */
async function attributeSignup({ referredUser, code, deviceId, ip }) {
  try {
    await recordDevice(referredUser.id, deviceId, ip);
    const clean = normalizeCode(code);
    if (!clean || !(await referralsEnabled())) return { attributed: false, reason: "none" };

    const codeRow = await prisma.referralCode.findUnique({ where: { code: clean } });
    if (!codeRow || !codeRow.active) return { attributed: false, reason: "invalid_code" };
    if (codeRow.userId === referredUser.id) return { attributed: false, reason: "self" };

    const referrer = await prisma.user.findUnique({ where: { id: codeRow.userId } });
    if (!referrer || referrer.deletedAt) return { attributed: false, reason: "invalid_code" };

    const campaign = await getActiveCampaign();
    if (!campaign) return { attributed: false, reason: "no_campaign" };

    if (campaign.maxReferralsPerReferrer > 0) {
      const mine = await prisma.referral.findMany({ where: { referrerUserId: referrer.id, campaignId: campaign.id } });
      if (mine.filter((r) => r.status !== "rejected").length >= campaign.maxReferralsPerReferrer) {
        return { attributed: false, reason: "referrer_limit" };
      }
    }

    let referral;
    try {
      referral = await prisma.referral.create({
        data: {
          campaignId: campaign.id, referrerUserId: referrer.id, referredUserId: referredUser.id, code: clean,
          deviceHash: hashValue(deviceId), ipHash: hashValue(ip),
          expiresAt: addDays(new Date(), campaign.qualifyWithinDays || 30),
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return { attributed: false, reason: "already_referred" };
      throw err;
    }

    const risk = await evaluateReferral({ referral, referrer, referred: referredUser, stage: "signup" });
    await prisma.riskEvaluation.create({ data: { referralId: referral.id, stage: "signup", score: risk.score, level: risk.level, reasons: risk.reasons } });
    const patch = { riskScore: risk.score, riskLevel: risk.level };
    if (risk.decision === "reject") patch.status = "rejected";
    else if (risk.decision === "hold") patch.status = "under_review";
    referral = await prisma.referral.update({ where: { id: referral.id }, data: patch });

    await writeAudit(referredUser.id, "referral.attributed", { referralId: referral.id, referrerUserId: referrer.id, risk: risk.score, decision: risk.decision });

    if (risk.decision === "reject") {
      await sendReferralNotice(referrer.id, "referral_rejected");
      return { attributed: true, referralId: referral.id, status: "rejected" };
    }
    if (risk.decision === "hold") await sendReferralNotice(referrer.id, "referral_review");
    await sendReferralNotice(referrer.id, "friend_joined", { name: shortName(referredUser) });
    await trackEvent(referredUser.id, "signed_up", referredUser.id);
    return { attributed: true, referralId: referral.id, status: referral.status };
  } catch (err) {
    console.error("Referral attribution failed:", err); // eslint-disable-line no-console
    return { attributed: false, reason: "error" };
  }
}

// ── Events & milestones ────────────────────────────────────────────────
/**
 * The only thing product code calls. Fire-and-forget, idempotent, and a
 * silent no-op for the vast majority of users (anyone who wasn't referred).
 * Only an event NAME and an opaque reference are recorded — no amounts,
 * merchants or balances ever reach this module.
 */
async function trackEvent(userId, eventName, eventRef = "1") {
  try {
    const referral = await prisma.referral.findUnique({ where: { referredUserId: userId } });
    if (!referral || ["rejected", "cancelled", "expired"].includes(referral.status)) return;
    if (!(await referralsEnabled())) return;
    try {
      await prisma.referralEvent.create({ data: { userId, eventName, eventRef: String(eventRef) } });
    } catch (err) {
      if (isUniqueViolation(err)) return; // this exact event was already counted
      throw err;
    }
    await advance(referral, eventName);
  } catch (err) {
    console.error(`Referral event [${eventName}] failed:`, err.message); // eslint-disable-line no-console
  }
}

async function advance(referral, eventName) {
  // A qualified referral keeps tracking: activation steps (first top-up, first
  // payment) can legitimately come after the welcome steps are done.
  if (referral.expiresAt && new Date(referral.expiresAt) < new Date() && referral.status === "pending") {
    await prisma.referral.updateMany({ where: { id: referral.id, status: "pending" }, data: { status: "expired" } });
    return;
  }
  const campaign = await prisma.referralCampaign.findUnique({ where: { id: referral.campaignId } });
  if (!campaign) return;
  const milestones = (await prisma.referralMilestone.findMany({ where: { campaignId: campaign.id, active: true } })).sort((a, b) => a.sequence - b.sequence);
  if (!milestones.some((m) => m.eventName === eventName)) return; // nothing in this campaign listens for it

  const referredUser = await prisma.user.findUnique({ where: { id: referral.referredUserId } });
  const name = referredUser ? shortName(referredUser) : "Your friend";

  for (const m of milestones.filter((x) => x.eventName === eventName)) {
    const events = await prisma.referralEvent.count({ where: { userId: referral.referredUserId, eventName } });
    const progress = Math.min(events, m.threshold);
    await prisma.referralMilestoneProgress.upsert({
      where: { referralId_milestoneId: { referralId: referral.id, milestoneId: m.id } },
      update: { progress },
      create: { referralId: referral.id, milestoneId: m.id, progress },
    });
    if (events >= m.threshold) {
      const won = await prisma.referralMilestoneProgress.updateMany({
        where: { referralId: referral.id, milestoneId: m.id, achievedAt: null },
        data: { achievedAt: new Date() },
      });
      if (won.count === 1 && eventName !== "signed_up") {
        await sendReferralNotice(referral.referrerUserId, "milestone", { name, step: m.titleEn });
      }
    }
  }

  // Grant rewards in order: a milestone's reward is released only once every
  // earlier milestone is also done, so rewards can't be earned out of sequence.
  const progressRows = await prisma.referralMilestoneProgress.findMany({ where: { referralId: referral.id } });
  const achieved = new Set(progressRows.filter((p) => p.achievedAt).map((p) => p.milestoneId));
  let priorDone = true;
  for (const m of milestones) {
    if (!achieved.has(m.id)) { priorDone = false; continue; }
    if (!priorDone) continue;
    const fresh = await prisma.referral.findUnique({ where: { id: referral.id } });
    if (m.referredRewardId) await createEntitlement({ referral: fresh, campaign, milestone: m, recipient: "referred" });
    if (m.referrerRewardId) await createEntitlement({ referral: fresh, campaign, milestone: m, recipient: "referrer" });
  }

  const requiredOpen = milestones.filter((m) => m.required && !achieved.has(m.id));
  if (milestones.length > 0 && requiredOpen.length === 0) {
    const q = await prisma.referral.updateMany({ where: { id: referral.id, status: "pending" }, data: { status: "qualified", qualifiedAt: new Date() } });
    if (q.count === 1) await sendReferralNotice(referral.referrerUserId, "referral_qualified", { name });
  }
}

// ── Entitlements ───────────────────────────────────────────────────────
async function createEntitlement({ referral, campaign, milestone, recipient }) {
  const rewardId = recipient === "referrer" ? milestone.referrerRewardId : milestone.referredRewardId;
  if (!rewardId) return null;
  const key = `${referral.id}:${milestone.id}:${recipient}`;
  const existing = await prisma.rewardEntitlement.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existing;

  const def = await prisma.rewardDefinition.findUnique({ where: { id: rewardId } });
  if (!def || !def.active) return null;
  const userId = recipient === "referrer" ? referral.referrerUserId : referral.referredUserId;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || user.blockedByAdmin) return null;

  // Caps, evaluated at creation. A capped reward is still recorded (so the
  // customer and staff can see it) but is never fulfilled unless an admin
  // releases it.
  let capped = null;
  const live = (await prisma.rewardEntitlement.findMany({ where: { campaignId: campaign.id } })).filter((e) => !DEAD_ENT.includes(e.status));
  if (campaign.maxRewardsTotal > 0 && live.length >= campaign.maxRewardsTotal) capped = "Campaign reward limit reached";
  else if (recipient === "referrer" && campaign.maxRewardsPerReferrer > 0 && live.filter((e) => e.userId === userId && e.recipient === "referrer").length >= campaign.maxRewardsPerReferrer) capped = "Per-referrer reward limit reached";
  else if (campaign.budgetTzs && live.reduce((s, e) => s + num(e.costTzs), 0) + num(def.costTzs) > num(campaign.budgetTzs)) capped = "Campaign budget exhausted";
  else if (def.stockLimit > 0 && def.issuedCount >= def.stockLimit) capped = "Reward out of stock";

  const matures = recipient === "referrer" && milestone.maturityDays > 0 ? addDays(new Date(), milestone.maturityDays) : null;
  let status = capped ? "capped" : referral.status === "under_review" ? "under_review" : matures ? "pending_maturity" : "available";
  if (referral.status === "rejected" || referral.status === "cancelled") return null;

  let ent;
  try {
    ent = await prisma.rewardEntitlement.create({
      data: {
        idempotencyKey: key, userId, recipient, campaignId: campaign.id, referralId: referral.id, milestoneId: milestone.id,
        rewardDefinitionId: def.id, status, valueTzs: def.valueTzs, costTzs: def.costTzs, maturesAt: matures,
        failureReason: capped,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return prisma.rewardEntitlement.findUnique({ where: { idempotencyKey: key } });
    throw err;
  }
  await ledger(ent, "created", { note: capped || `Milestone: ${milestone.titleEn}`, amountTzs: def.valueTzs });
  if (capped) return ent;
  await prisma.rewardDefinition.update({ where: { id: def.id }, data: { issuedCount: { increment: 1 } } });
  if (status === "available") await makeAvailable(ent.id);
  return ent;
}

const rewardName = (def, lang) => (lang === "sw" ? def.nameSw : def.nameEn);

/** Moves an entitlement out of its waiting state: auto rewards are fulfilled on the spot, manual ones join the queue. */
async function makeAvailable(entitlementId, actor = "system") {
  const ent = await prisma.rewardEntitlement.findUnique({ where: { id: entitlementId } });
  if (!ent) return;
  const def = await prisma.rewardDefinition.findUnique({ where: { id: ent.rewardDefinitionId } });
  const user = await prisma.user.findUnique({ where: { id: ent.userId }, select: { language: true } });
  const lang = user && user.language === "sw" ? "sw" : "en";
  const name = def ? rewardName(def, lang) : "Reward";

  if (def && def.fulfilment === "auto" && def.type === "ai_credits") {
    if (!(await transition(ent.id, ["pending_maturity", "available", "under_review"], "fulfilled", { fulfilledAt: new Date() }))) return;
    await ledger(ent, "matured", { actor });
    await ai.grantAiCredit({ userId: ent.userId, entitlementId: ent.id, feature: def.aiFeature || "all", credits: def.aiCredits, validDays: def.aiValidDays });
    await ledger(ent, "ai_credit_granted", { actor, note: `${def.aiCredits} credits (${def.aiFeature || "all"})` });
    await ledger(ent, "fulfilled", { actor });
    await sendReferralNotice(ent.userId, "reward_ai_credits", { reward: name });
    return;
  }
  if (def && def.fulfilment === "auto" && def.type === "fee_waiver") {
    // The waiver is a FeeExemption, which the fee engine already honours. It
    // only STARTS once Pay is live — before that it waits (status "available"),
    // so a customer never burns a 30-day waiver while there are no fees.
    if ((await getSetting("pay_module_enabled")) === "false") {
      await transition(ent.id, ["pending_maturity", "under_review"], "available");
      const history = await prisma.rewardTransaction.findMany({ where: { entitlementId: ent.id } });
      if (!history.some((h) => h.type === "matured")) { // first time only — the hourly job re-enters here
        await ledger(ent, "matured", { actor });
        await ledger(ent, "held", { actor, note: "Fee waiver is ready and will start when Pay launches" });
        await sendReferralNotice(ent.userId, "reward_waiver_ready", { reward: name });
      }
      return;
    }
    if (!(await transition(ent.id, ["pending_maturity", "available", "under_review"], "fulfilled", { fulfilledAt: new Date() }))) return;
    const start = new Date();
    const end = addDays(start, def.waiverDays || 30);
    const exemption = await prisma.feeExemption.create({
      data: { userId: ent.userId, transactionTypeId: def.waiverTransactionTypeId || null, reason: "Referral reward", approvedByUserId: "system:referral", startDate: start, endDate: end },
    });
    await prisma.rewardEntitlement.update({ where: { id: ent.id }, data: { exemptionId: exemption.id, expiresAt: end } });
    await ledger(ent, "matured", { actor });
    await ledger(ent, "fulfilled", { actor, note: `Fee waiver until ${end.toISOString().slice(0, 10)}` });
    await sendReferralNotice(ent.userId, "reward_waiver_active", { reward: name, until: end.toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-GB") });
    return;
  }
  if (!(await transition(ent.id, ["pending_maturity", "available", "under_review"], "queued"))) return;
  await ledger(ent, "matured", { actor });
  await ledger(ent, "queued", { actor });
  await sendReferralNotice(ent.userId, "reward_available", { reward: name });
}

/** Periodic job: releases matured rewards after a second fraud look, expires old AI credits. */
async function processMaturity() {
  const now = new Date();
  const out = { released: 0, held: 0, cancelled: 0, expiredCredits: 0 };
  if (await referralsEnabled()) {
    const due = (await prisma.rewardEntitlement.findMany({ where: { status: "pending_maturity" } }))
      .filter((e) => e.maturesAt && new Date(e.maturesAt) <= now).slice(0, 200);
    for (const ent of due) {
      try {
        const referral = await prisma.referral.findUnique({ where: { id: ent.referralId } });
        if (!referral || ["rejected", "cancelled"].includes(referral.status)) {
          await cancelEntitlement(ent.id, "system", "Referral no longer eligible"); out.cancelled++; continue;
        }
        if (referral.status === "under_review") { await transition(ent.id, ["pending_maturity"], "under_review"); out.held++; continue; }
        const [referrer, referred] = await Promise.all([
          prisma.user.findUnique({ where: { id: referral.referrerUserId } }),
          prisma.user.findUnique({ where: { id: referral.referredUserId } }),
        ]);
        if (!referrer || referrer.deletedAt || referrer.blockedByAdmin) { await cancelEntitlement(ent.id, "system", "Referrer account unavailable"); out.cancelled++; continue; }
        const risk = await evaluateReferral({ referral, referrer, referred, stage: "maturity" });
        await prisma.riskEvaluation.create({ data: { referralId: referral.id, stage: "maturity", score: risk.score, level: risk.level, reasons: risk.reasons } });
        await prisma.referral.update({ where: { id: referral.id }, data: { riskScore: Math.max(referral.riskScore, risk.score), riskLevel: risk.level === "high" ? "high" : referral.riskLevel } });
        if (risk.decision === "reject") { await setReferralStatus(referral.id, "rejected", "system", "Automatic: " + risk.reasons.map((r) => r.reason).join("; ")); out.cancelled++; continue; }
        if (risk.decision === "hold") { await setReferralStatus(referral.id, "under_review", "system", risk.reasons.map((r) => r.reason).join("; ")); out.held++; continue; }
        await makeAvailable(ent.id);
        out.released++;
      } catch (err) {
        console.error("Reward maturity failed for", ent.id, err.message); // eslint-disable-line no-console
      }
    }
  }
  // Fee waivers that were waiting for Pay to launch start as soon as it is on.
  if ((await referralsEnabled()) && (await getSetting("pay_module_enabled")) !== "false") {
    const waiting = await prisma.rewardEntitlement.findMany({ where: { status: "available" } });
    for (const ent of waiting) {
      const def = await prisma.rewardDefinition.findUnique({ where: { id: ent.rewardDefinitionId } });
      if (def && def.type === "fee_waiver") { await makeAvailable(ent.id); out.released++; }
    }
  }
  out.expiredCredits = await ai.expireCredits();
  return out;
}

async function cancelEntitlement(id, actor, note) {
  const ent = await prisma.rewardEntitlement.findUnique({ where: { id } });
  if (!ent) return false;
  const ok = await transition(id, ["pending_maturity", "available", "queued", "under_review", "capped", "failed"], "cancelled", { failureReason: note || null });
  if (!ok) return false;
  await ledger(ent, "cancelled", { actor, note });
  return true;
}

// A delivered reward that has to be taken back (fraud, closed account): AI
// credits are closed, a fee waiver's exemption is switched off. Past usage is
// never reversed — only what has not been used yet.
async function clawBack(ent) {
  await ai.cancelCreditForEntitlement(ent.id);
  if (ent.exemptionId) await prisma.feeExemption.updateMany({ where: { id: ent.exemptionId, isActive: true }, data: { isActive: false } });
}

// ── Fulfilment (manual rewards) ────────────────────────────────────────
async function markFulfilled(id, { externalRef, actor = "system", batchId } = {}) {
  const ent = await prisma.rewardEntitlement.findUnique({ where: { id } });
  if (!ent) return { ok: false, reason: "not_found" };
  const def = await prisma.rewardDefinition.findUnique({ where: { id: ent.rewardDefinitionId } });
  const expiresAt = def && def.validityDays > 0 ? addDays(new Date(), def.validityDays) : null;
  const ok = await transition(id, ["queued", "failed", "available"], "fulfilled", { externalRef: externalRef || null, fulfilledAt: new Date(), failureReason: null, expiresAt, ...(batchId ? { fulfilmentBatchId: batchId } : {}) });
  if (!ok) return { ok: false, reason: "wrong_status", status: ent.status };
  await ledger(ent, "fulfilled", { actor, note: externalRef ? `Ref ${externalRef}` : null });
  const user = await prisma.user.findUnique({ where: { id: ent.userId }, select: { language: true } });
  await sendReferralNotice(ent.userId, "reward_fulfilled", { reward: def ? rewardName(def, user && user.language) : "Reward", ref: externalRef });
  return { ok: true };
}

async function markFailed(id, reason, actor = "system") {
  const ent = await prisma.rewardEntitlement.findUnique({ where: { id } });
  if (!ent) return { ok: false, reason: "not_found" };
  const ok = await transition(id, ["queued", "available"], "failed", { failureReason: reason || "Delivery failed" });
  if (!ok) return { ok: false, reason: "wrong_status", status: ent.status };
  await ledger(ent, "failed", { actor, note: reason });
  const def = await prisma.rewardDefinition.findUnique({ where: { id: ent.rewardDefinitionId } });
  const user = await prisma.user.findUnique({ where: { id: ent.userId }, select: { language: true } });
  await sendReferralNotice(ent.userId, "reward_failed", { reward: def ? rewardName(def, user && user.language) : "Reward" });
  return { ok: true };
}

async function requeue(id, actor) {
  const ent = await prisma.rewardEntitlement.findUnique({ where: { id } });
  if (!ent) return { ok: false, reason: "not_found" };
  const ok = await transition(id, ["failed", "capped"], "queued", { failureReason: null, fulfilmentBatchId: null });
  if (!ok) return { ok: false, reason: "wrong_status", status: ent.status };
  await ledger(ent, "released", { actor, note: "Returned to the fulfilment queue" });
  return { ok: true };
}

// ── Referral review ────────────────────────────────────────────────────
async function setReferralStatus(referralId, status, actor, note) {
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!referral) return null;
  const wasQualified = Boolean(referral.qualifiedAt);
  const target = status === "approved" ? (wasQualified ? "qualified" : "pending") : status;
  await prisma.referral.update({
    where: { id: referralId },
    data: {
      status: target, reviewNote: note || null,
      reviewedByUserId: actor && actor.startsWith("admin:") ? actor.slice(6) : null, reviewedAt: new Date(),
      ...(status === "rejected" ? {} : {}),
    },
  });
  const ents = await prisma.rewardEntitlement.findMany({ where: { referralId } });
  if (target === "rejected" || target === "cancelled") {
    for (const e of ents) {
      if (["pending_maturity", "available", "queued", "under_review", "capped"].includes(e.status)) await cancelEntitlement(e.id, actor, note || "Referral rejected");
      else if (e.status === "fulfilled") await clawBack(e);
    }
    if (actor === "system" || status === "rejected") await sendReferralNotice(referral.referrerUserId, "referral_rejected");
  } else if (target === "under_review") {
    for (const e of ents) if (["pending_maturity", "available"].includes(e.status)) { if (await transition(e.id, [e.status], "under_review")) await ledger(e, "held", { actor, note }); }
  } else {
    // approved / reinstated
    for (const e of ents) {
      if (e.status === "under_review") {
        const due = !e.maturesAt || new Date(e.maturesAt) <= new Date();
        if (due) { await makeAvailable(e.id, actor); }
        else if (await transition(e.id, ["under_review"], "pending_maturity")) await ledger(e, "released", { actor, note });
      }
    }
  }
  return prisma.referral.findUnique({ where: { id: referralId } });
}

// Account deletion: nothing owed to, or because of, a deleted account.
async function onAccountDeleted(userId) {
  try {
    const mine = await prisma.rewardEntitlement.findMany({ where: { userId } });
    for (const e of mine) {
      if (["pending_maturity", "available", "queued", "under_review", "capped"].includes(e.status)) await cancelEntitlement(e.id, "system", "Account closed");
      else if (e.status === "fulfilled") await clawBack(e);
    }
    await prisma.referralCode.updateMany({ where: { userId }, data: { active: false } });
    const asReferred = await prisma.referral.findUnique({ where: { referredUserId: userId } });
    if (asReferred && !["qualified", "rejected"].includes(asReferred.status)) await setReferralStatus(asReferred.id, "cancelled", "system", "Referred account closed");
  } catch (err) {
    console.error("Referral cleanup on account deletion failed:", err.message); // eslint-disable-line no-console
  }
}

module.exports = {
  referralsEnabled, getActiveCampaign, getOrCreateCode, inviteLink, recordDevice, attributeSignup,
  trackEvent, createEntitlement, makeAvailable, processMaturity, cancelEntitlement, markFulfilled, markFailed, requeue,
  setReferralStatus, onAccountDeleted, shortName, ledger,
};
