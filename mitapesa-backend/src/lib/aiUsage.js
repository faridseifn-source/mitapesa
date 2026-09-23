const prisma = require("./prisma");
const { getSetting, getSettingNumber } = require("./settings");

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Checked before a voice request is allowed to actually call OpenAI —
// this is the enforcement point, not just a display/reporting number.
// Two independent protections are checked here, in this specific order,
// because a customer's own allowance should never be able to override
// the account-wide safety net: even during an active promotion (unlimited
// per-customer usage), the global ceiling below still applies.
async function checkVoiceUsageAllowed(userId) {
  const monthKey = currentMonthKey();

  const ceilingUsd = await getSettingNumber("voice_monthly_spend_ceiling_usd");
  if (ceilingUsd !== undefined && ceilingUsd > 0) {
    const spent = await prisma.aiUsageLog.aggregate({
      where: { feature: "voice", monthKey },
      _sum: { estimatedCostUsd: true },
    });
    const spentUsd = Number(spent._sum.estimatedCostUsd || 0);
    if (spentUsd >= ceilingUsd) {
      return {
        allowed: false,
        reason: "Voice logging has reached its usage limit for this month and will be back at the start of next month. Please add this expense manually for now.",
      };
    }
  }

  const promoUntil = await getSetting("voice_promo_free_until");
  const promoActive = Boolean(promoUntil) && new Date(promoUntil) >= new Date();
  if (promoActive) {
    return { allowed: true };
  }

  const freeLimit = await getSettingNumber("voice_free_monthly_limit");
  if (freeLimit !== undefined) {
    const usedThisMonth = await prisma.aiUsageLog.count({
      where: { userId, feature: "voice", monthKey },
    });
    if (usedThisMonth >= freeLimit) {
      return {
        allowed: false,
        reason: `You've used your ${freeLimit} free voice logs for this month. Please add this expense manually, or check back next month.`,
      };
    }
  }

  return { allowed: true };
}

// Recorded only after a request has genuinely succeeded end to end
// (transcription and parsing both completed) — a failed attempt that
// never actually reached OpenAI, or failed partway, shouldn't count
// against a customer's free allowance or the account's spend ceiling.
async function recordVoiceUsage(userId, estimatedCostUsd) {
  await prisma.aiUsageLog.create({
    data: {
      userId,
      feature: "voice",
      monthKey: currentMonthKey(),
      estimatedCostUsd,
    },
  });
}

module.exports = { currentMonthKey, checkVoiceUsageAllowed, recordVoiceUsage };
