const prisma = require("../prisma");
const { addDays, isUniqueViolation } = require("./util");

const PROMO_PREFIX = "promo:";

const usable = (c, now = new Date()) =>
  c.status === "active" && c.creditsUsed < c.creditsGranted && (!c.expiresAt || new Date(c.expiresAt) > now);

// Reward credits for a feature: soonest-expiring first, so nothing a
// customer earned lapses while a later grant sits untouched.
async function findActivePromoCredit(userId, feature) {
  const rows = await prisma.aiRewardCredit.findMany({ where: { userId, status: "active" } });
  const now = new Date();
  const matches = rows.filter((c) => (c.feature === "all" || c.feature === feature) && usable(c, now));
  matches.sort((a, b) => {
    const ea = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
    const eb = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
    return ea - eb || new Date(a.createdAt) - new Date(b.createdAt);
  });
  return matches[0] || null;
}

async function grantAiCredit({ userId, entitlementId, feature, credits, validDays }) {
  try {
    const credit = await prisma.aiRewardCredit.create({
      data: {
        userId, entitlementId, feature: feature || "all", creditsGranted: credits,
        expiresAt: validDays > 0 ? addDays(new Date(), validDays) : null,
      },
    });
    await prisma.aiCreditTransaction.create({ data: { creditId: credit.id, userId, feature: credit.feature, delta: credits, reason: "granted" } });
    return credit;
  } catch (err) {
    if (isUniqueViolation(err)) return null; // already granted for this entitlement — idempotent
    throw err;
  }
}

// Deduct-on-success, called from recordUsage() after the AI request has
// really succeeded. Optimistic lock on creditsUsed so two simultaneous
// requests can never spend the same last credit twice.
async function consumePromoCredit(creditId) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const credit = await prisma.aiRewardCredit.findUnique({ where: { id: creditId } });
    if (!credit || credit.creditsUsed >= credit.creditsGranted) return false;
    const res = await prisma.aiRewardCredit.updateMany({
      where: { id: creditId, creditsUsed: credit.creditsUsed },
      data: { creditsUsed: credit.creditsUsed + 1, ...(credit.creditsUsed + 1 >= credit.creditsGranted ? { status: "exhausted" } : {}) },
    });
    if (res.count === 1) {
      await prisma.aiCreditTransaction.create({ data: { creditId, userId: credit.userId, feature: credit.feature, delta: -1, reason: "consumed" } });
      return true;
    }
  }
  return false;
}

async function closeCredit(credit, newStatus, reason) {
  const left = credit.creditsGranted - credit.creditsUsed;
  const res = await prisma.aiRewardCredit.updateMany({ where: { id: credit.id, status: "active" }, data: { status: newStatus } });
  if (res.count === 1 && left > 0) {
    await prisma.aiCreditTransaction.create({ data: { creditId: credit.id, userId: credit.userId, feature: credit.feature, delta: -left, reason } });
  }
}

async function expireCredits() {
  const rows = await prisma.aiRewardCredit.findMany({ where: { status: "active" } });
  const now = new Date();
  let n = 0;
  for (const c of rows) {
    if (c.expiresAt && new Date(c.expiresAt) <= now) { await closeCredit(c, "expired", "expired"); n++; }
  }
  return n;
}

async function cancelCreditForEntitlement(entitlementId) {
  const c = await prisma.aiRewardCredit.findUnique({ where: { entitlementId } });
  if (c && c.status === "active") await closeCredit(c, "cancelled", "cancelled");
}

async function creditBalances(userId) {
  const rows = await prisma.aiRewardCredit.findMany({ where: { userId } });
  const now = new Date();
  const live = rows.filter((c) => usable(c, now));
  const sum = (arr) => arr.reduce((s, c) => s + (c.creditsGranted - c.creditsUsed), 0);
  const next = live.filter((c) => c.expiresAt).sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))[0];
  return {
    total: sum(live),
    voice: sum(live.filter((c) => c.feature === "all" || c.feature === "voice")),
    analytics: sum(live.filter((c) => c.feature === "all" || c.feature === "analytics")),
    nextExpiry: next ? next.expiresAt : null,
  };
}

module.exports = { PROMO_PREFIX, findActivePromoCredit, grantAiCredit, consumePromoCredit, expireCredits, cancelCreditForEntitlement, creditBalances };
