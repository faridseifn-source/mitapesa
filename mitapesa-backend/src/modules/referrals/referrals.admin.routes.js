const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { requireAdmin, requireAdminRole } = require("../../middleware/admin");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, badRequest } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");
const { csvRow, sendCsv } = require("../../lib/csv");
const { roleAtLeast } = require("../../lib/adminRoles");
const R = require("../../lib/referrals");
const { parseCsv } = require("../../lib/referrals/csvParse");
const { loadRuleConfig } = require("../../lib/referrals/fraud");

/**
 * Admin side of Referral & Rewards, mounted at /admin/referrals.
 * Tiers: viewer = read-only (names shortened, no contact details);
 * support = review referrals, run fulfilment, resolve appeals;
 * super = campaigns, rewards, partners, fraud rules.
 */
const router = Router();
router.use(requireAuth, requireAdmin);
const support = requireAdminRole("admin_support");
const superOnly = requireAdminRole("admin_super");

const actorOf = (req) => `admin:${req.userId}`;
const decimalLike = z.coerce.number().min(0);
const isoOrNull = z.union([z.string().datetime({ offset: true }), z.string().length(0), z.null()]).optional().transform((v) => (v ? new Date(v) : v === undefined ? undefined : null));

async function nameOf(req, userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, phone: true, email: true, deletedAt: true } });
  if (!u) return { name: "—" };
  if (u.deletedAt) return { name: "(closed account)" };
  const full = roleAtLeast(req.adminRole, "admin_support");
  return { name: full ? `${u.firstName} ${u.lastName}` : R.shortName(u), phone: full ? u.phone : undefined, email: full ? u.email : undefined };
}

// ── Dashboard ──────────────────────────────────────────────────────────
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const campaignId = req.query.campaignId ? String(req.query.campaignId) : null;
    const only = (rows) => (campaignId ? rows.filter((r) => r.campaignId === campaignId) : rows);
    const referrals = only(await prisma.referral.findMany({}));
    const ents = only(await prisma.rewardEntitlement.findMany({}));
    const clicks = await prisma.referralClick.count({});
    const codes = await prisma.referralCode.count({});
    const appeals = await prisma.referralAppeal.findMany({ where: { status: "open" } });
    const credits = await prisma.aiRewardCredit.findMany({});

    const count = (arr, fn) => arr.filter(fn).length;
    const qualified = count(referrals, (r) => r.status === "qualified");
    const live = ents.filter((e) => !["cancelled", "capped", "failed", "expired"].includes(e.status));
    const cost = live.reduce((s, e) => s + Number(e.costTzs || 0), 0);

    const byReferrer = {};
    for (const r of referrals) {
      const a = (byReferrer[r.referrerUserId] ||= { userId: r.referrerUserId, joined: 0, qualified: 0, flagged: 0 });
      a.joined++;
      if (r.status === "qualified") a.qualified++;
      if (r.riskLevel === "high" || ["under_review", "rejected"].includes(r.status)) a.flagged++;
    }
    const top = Object.values(byReferrer).sort((a, b) => b.qualified - a.qualified || b.joined - a.joined).slice(0, 10);
    for (const t of top) t.referrer = (await nameOf(req, t.userId)).name;

    const campaigns = await prisma.referralCampaign.findMany({ orderBy: { createdAt: "desc" } });
    res.json({
      kpis: {
        clicks, codesCreated: codes, signups: referrals.length, qualified,
        conversionRate: referrals.length ? Math.round((qualified / referrals.length) * 1000) / 10 : 0,
        pending: count(referrals, (r) => r.status === "pending"),
        underReview: count(referrals, (r) => r.status === "under_review"),
        rejected: count(referrals, (r) => r.status === "rejected"),
        fraudFlagged: count(referrals, (r) => r.riskLevel === "high"),
        rewardsCreated: live.length,
        rewardsFulfilled: count(ents, (e) => e.status === "fulfilled"),
        rewardsQueued: count(ents, (e) => e.status === "queued"),
        rewardsWaiting: count(ents, (e) => ["pending_maturity", "under_review"].includes(e.status)),
        rewardsFailed: count(ents, (e) => e.status === "failed"),
        rewardCostTzs: cost,
        costPerQualifiedTzs: qualified ? Math.round(cost / qualified) : 0,
        openAppeals: appeals.length,
        aiCreditsGranted: credits.reduce((s, c) => s + c.creditsGranted, 0),
        aiCreditsUsed: credits.reduce((s, c) => s + c.creditsUsed, 0),
      },
      topReferrers: top,
      campaigns: campaigns.map((c) => ({ id: c.id, nameEn: c.nameEn, status: c.status })),
    });
  })
);

// ── Campaigns ──────────────────────────────────────────────────────────
const campaignSchema = z.object({
  slug: z.string().trim().min(3).max(60).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers and dashes only"),
  nameEn: z.string().trim().min(2), nameSw: z.string().trim().min(2),
  descriptionEn: z.string().default(""), descriptionSw: z.string().default(""),
  termsEn: z.string().default(""), termsSw: z.string().default(""),
  startsAt: isoOrNull, endsAt: isoOrNull,
  maxReferralsPerReferrer: z.coerce.number().int().min(0).default(0),
  maxRewardsPerReferrer: z.coerce.number().int().min(0).default(0),
  maxRewardsTotal: z.coerce.number().int().min(0).default(0),
  budgetTzs: z.union([decimalLike, z.null()]).optional(),
  qualifyWithinDays: z.coerce.number().int().min(1).max(365).default(30),
});

router.get(
  "/campaigns",
  asyncHandler(async (req, res) => {
    const campaigns = await prisma.referralCampaign.findMany({ orderBy: { createdAt: "desc" } });
    const out = [];
    for (const c of campaigns) {
      const milestones = (await prisma.referralMilestone.findMany({ where: { campaignId: c.id } })).sort((a, b) => a.sequence - b.sequence);
      out.push({ ...c, budgetTzs: c.budgetTzs === null ? null : Number(c.budgetTzs), milestones });
    }
    res.json({ campaigns: out });
  })
);

router.post(
  "/campaigns/seed-recommended",
  superOnly,
  asyncHandler(async (req, res) => {
    const r = await R.seedFirstCampaign(req.userId);
    if (r.created) await writeAudit(req.userId, "referral.campaign.seeded", { campaignId: r.campaign.id, ip: req.ip });
    res.json({ created: r.created, campaignId: r.campaign.id });
  })
);

router.post(
  "/campaigns",
  superOnly,
  asyncHandler(async (req, res) => {
    const input = campaignSchema.parse(req.body);
    const exists = await prisma.referralCampaign.findUnique({ where: { slug: input.slug } });
    if (exists) throw badRequest("A campaign with that slug already exists.");
    const campaign = await prisma.referralCampaign.create({ data: { ...input, status: "draft", createdByUserId: req.userId } });
    await writeAudit(req.userId, "referral.campaign.created", { campaignId: campaign.id, ip: req.ip });
    res.status(201).json({ campaign });
  })
);

router.put(
  "/campaigns/:id",
  superOnly,
  asyncHandler(async (req, res) => {
    const input = campaignSchema.partial().parse(req.body);
    const c = await prisma.referralCampaign.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound("Campaign not found");
    const updated = await prisma.referralCampaign.update({ where: { id: c.id }, data: input });
    await writeAudit(req.userId, "referral.campaign.updated", { campaignId: c.id, fields: Object.keys(input), ip: req.ip });
    res.json({ campaign: updated });
  })
);

router.post(
  "/campaigns/:id/status",
  superOnly,
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(["draft", "active", "paused", "ended"]) }).parse(req.body);
    const c = await prisma.referralCampaign.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound("Campaign not found");
    if (status === "active") {
      const milestones = await prisma.referralMilestone.findMany({ where: { campaignId: c.id, active: true } });
      if (milestones.length === 0) throw badRequest("Add at least one milestone before activating.");
      // One live campaign at a time keeps attribution unambiguous.
      const others = (await prisma.referralCampaign.findMany({ where: { status: "active" } })).filter((o) => o.id !== c.id);
      if (others.length > 0) throw badRequest(`"${others[0].nameEn}" is already active. Pause or end it first.`);
    }
    const updated = await prisma.referralCampaign.update({ where: { id: c.id }, data: { status } });
    await writeAudit(req.userId, "referral.campaign.status", { campaignId: c.id, from: c.status, to: status, ip: req.ip });
    res.json({ campaign: updated });
  })
);

const milestoneSchema = z.object({
  sequence: z.coerce.number().int().min(1).default(1),
  eventName: z.enum(["signed_up", "budget_created", "transaction_logged", "daily_active", "kyc_verified", "topup_completed", "payment_completed"]),
  threshold: z.coerce.number().int().min(1).max(100).default(1),
  titleEn: z.string().trim().min(2), titleSw: z.string().trim().min(2),
  required: z.boolean().default(true),
  referrerRewardId: z.string().nullable().optional(), referredRewardId: z.string().nullable().optional(),
  maturityDays: z.coerce.number().int().min(0).max(90).default(0),
  active: z.boolean().default(true),
});

router.post(
  "/campaigns/:id/milestones",
  superOnly,
  asyncHandler(async (req, res) => {
    const c = await prisma.referralCampaign.findUnique({ where: { id: req.params.id } });
    if (!c) throw notFound("Campaign not found");
    const input = milestoneSchema.parse(req.body);
    const m = await prisma.referralMilestone.create({ data: { ...input, campaignId: c.id } });
    await writeAudit(req.userId, "referral.milestone.created", { campaignId: c.id, milestoneId: m.id, ip: req.ip });
    res.status(201).json({ milestone: m });
  })
);

router.put(
  "/milestones/:id",
  superOnly,
  asyncHandler(async (req, res) => {
    const input = milestoneSchema.partial().parse(req.body);
    const m = await prisma.referralMilestone.findUnique({ where: { id: req.params.id } });
    if (!m) throw notFound("Milestone not found");
    const updated = await prisma.referralMilestone.update({ where: { id: m.id }, data: input });
    await writeAudit(req.userId, "referral.milestone.updated", { milestoneId: m.id, fields: Object.keys(input), ip: req.ip });
    res.json({ milestone: updated });
  })
);

// ── Reward catalogue ───────────────────────────────────────────────────
const rewardSchema = z.object({
  type: z.enum(["ai_credits", "fee_waiver", "airtime", "data_bundle", "voucher", "discount", "cash_bonus", "other"]),
  nameEn: z.string().trim().min(2), nameSw: z.string().trim().min(2),
  descriptionEn: z.string().default(""), descriptionSw: z.string().default(""),
  fulfilment: z.enum(["auto", "manual"]).default("manual"),
  aiFeature: z.enum(["all", "voice", "analytics"]).nullable().optional(),
  aiCredits: z.coerce.number().int().min(0).max(1000).default(0),
  aiValidDays: z.coerce.number().int().min(0).max(730).default(90),
  valueTzs: decimalLike.default(0), costTzs: decimalLike.default(0),
  partnerId: z.string().nullable().optional(),
  validityDays: z.coerce.number().int().min(0).max(730).default(30),
  waiverDays: z.coerce.number().int().min(0).max(730).default(0),
  waiverTransactionTypeId: z.string().nullable().optional(),
  stockLimit: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
}).superRefine((v, ctx) => {
  if (v.fulfilment === "auto" && !["ai_credits", "fee_waiver"].includes(v.type)) ctx.addIssue({ code: "custom", message: "Only AI credits and fee waivers can be fulfilled automatically.", path: ["fulfilment"] });
  if (v.type === "fee_waiver" && (v.fulfilment !== "auto" || v.waiverDays < 1)) ctx.addIssue({ code: "custom", message: "A fee waiver is automatic and needs a number of days.", path: ["waiverDays"] });
  if (v.type === "ai_credits" && v.aiCredits < 1) ctx.addIssue({ code: "custom", message: "Enter how many AI credits to grant.", path: ["aiCredits"] });
});

router.get(
  "/rewards",
  asyncHandler(async (req, res) => {
    const rows = await prisma.rewardDefinition.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ rewards: rows.map((r) => ({ ...r, valueTzs: Number(r.valueTzs), costTzs: Number(r.costTzs) })) });
  })
);
router.post(
  "/rewards",
  superOnly,
  asyncHandler(async (req, res) => {
    const input = rewardSchema.parse(req.body);
    const r = await prisma.rewardDefinition.create({ data: input });
    await writeAudit(req.userId, "referral.reward.created", { rewardId: r.id, ip: req.ip });
    res.status(201).json({ reward: r });
  })
);
router.put(
  "/rewards/:id",
  superOnly,
  asyncHandler(async (req, res) => {
    const existing = await prisma.rewardDefinition.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Reward not found");
    const input = rewardSchema.parse({ ...existing, valueTzs: Number(existing.valueTzs), costTzs: Number(existing.costTzs), ...req.body });
    const r = await prisma.rewardDefinition.update({ where: { id: existing.id }, data: input });
    await writeAudit(req.userId, "referral.reward.updated", { rewardId: r.id, ip: req.ip });
    res.json({ reward: r });
  })
);

// ── Partners ───────────────────────────────────────────────────────────
const partnerSchema = z.object({
  name: z.string().trim().min(2), type: z.enum(["telco", "merchant", "bank", "other"]).default("other"),
  contactName: z.string().nullable().optional(), contactEmail: z.string().nullable().optional(), contactPhone: z.string().nullable().optional(),
  integration: z.enum(["manual", "api"]).default("manual"), notes: z.string().nullable().optional(), active: z.boolean().default(true),
});
router.get("/partners", asyncHandler(async (req, res) => res.json({ partners: await prisma.partner.findMany({ orderBy: { createdAt: "desc" } }) })));
router.post(
  "/partners", superOnly,
  asyncHandler(async (req, res) => {
    const p = await prisma.partner.create({ data: partnerSchema.parse(req.body) });
    await writeAudit(req.userId, "referral.partner.created", { partnerId: p.id, ip: req.ip });
    res.status(201).json({ partner: p });
  })
);
router.put(
  "/partners/:id", superOnly,
  asyncHandler(async (req, res) => {
    const existing = await prisma.partner.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Partner not found");
    const p = await prisma.partner.update({ where: { id: existing.id }, data: partnerSchema.partial().parse(req.body) });
    await writeAudit(req.userId, "referral.partner.updated", { partnerId: p.id, ip: req.ip });
    res.json({ partner: p });
  })
);

// ── Referrals & fraud review ───────────────────────────────────────────
router.get(
  "/referrals",
  asyncHandler(async (req, res) => {
    const { status, risk } = z.object({ status: z.string().optional(), risk: z.string().optional() }).parse(req.query);
    let rows = await prisma.referral.findMany({ orderBy: { createdAt: "desc" } });
    if (status) rows = rows.filter((r) => r.status === status);
    if (risk) rows = rows.filter((r) => r.riskLevel === risk);
    const out = [];
    for (const r of rows.slice(0, 200)) {
      out.push({
        id: r.id, status: r.status, riskScore: r.riskScore, riskLevel: r.riskLevel, createdAt: r.createdAt, qualifiedAt: r.qualifiedAt,
        referrer: (await nameOf(req, r.referrerUserId)).name, referred: (await nameOf(req, r.referredUserId)).name,
      });
    }
    res.json({ referrals: out, total: rows.length });
  })
);

router.get(
  "/referrals/:id",
  asyncHandler(async (req, res) => {
    const r = await prisma.referral.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound("Referral not found");
    const milestones = (await prisma.referralMilestone.findMany({ where: { campaignId: r.campaignId } })).sort((a, b) => a.sequence - b.sequence);
    const progress = await prisma.referralMilestoneProgress.findMany({ where: { referralId: r.id } });
    const evals = (await prisma.riskEvaluation.findMany({ where: { referralId: r.id } })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const ents = await prisma.rewardEntitlement.findMany({ where: { referralId: r.id } });
    const appeals = await prisma.referralAppeal.findMany({ where: { referralId: r.id } });
    if (roleAtLeast(req.adminRole, "admin_support")) await writeAudit(req.userId, "referral.viewed", { referralId: r.id, ip: req.ip });
    res.json({
      referral: { id: r.id, status: r.status, riskScore: r.riskScore, riskLevel: r.riskLevel, reviewNote: r.reviewNote, createdAt: r.createdAt, qualifiedAt: r.qualifiedAt, expiresAt: r.expiresAt, code: r.code },
      referrer: await nameOf(req, r.referrerUserId), referred: await nameOf(req, r.referredUserId),
      steps: milestones.map((m) => { const p = progress.find((x) => x.milestoneId === m.id); return { id: m.id, titleEn: m.titleEn, threshold: m.threshold, progress: p ? p.progress : 0, achievedAt: p ? p.achievedAt : null }; }),
      evaluations: evals, entitlements: ents.map((e) => ({ id: e.id, recipient: e.recipient, status: e.status, valueTzs: Number(e.valueTzs), costTzs: Number(e.costTzs), maturesAt: e.maturesAt })),
      appeals,
    });
  })
);

router.post(
  "/referrals/:id/review",
  support,
  asyncHandler(async (req, res) => {
    const { action, note } = z.object({ action: z.enum(["approve", "reject", "hold"]), note: z.string().trim().min(3, "A note is required").max(500) }).parse(req.body);
    const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "under_review";
    const updated = await R.setReferralStatus(req.params.id, status, actorOf(req), note);
    if (!updated) throw notFound("Referral not found");
    await writeAudit(req.userId, `referral.review.${action}`, { referralId: updated.id, note, ip: req.ip });
    res.json({ referral: updated });
  })
);

// ── Entitlements, ledger, fulfilment ───────────────────────────────────
router.get(
  "/entitlements",
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    let rows = await prisma.rewardEntitlement.findMany({ orderBy: { createdAt: "desc" } });
    if (status) rows = rows.filter((e) => e.status === status);
    const defs = Object.fromEntries((await prisma.rewardDefinition.findMany({})).map((d) => [d.id, d]));
    const out = [];
    for (const e of rows.slice(0, 300)) {
      const who = await nameOf(req, e.userId);
      out.push({
        id: e.id, status: e.status, recipient: e.recipient, reward: defs[e.rewardDefinitionId] ? defs[e.rewardDefinitionId].nameEn : "—",
        type: defs[e.rewardDefinitionId] ? defs[e.rewardDefinitionId].type : "other", valueTzs: Number(e.valueTzs), costTzs: Number(e.costTzs),
        user: who.name, phone: who.phone, maturesAt: e.maturesAt, externalRef: e.externalRef, failureReason: e.failureReason, batchId: e.fulfilmentBatchId, createdAt: e.createdAt,
      });
    }
    res.json({ entitlements: out, total: rows.length });
  })
);

router.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    let rows = await prisma.rewardTransaction.findMany({ orderBy: { createdAt: "desc" } });
    if (req.query.entitlementId) rows = rows.filter((t) => t.entitlementId === String(req.query.entitlementId));
    if (req.query.userId) rows = rows.filter((t) => t.userId === String(req.query.userId));
    res.json({ transactions: rows.slice(0, 300).map((t) => ({ ...t, amountTzs: t.amountTzs === null ? null : Number(t.amountTzs) })) });
  })
);

const EXPORT_HEADER = ["entitlement_id", "batch_id", "reward_type", "reward_name", "partner", "value_tzs", "recipient_name", "recipient_phone", "recipient_email", "result", "reference", "failure_reason"];

// Exports the queue as a CSV that is ALSO the import template: staff fill
// in result / reference / failure_reason and upload it back.
router.post(
  "/fulfilment/export",
  support,
  asyncHandler(async (req, res) => {
    const { rewardDefinitionId, partnerId, ids } = z.object({ rewardDefinitionId: z.string().optional(), partnerId: z.string().optional(), ids: z.array(z.string()).optional() }).parse(req.body || {});
    const defs = Object.fromEntries((await prisma.rewardDefinition.findMany({})).map((d) => [d.id, d]));
    const partners = Object.fromEntries((await prisma.partner.findMany({})).map((p) => [p.id, p]));
    let rows = (await prisma.rewardEntitlement.findMany({ orderBy: { createdAt: "asc" } })).filter((e) => e.status === "queued");
    if (ids && ids.length) rows = rows.filter((e) => ids.includes(e.id));
    if (rewardDefinitionId) rows = rows.filter((e) => e.rewardDefinitionId === rewardDefinitionId);
    if (partnerId) rows = rows.filter((e) => defs[e.rewardDefinitionId] && defs[e.rewardDefinitionId].partnerId === partnerId);
    if (rows.length === 0) throw badRequest("Nothing in the queue matches.");
    const batch = await prisma.fulfilmentBatch.create({ data: { rewardType: rewardDefinitionId ? defs[rewardDefinitionId]?.type : null, partnerId: partnerId || null, itemCount: rows.length, createdByUserId: req.userId } });
    let csv = csvRow(EXPORT_HEADER);
    for (const e of rows) {
      const d = defs[e.rewardDefinitionId] || {};
      const u = await prisma.user.findUnique({ where: { id: e.userId }, select: { firstName: true, lastName: true, phone: true, email: true } });
      await prisma.rewardEntitlement.update({ where: { id: e.id }, data: { fulfilmentBatchId: batch.id } });
      csv += csvRow([e.id, batch.id, d.type, d.nameEn, d.partnerId && partners[d.partnerId] ? partners[d.partnerId].name : "", Number(e.valueTzs), u ? `${u.firstName} ${u.lastName}` : "", u ? u.phone : "", u ? u.email : "", "", "", ""]);
    }
    await writeAudit(req.userId, "referral.fulfilment.export", { batchId: batch.id, count: rows.length, ip: req.ip });
    sendCsv(res, `mitapesa-rewards-${batch.id}.csv`, csv);
  })
);

router.post(
  "/fulfilment/import",
  support,
  asyncHandler(async (req, res) => {
    const { csv } = z.object({ csv: z.string().min(10).max(2_000_000) }).parse(req.body);
    const rows = parseCsv(csv);
    if (rows.length === 0) throw badRequest("The file has no rows.");
    if (!("entitlement_id" in rows[0]) || !("result" in rows[0])) throw badRequest("Missing columns. Use the file exported from the Fulfilment queue (entitlement_id, result, reference, failure_reason).");
    const outcome = { fulfilled: 0, failed: 0, skipped: 0, errors: [] };
    const batchIds = new Set();
    let line = 1;
    for (const row of rows) {
      line++;
      const id = row.entitlement_id;
      const result = (row.result || "").toLowerCase();
      if (!id) { outcome.errors.push({ line, error: "Missing entitlement_id" }); continue; }
      if (!result) { outcome.skipped++; continue; } // not processed yet — leave in the queue
      if (!["fulfilled", "failed"].includes(result)) { outcome.errors.push({ line, id, error: `Unknown result "${row.result}" (use fulfilled or failed)` }); continue; }
      const ent = await prisma.rewardEntitlement.findUnique({ where: { id } });
      if (!ent) { outcome.errors.push({ line, id, error: "Unknown entitlement" }); continue; }
      if (ent.fulfilmentBatchId) batchIds.add(ent.fulfilmentBatchId);
      if (result === "fulfilled") {
        if (ent.status === "fulfilled") { outcome.skipped++; continue; } // re-upload of the same file is harmless
        const r = await R.markFulfilled(id, { externalRef: row.reference, actor: "import" });
        if (r.ok) outcome.fulfilled++; else outcome.errors.push({ line, id, error: `Can't fulfil a reward that is ${r.status || r.reason}` });
      } else {
        if (ent.status === "failed") { outcome.skipped++; continue; }
        const r = await R.markFailed(id, row.failure_reason || "Partner could not deliver", "import");
        if (r.ok) outcome.failed++; else outcome.errors.push({ line, id, error: `Can't fail a reward that is ${r.status || r.reason}` });
      }
    }
    for (const bid of batchIds) {
      const items = (await prisma.rewardEntitlement.findMany({ where: { fulfilmentBatchId: bid } }));
      const open = items.filter((e) => e.status === "queued").length;
      await prisma.fulfilmentBatch.update({ where: { id: bid }, data: { status: open === 0 ? "completed" : "partially_imported", importedAt: new Date() } });
    }
    await writeAudit(req.userId, "referral.fulfilment.import", { ...outcome, errors: outcome.errors.length, ip: req.ip });
    res.json(outcome);
  })
);

const noteSchema = z.object({ note: z.string().trim().max(500).optional(), externalRef: z.string().trim().max(120).optional(), reason: z.string().trim().max(300).optional() });

router.post("/entitlements/:id/fulfil", support, asyncHandler(async (req, res) => {
  const { externalRef } = noteSchema.parse(req.body || {});
  const r = await R.markFulfilled(req.params.id, { externalRef, actor: actorOf(req) });
  if (!r.ok) throw badRequest(r.reason === "not_found" ? "Reward not found" : `Can't mark a ${r.status} reward as delivered.`);
  await writeAudit(req.userId, "referral.entitlement.fulfilled", { entitlementId: req.params.id, ip: req.ip });
  res.json({ ok: true });
}));
router.post("/entitlements/:id/fail", support, asyncHandler(async (req, res) => {
  const { reason } = noteSchema.parse(req.body || {});
  const r = await R.markFailed(req.params.id, reason, actorOf(req));
  if (!r.ok) throw badRequest(r.reason === "not_found" ? "Reward not found" : `Can't fail a ${r.status} reward.`);
  await writeAudit(req.userId, "referral.entitlement.failed", { entitlementId: req.params.id, reason, ip: req.ip });
  res.json({ ok: true });
}));
router.post("/entitlements/:id/requeue", support, asyncHandler(async (req, res) => {
  const r = await R.requeue(req.params.id, actorOf(req));
  if (!r.ok) throw badRequest(r.reason === "not_found" ? "Reward not found" : `Can't re-queue a ${r.status} reward.`);
  await writeAudit(req.userId, "referral.entitlement.requeued", { entitlementId: req.params.id, ip: req.ip });
  res.json({ ok: true });
}));
router.post("/entitlements/:id/cancel", superOnly, asyncHandler(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(3).max(500) }).parse(req.body || {});
  const ok = await R.cancelEntitlement(req.params.id, actorOf(req), note);
  if (!ok) throw badRequest("This reward can't be cancelled in its current state.");
  await writeAudit(req.userId, "referral.entitlement.cancelled", { entitlementId: req.params.id, note, ip: req.ip });
  res.json({ ok: true });
}));

// ── Appeals ────────────────────────────────────────────────────────────
router.get(
  "/appeals",
  asyncHandler(async (req, res) => {
    const rows = (await prisma.referralAppeal.findMany({ orderBy: { createdAt: "desc" } })).filter((a) => !req.query.status || a.status === req.query.status);
    const out = [];
    for (const a of rows.slice(0, 200)) out.push({ ...a, user: (await nameOf(req, a.userId)).name });
    res.json({ appeals: out });
  })
);
router.post(
  "/appeals/:id/resolve",
  support,
  asyncHandler(async (req, res) => {
    const { decision, note } = z.object({ decision: z.enum(["upheld", "dismissed"]), note: z.string().trim().min(3).max(500) }).parse(req.body);
    const a = await prisma.referralAppeal.findUnique({ where: { id: req.params.id } });
    if (!a) throw notFound("Appeal not found");
    if (a.status !== "open") throw badRequest("This appeal is already resolved.");
    await prisma.referralAppeal.update({ where: { id: a.id }, data: { status: decision, resolutionNote: note, resolvedByUserId: req.userId, resolvedAt: new Date() } });
    if (decision === "upheld") await R.setReferralStatus(a.referralId, "approved", actorOf(req), `Appeal upheld: ${note}`);
    await R.sendNotice(a.userId, "appeal_resolved", { upheld: decision === "upheld" });
    await writeAudit(req.userId, "referral.appeal.resolved", { appealId: a.id, decision, ip: req.ip });
    res.json({ ok: true });
  })
);

// ── Fraud rules ────────────────────────────────────────────────────────
router.get(
  "/fraud-rules",
  asyncHandler(async (req, res) => {
    const rules = (await loadRuleConfig()).map(({ check, ...rest }) => rest);
    res.json({ rules, holdScore: Number(await R.getSettingValue("referral_fraud_hold_score")), rejectScore: Number(await R.getSettingValue("referral_fraud_reject_score")) });
  })
);
router.put(
  "/fraud-rules/:key",
  superOnly,
  asyncHandler(async (req, res) => {
    const known = (await loadRuleConfig()).find((r) => r.key === req.params.key);
    if (!known) throw notFound("Unknown rule");
    const input = z.object({ enabled: z.boolean().optional(), weight: z.coerce.number().int().min(0).max(100).optional(), params: z.record(z.coerce.number()).optional() }).parse(req.body);
    const data = { ...input, params: input.params ? { ...known.defaultParams, ...input.params } : undefined };
    await prisma.fraudRule.upsert({ where: { key: known.key }, update: data, create: { key: known.key, enabled: input.enabled ?? true, weight: input.weight ?? known.defaultWeight, params: data.params || known.defaultParams } });
    await writeAudit(req.userId, "referral.fraudrule.updated", { key: known.key, ...input, ip: req.ip });
    res.json({ ok: true });
  })
);

module.exports = router;
