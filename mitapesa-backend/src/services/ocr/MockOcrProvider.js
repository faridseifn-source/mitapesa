const { OcrProvider } = require("./OcrProvider");

const SAMPLE_RECEIPTS = [
  { merchant: "Kariakoo Fresh Market", categoryHint: "Food" },
  { merchant: "Total Energies Fuel Station", categoryHint: "Transport" },
  { merchant: "Mlimani City Cinema", categoryHint: "Entertainment" },
  { merchant: "Java House Cafe", categoryHint: "Food" },
  { merchant: "Slipway Pharmacy", categoryHint: "Health" },
];

/**
 * Simulates OCR extraction with plausible-looking random data — for local
 * development only. Never used in production unless OCR_PROVIDER is
 * explicitly left at "mock", and the route's own response always discloses
 * which provider produced the result, so this is never silently
 * indistinguishable from a real extraction.
 */
class MockOcrProvider extends OcrProvider {
  async extractReceipt({ categoryNames }) {
    await new Promise((r) => setTimeout(r, 1200)); // simulate real network latency
    const pick = SAMPLE_RECEIPTS[Math.floor(Math.random() * SAMPLE_RECEIPTS.length)];
    const category = categoryNames.find((c) => c.toLowerCase().includes(pick.categoryHint.toLowerCase())) || categoryNames[0] || null;
    return {
      merchant: pick.merchant,
      amount: Math.round((4 + Math.random() * 45) * 100) / 100,
      currency: "TZS",
      date: new Date().toISOString().slice(0, 10),
      category,
      confidence: Math.round(82 + Math.random() * 16),
    };
  }
}

module.exports = { MockOcrProvider };
