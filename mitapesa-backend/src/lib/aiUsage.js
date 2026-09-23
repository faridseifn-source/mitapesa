const prisma = require("./prisma");
const { getSetting, getSettingNumber } = require("./settings");
const { getPaymentGatewayProvider } = require("../services/paymentGateway");

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// A customer's unused purchased credits, oldest purchase first — spending
// the oldest credits first means a customer's balance is always made up
// of whichever purchases haven't been exhausted yet, rather than one
// arbitrary purchase's credits sitting unused forever while newer ones
// get consumed. Only counts succeeded purchases — a failed charge never
// created usable credits in the first place. Prisma's query API can't
// compare two columns of the same row directly (creditsUsed < creditsPurchased
// isn't expressible as a `where` filter), so this fetches a customer's
// succeeded purchases and finds the first one with room left in JS —
// genuinely fine for the small number of purchases any one customer is
// realistically going to have, and far simpler than a raw SQL query for
// what's a rare, deliberate action rather than a hot path.
async function findAvailableCredit(userId) {
  const purchases = await prisma.voiceCreditPurchase.findMany({
    where: { userId, status: "succeeded" },
    orderBy: { createdAt: "asc" },
  });
  return purchases.find((p) => p.creditsUsed < p.creditsPurchased) || null;
}

// Checked before a voice request is allowed to actually call OpenAI —
// this is the enforcement point, not just a display/reporting number.
// Checked in this specific order, because a customer's own allowance (or
// purchased credits) should never be able to override the account-wide
// safety net: even during an active promotion, or with unused purchased
// credits, the global ceiling below still applies — a customer paying
// for extra usage is buying priority within the account's overall
// budget, not an exemption from it.
async function checkVoiceUsageAllowed(userId) {
  const monthKey = currentMonthKey();
  const packSize = await getSettingNumber("voice_credit_pack_size");
  const packPriceTzs = await getSettingNumber("voice_credit_pack_price_tzs");

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
        // Deliberately no canPurchaseCredits here — the account-wide
        // ceiling is the reason, and buying more credits wouldn't help:
        // the ceiling still applies to every customer's usage regardless
        // of purchased credits, so offering a purchase here would let a
        // customer pay for something that still wouldn't work.
      };
    }
  }

  const promoUntil = await getSetting("voice_promo_free_until");
  const promoActive = Boolean(promoUntil) && new Date(promoUntil) >= new Date();
  if (promoActive) {
    return { allowed: true, packSize, packPriceTzs };
  }

  const freeLimit = await getSettingNumber("voice_free_monthly_limit");
  if (freeLimit !== undefined) {
    const usedThisMonth = await prisma.aiUsageLog.count({
      where: { userId, feature: "voice", monthKey },
    });
    if (usedThisMonth < freeLimit) {
      return { allowed: true, packSize, packPriceTzs, freeUsedThisMonth: usedThisMonth, freeLimit };
    }
  }

  // Free allowance exhausted (or none configured) — fall back to any
  // unused purchased credits before denying outright. Unlike the free
  // allowance, these never expire at month-end.
  const credit = await findAvailableCredit(userId);
  if (credit) {
    return { allowed: true, usingCreditId: credit.id, packSize, packPriceTzs };
  }

  return {
    allowed: false,
    reason: `You've used your ${freeLimit ?? 0} free voice logs for this month.`,
    canPurchaseCredits: true,
    packSize,
    packPriceTzs,
  };
}

// Recorded only after a request has genuinely succeeded end to end
// (transcription and parsing both completed) — a failed attempt that
// never actually reached OpenAI, or failed partway, shouldn't count
// against a customer's free allowance, purchased credits, or the
// account's spend ceiling. usingCreditId, when present, is the specific
// purchase checkVoiceUsageAllowed found available — passed straight
// through rather than re-queried, so what actually gets decremented is
// guaranteed to be the same record that was checked, not a second,
// possibly different one a moment later.
async function recordVoiceUsage(userId, estimatedCostUsd, usingCreditId) {
  await prisma.aiUsageLog.create({
    data: {
      userId,
      feature: "voice",
      monthKey: currentMonthKey(),
      estimatedCostUsd,
    },
  });
  if (usingCreditId) {
    await prisma.voiceCreditPurchase.update({
      where: { id: usingCreditId },
      data: { creditsUsed: { increment: 1 } },
    });
  }
}

// The actual purchase itself — charges the customer via the configured
// payment gateway (mock today; a real provider later without any change
// to the caller) and, only on a genuinely successful charge, creates the
// credits. A failed charge creates no usable credits at all — there's
// nothing to roll back, since nothing was granted in the first place.
async function purchaseVoiceCredits(userId) {
  const packSize = await getSettingNumber("voice_credit_pack_size");
  const packPrice = await getSettingNumber("voice_credit_pack_price_tzs");
  if (!packSize || !packPrice) {
    return { success: false, failureReason: "Voice credit purchases aren't configured yet." };
  }

  const charge = await getPaymentGatewayProvider().chargeCard({
    userId,
    amountTzs: packPrice,
    description: `MitaPesa — ${packSize} voice expense logs`,
  });

  if (!charge.success) {
    await prisma.voiceCreditPurchase.create({
      data: { userId, creditsPurchased: packSize, amountPaidTzs: packPrice, gatewayReference: charge.gatewayReference, status: "failed" },
    });
    return { success: false, failureReason: charge.failureReason || "The payment didn't go through — please try again." };
  }

  const purchase = await prisma.voiceCreditPurchase.create({
    data: { userId, creditsPurchased: packSize, amountPaidTzs: packPrice, gatewayReference: charge.gatewayReference, status: "succeeded" },
  });
  return { success: true, creditsPurchased: packSize, amountPaidTzs: packPrice, purchaseId: purchase.id };
}

module.exports = { currentMonthKey, checkVoiceUsageAllowed, recordVoiceUsage, purchaseVoiceCredits };
