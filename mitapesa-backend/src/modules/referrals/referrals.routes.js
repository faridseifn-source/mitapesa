const { Router } = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, badRequest } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");
const { getSetting } = require("../../lib/settings");
const R = require("../../lib/referrals");

/**
 * Customer side of Referral & Rewards.
 * Privacy rule enforced here: a referrer only ever sees a referred
 * customer's first name + last initial, which onboarding step they are on,
 * and whether the referral qualified — never balances, transactions,
 * budgets, merchants or anything else from their account.
 */
const router = Router();

const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// Public: the invite page / registration screen resolves a code to a
// friendly "Amina invited you" line. Reveals first name only. Records a click.
router.get(
  "/resolve/:code",
  publicLimiter,
  asyncHandler(async (req, res) => {
    if (!(await R.referralsEnabled())) return res.json({ valid: false });
    const code = R.normalizeCode(req.params.code);
    const row = code ? await prisma.referralCode.findUnique({ where: { code } }) : null;
    if (!row || !row.active) return res.json({ valid: false });
    const referrer = await prisma.user.findUnique({ where: { id: row.userId }, select: { firstName: true, deletedAt: true } });
    if (!referrer || referrer.deletedAt) return res.json({ valid: false });
    await prisma.referralClick.create({ data: { code, ipHash: R.hashValue(req.ip), deviceHash: R.hashValue(req.query.deviceId) } }).catch(() => {});
    const campaign = await R.getActiveCampaign();
    res.json({
      valid: true, code, referrerFirstName: referrer.firstName,
      campaign: campaign ? { nameEn: campaign.nameEn, nameSw: campaign.nameSw, descriptionEn: campaign.descriptionEn, descriptionSw: campaign.descriptionSw } : null,
    });
  })
);

router.use(requireAuth);

const stepView = (m, p) => ({
  id: m.id, titleEn: m.titleEn, titleSw: m.titleSw, threshold: m.threshold,
  progress: p ? Math.min(p.progress, m.threshold) : 0, done: Boolean(p && p.achievedAt),
});

const rewardView = (e, def) => ({
  id: e.id, recipient: e.recipient, status: e.status,
  nameEn: def ? def.nameEn : "Reward", nameSw: def ? def.nameSw : "Zawadi",
  descriptionEn: def ? def.descriptionEn : "", descriptionSw: def ? def.descriptionSw : "",
  type: def ? def.type : "other", valueTzs: Number(e.valueTzs || 0),
  maturesAt: e.maturesAt, fulfilledAt: e.fulfilledAt, expiresAt: e.expiresAt,
  // The partner's voucher/airtime reference is the customer's own proof — fine to show.
  reference: e.status === "fulfilled" ? e.externalRef : null,
  // Internal reasons (fraud, caps) are not shown; only a neutral note when delivery failed.
  failed: e.status === "failed",
  createdAt: e.createdAt,
});

// The home card + share screen.
router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const enabled = await R.referralsEnabled();
    const campaign = enabled ? await R.getActiveCampaign() : null;
    if (!enabled || !campaign) return res.json({ enabled: false });

    if (req.query.deviceId) await R.recordDevice(req.userId, String(req.query.deviceId), req.ip);
    const codeRow = await R.getOrCreateCode(req.userId);
    const milestones = (await prisma.referralMilestone.findMany({ where: { campaignId: campaign.id, active: true } })).sort((a, b) => a.sequence - b.sequence);

    const mine = await prisma.referral.findMany({ where: { referrerUserId: req.userId }, orderBy: { createdAt: "desc" } });
    const clicks = await prisma.referralClick.count({ where: { code: codeRow.code } });
    const counted = mine.filter((r) => !["rejected", "cancelled"].includes(r.status));
    const rewards = await prisma.rewardEntitlement.findMany({ where: { userId: req.userId } });

    // If I was myself referred: show my own onboarding checklist.
    const asReferred = await prisma.referral.findUnique({ where: { referredUserId: req.userId } });
    let onboarding = null;
    if (asReferred && !["rejected", "cancelled"].includes(asReferred.status)) {
      const prog = await prisma.referralMilestoneProgress.findMany({ where: { referralId: asReferred.id } });
      onboarding = {
        status: asReferred.status,
        steps: milestones.map((m) => stepView(m, prog.find((p) => p.milestoneId === m.id))),
        expiresAt: asReferred.expiresAt,
      };
    }

    res.json({
      enabled: true,
      code: codeRow.code,
      link: await R.inviteLink(codeRow.code),
      campaign: {
        nameEn: campaign.nameEn, nameSw: campaign.nameSw, descriptionEn: campaign.descriptionEn, descriptionSw: campaign.descriptionSw,
        termsEn: campaign.termsEn, termsSw: campaign.termsSw, endsAt: campaign.endsAt, qualifyWithinDays: campaign.qualifyWithinDays,
        steps: milestones.map((m) => ({ titleEn: m.titleEn, titleSw: m.titleSw, threshold: m.threshold })),
      },
      stats: {
        clicks,
        joined: counted.length,
        qualified: mine.filter((r) => r.status === "qualified").length,
        inProgress: mine.filter((r) => r.status === "pending").length,
        rewardsEarned: rewards.filter((e) => e.recipient === "referrer" && ["fulfilled", "queued", "available", "pending_maturity"].includes(e.status)).length,
      },
      onboarding,
      aiCredits: await R.aiCredits.creditBalances(req.userId),
    });
  })
);

// People I invited — name + step only.
router.get(
  "/referred",
  asyncHandler(async (req, res) => {
    const mine = await prisma.referral.findMany({ where: { referrerUserId: req.userId }, orderBy: { createdAt: "desc" } });
    const rows = [];
    for (const r of mine.slice(0, 100)) {
      const u = await prisma.user.findUnique({ where: { id: r.referredUserId }, select: { firstName: true, lastName: true, deletedAt: true } });
      const campaign = await prisma.referralCampaign.findUnique({ where: { id: r.campaignId } });
      const milestones = await prisma.referralMilestone.findMany({ where: { campaignId: r.campaignId, active: true, required: true } });
      const prog = await prisma.referralMilestoneProgress.findMany({ where: { referralId: r.id } });
      const done = prog.filter((p) => p.achievedAt && milestones.some((m) => m.id === p.milestoneId)).length;
      let status = r.status;
      if (status === "under_review" || status === "rejected") status = "under_review"; // never reveal fraud reasoning
      rows.push({
        id: r.id,
        name: !u || u.deletedAt ? "—" : R.shortName(u),
        status, // pending | qualified | under_review | expired | cancelled
        stepsDone: done, stepsTotal: milestones.length,
        joinedAt: r.createdAt,
        canAppeal: r.status === "rejected" || r.status === "under_review",
        _campaign: campaign ? campaign.slug : null,
      });
    }
    res.json({ referred: rows.map(({ _campaign, ...rest }) => rest) });
  })
);

// My reward wallet.
router.get(
  "/rewards",
  asyncHandler(async (req, res) => {
    const ents = (await prisma.rewardEntitlement.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } }))
      .filter((e) => e.status !== "capped" || false);
    const defs = {};
    for (const e of ents) if (!defs[e.rewardDefinitionId]) defs[e.rewardDefinitionId] = await prisma.rewardDefinition.findUnique({ where: { id: e.rewardDefinitionId } });
    const history = (await prisma.rewardTransaction.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } }))
      .filter((t) => ["created", "fulfilled", "ai_credit_granted", "failed", "cancelled", "expired"].includes(t.type))
      .slice(0, 50).map((t) => ({ id: t.id, type: t.type, at: t.createdAt }));
    const credits = await prisma.aiRewardCredit.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
    res.json({
      rewards: ents.map((e) => rewardView(e, defs[e.rewardDefinitionId])),
      aiCredits: await R.aiCredits.creditBalances(req.userId),
      aiCreditGrants: credits.map((c) => ({ id: c.id, feature: c.feature, granted: c.creditsGranted, used: c.creditsUsed, expiresAt: c.expiresAt, status: c.status })),
      history,
    });
  })
);

const appealSchema = z.object({ referralId: z.string().min(1), message: z.string().trim().min(5).max(1000) });

router.post(
  "/appeals",
  asyncHandler(async (req, res) => {
    const { referralId, message } = appealSchema.parse(req.body);
    const referral = await prisma.referral.findUnique({ where: { id: referralId } });
    if (!referral || referral.referrerUserId !== req.userId) throw notFound("Referral not found");
    if (!["rejected", "under_review"].includes(referral.status)) throw badRequest("This referral can't be appealed.");
    const open = await prisma.referralAppeal.findMany({ where: { referralId, status: "open" } });
    if (open.length > 0) throw badRequest("You already have an appeal open for this referral.");
    const appeal = await prisma.referralAppeal.create({ data: { referralId, userId: req.userId, message } });
    await writeAudit(req.userId, "referral.appeal.created", { referralId, appealId: appeal.id, ip: req.ip });
    res.status(201).json({ appeal: { id: appeal.id, status: appeal.status } });
  })
);

// QR for the invite link. Uses the optional "qrcode" package; if it isn't
// installed the app simply falls back to showing the code and link.
router.get(
  "/me/qr.svg",
  asyncHandler(async (req, res) => {
    const codeRow = await R.getOrCreateCode(req.userId);
    const link = (await R.inviteLink(codeRow.code)) || codeRow.code;
    let QRCode;
    try { QRCode = require("qrcode"); } catch (e) { return res.status(501).json({ error: "QR generation isn't installed on the server." }); }
    const svg = await QRCode.toString(link, { type: "svg", margin: 1, width: 240 });
    res.type("image/svg+xml").send(svg);
  })
);

module.exports = router;
