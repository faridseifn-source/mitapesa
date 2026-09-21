const prisma = require("../../lib/prisma");
const env = require("../../lib/env");
const { ApiError } = require("../../lib/errors");

// Every card-money-movement route (topup, OCT, Lipa, GePG, LUKU, transfers)
// must call this before touching the ledger. Mirrors the amount-vs-threshold
// check already enforced in the frontend, but here it's the real gate —
// the client-side check is just UX, this is the one that matters.
async function requireKycIfOverThreshold(userId, amount) {
  if (amount <= env.kycThresholdTZS) return;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.kycStatus !== "VERIFIED") {
    throw new ApiError(412, "KYC verification required for amounts over the threshold", {
      code: "KYC_REQUIRED",
      threshold: env.kycThresholdTZS,
    });
  }
}

module.exports = { requireKycIfOverThreshold };
