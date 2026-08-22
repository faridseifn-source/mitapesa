const { badRequest } = require("./errors");

/**
 * Computes a subscription's expiry date from its bundle's validity period.
 */
function computeExpiry(validity, from) {
  const d = new Date(from);
  if (validity === "DAILY") d.setDate(d.getDate() + 1);
  else if (validity === "WEEKLY") d.setDate(d.getDate() + 7);
  else if (validity === "MONTHLY") d.setMonth(d.getMonth() + 1);
  else throw badRequest("Unknown bundle validity period");
  return d;
}

/**
 * Same VAT semantics as the fee-rule engine (lib/feeCalculations.js):
 * VAT_EXCLUSIVE adds VAT on top of the bundle's listed price (the customer
 * pays more than `price`); VAT_INCLUSIVE treats `price` as already
 * including VAT, so the VAT component is disclosed but not charged again
 * on top. Returns { vatAmount, totalCharge } — vatAmount is always the
 * disclosed VAT component either way, totalCharge is what's actually
 * debited.
 */
function computeBundleVat(bundle) {
  const price = Number(bundle.price);
  const rate = Number(bundle.vatRate || 0);
  if (bundle.taxTreatment === "VAT_EXCLUSIVE" && rate > 0) {
    const vatAmount = Math.round(price * (rate / 100) * 100) / 100;
    return { vatAmount, totalCharge: price + vatAmount };
  }
  if (bundle.taxTreatment === "VAT_INCLUSIVE" && rate > 0) {
    const vatAmount = Math.round((price - price / (1 + rate / 100)) * 100) / 100;
    return { vatAmount, totalCharge: price };
  }
  return { vatAmount: 0, totalCharge: price };
}

/**
 * Prorates a refund (base price and VAT separately) by time remaining in a
 * subscription — the automatic default policy for a `refundable` bundle
 * cancelled before it expires. Pulled out of cancelSubscriptionForUser so
 * the proration math itself — the part with the most room for an off-by-
 * one or sign error — can be tested without a database.
 */
function computeProratedRefund({ pricePaid, vatPaid, purchasedAt, expiresAt, now = new Date() }) {
  const totalMs = new Date(expiresAt).getTime() - new Date(purchasedAt).getTime();
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - new Date(now).getTime());
  if (totalMs <= 0 || remainingMs <= 0) return { refundAmount: 0, vatRefunded: 0 };
  const proportion = remainingMs / totalMs;
  const priceRefund = Math.floor(Number(pricePaid) * proportion);
  const vatRefunded = Math.floor(Number(vatPaid || 0) * proportion);
  return { refundAmount: priceRefund + vatRefunded, vatRefunded };
}

module.exports = { computeExpiry, computeBundleVat, computeProratedRefund };
