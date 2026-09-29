/**
 * Maps a scanned QR's Merchant Category Code (ISO 18245, carried in
 * TANQR tag 52 — see lib/tanqr.js) to one of this app's own default
 * category names, so a QR payment can suggest a category instead of
 * always defaulting to whichever category happens to be first in the
 * customer's list.
 *
 * Deliberately returns a category NAME, not an ID — MCCs are a fixed,
 * external standard; a customer's actual category IDs vary per account
 * (their own custom categories, a renamed default one, deleted ones).
 * The caller is responsible for matching this name against that specific
 * customer's own categories and falling back gracefully — see
 * suggestCategoryForMcc's own doc comment below, and qrPayment.service.js
 * for where that matching actually happens.
 *
 * Coverage is deliberately not exhaustive — every code below is a range
 * genuinely common at a Tanzanian TIPS-enabled merchant (groceries,
 * restaurants, transport, fuel, pharmacies, retail, telecom, utilities).
 * An MCC outside every range below returns null — no suggestion is
 * offered rather than guessing at one, so the customer's own default
 * selection behavior (first category in their list) is unchanged for
 * anything this mapping doesn't confidently know.
 */
const MCC_RANGES = [
  // Food & Dining — grocery/food stores, restaurants, bars, fast food
  { from: 5411, to: 5499, category: "Food & Dining" },
  { from: 5811, to: 5814, category: "Food & Dining" },

  // Transportation — local transport, taxis, fuel, parking, vehicle services
  { from: 4111, to: 4131, category: "Transportation" },
  { from: 5541, to: 5542, category: "Transportation" },
  { from: 7511, to: 7549, category: "Transportation" },

  // Housing & Utilities — utilities, real estate, home/hardware
  { from: 4814, to: 4814, category: "Bills & Subscriptions" }, // telecom specifically, before the broader utilities range below
  { from: 4900, to: 4900, category: "Housing & Utilities" },
  { from: 6513, to: 6513, category: "Housing & Utilities" },
  { from: 5200, to: 5251, category: "Housing & Utilities" }, // hardware/home supply

  // Shopping — general retail, clothing, electronics, gifts
  { from: 5300, to: 5399, category: "Shopping" },
  { from: 5600, to: 5699, category: "Shopping" },
  { from: 5700, to: 5736, category: "Shopping" },
  { from: 5940, to: 5949, category: "Shopping" },
  { from: 5992, to: 5992, category: "Shopping" },

  // Health & Medical — pharmacies, doctors, hospitals, insurance
  { from: 5912, to: 5912, category: "Health & Medical" },
  { from: 8011, to: 8099, category: "Health & Medical" },

  // Education — schools, colleges, tutoring
  { from: 8211, to: 8299, category: "Education" },

  // Entertainment — cinemas, events, games, streaming
  { from: 7800, to: 7999, category: "Entertainment" },

  // Personal Care — salons, spas, grooming
  { from: 7230, to: 7298, category: "Personal Care" },

  // Financial — banks, other financial institutions
  { from: 6010, to: 6012, category: "Financial" },

  // Travel — airlines, hotels, travel agencies
  { from: 3000, to: 3999, category: "Travel" }, // IATA airline range
  { from: 4511, to: 4511, category: "Travel" },
  { from: 7011, to: 7011, category: "Travel" },
  { from: 4722, to: 4722, category: "Travel" },
];

/**
 * @param {string|null} mcc - the 4-digit MCC string from a resolved QR,
 *   or null if the QR didn't carry one at all.
 * @returns {string|null} one of this app's default category names, or
 *   null if the MCC is missing or outside every known range above.
 */
function suggestCategoryForMcc(mcc) {
  if (!mcc) return null;
  const code = Number(mcc);
  if (isNaN(code)) return null;
  const match = MCC_RANGES.find((r) => code >= r.from && code <= r.to);
  return match ? match.category : null;
}

module.exports = { suggestCategoryForMcc };
