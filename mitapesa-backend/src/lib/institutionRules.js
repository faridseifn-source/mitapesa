const prisma = require("./prisma");
const { badRequest, forbidden } = require("./errors");

/**
 * Computes the fee for a transfer to a given institution, per its
 * admin-configured fee structure. Returns 0 for "none", a flat amount for
 * "fixed", or a percentage (optionally capped) for "percentage".
 */
function calculateTransferFee(institution, amount) {
  if (institution.feeType === "fixed") return Number(institution.feeFixedAmount);
  if (institution.feeType === "percentage") {
    let fee = amount * (Number(institution.feePercentage) / 100);
    if (institution.feeCapAmount !== null && institution.feeCapAmount !== undefined) {
      fee = Math.min(fee, Number(institution.feeCapAmount));
    }
    return Math.round(fee * 100) / 100; // round to the nearest cent-equivalent
  }
  return 0;
}

/**
 * Looks up the institution for a given off-us Acquirer ID and enforces
 * every configured rule — active status, transfers-enabled, min/max per
 * transaction, and the daily aggregate limit for this specific customer.
 * Throws a customer-safe error on any violation; returns the institution
 * row (needed by the caller to compute the fee) on success.
 */
async function assertTransferAllowed({ acquirerId, userId, amount }) {
  const institution = await prisma.financialInstitution.findUnique({ where: { acquirerId } });
  if (!institution) {
    throw badRequest("This institution isn't yet supported for transfers — please contact support.");
  }
  if (!institution.isActive) {
    throw forbidden(`Transfers to ${institution.name} are currently unavailable.`);
  }
  if (!institution.transfersEnabled) {
    throw forbidden(`Transfers to ${institution.name} are currently turned off.`);
  }
  if (amount < Number(institution.minTransferAmount)) {
    throw badRequest(`The minimum transfer to ${institution.name} is ${Number(institution.minTransferAmount).toLocaleString()} TZS.`);
  }
  if (institution.maxTransferAmount !== null && amount > Number(institution.maxTransferAmount)) {
    throw badRequest(`The maximum transfer to ${institution.name} is ${Number(institution.maxTransferAmount).toLocaleString()} TZS.`);
  }
  if (institution.dailyTransferLimit !== null) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todaysPayments = await prisma.qrPayment.findMany({
      where: {
        userId,
        status: "completed",
        createdAt: { gte: todayStart },
        merchant: { acquirerId },
      },
      select: { amount: true },
    });
    const todaysTotal = todaysPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    if (todaysTotal + amount > Number(institution.dailyTransferLimit)) {
      throw badRequest(`This would exceed today's transfer limit to ${institution.name} (${Number(institution.dailyTransferLimit).toLocaleString()} TZS/day).`);
    }
  }
  return institution;
}

/**
 * Non-throwing lookup for display purposes — the confirm screen needs to
 * show "Total charges" before the customer commits, without triggering any
 * of the enforcement in assertTransferAllowed (which is the real gate,
 * called again at actual payment time).
 */
async function previewInstitutionFee(acquirerId, amount) {
  const institution = await prisma.financialInstitution.findUnique({ where: { acquirerId } });
  if (!institution) return { feeAmount: 0, feeType: "none", institutionKnown: false };
  const feeAmount = amount ? calculateTransferFee(institution, amount) : 0;
  return {
    feeAmount,
    feeType: institution.feeType,
    feeFixedAmount: Number(institution.feeFixedAmount),
    feePercentage: Number(institution.feePercentage),
    feeCapAmount: institution.feeCapAmount !== null ? Number(institution.feeCapAmount) : null,
    institutionKnown: true,
    transfersEnabled: institution.isActive && institution.transfersEnabled,
  };
}

module.exports = { calculateTransferFee, assertTransferAllowed, previewInstitutionFee };
