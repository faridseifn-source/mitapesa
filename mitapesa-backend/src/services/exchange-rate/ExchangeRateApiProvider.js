const { ExchangeRateProvider } = require("./ExchangeRateProvider");

/**
 * Real exchange rates via ExchangeRate-API's Pair endpoint
 * (https://www.exchangerate-api.com/docs/pair-conversion-requests) — a
 * long-established service (running since 2010, real registered company)
 * chosen deliberately over several newer, SEO-blog-recommended
 * alternatives found while researching this, which read more like
 * marketing content than reliable services to build a real financial
 * feature on.
 *
 * The free tier updates once daily and allows 1,500 requests/month — both
 * comfortably sufficient here, since this is for personal-finance
 * tracking (converting a receipt or manual entry into the customer's
 * running currency), not real-time trading. Results are cached in-process
 * per currency pair to avoid burning through the monthly quota on
 * repeated conversions of the same pair within a day.
 *
 * IMPORTANT — same disclosed limitation as the other real providers built
 * in this project: this was built and reviewed without the ability to
 * make a live test call (no network access in the development sandbox).
 * The request/response shape matches the provider's own documented Pair
 * endpoint as of this writing, verified directly against their docs
 * rather than a third-party summary. The first real deploy is the first
 * real test of this exact code path — check Render logs for the raw
 * provider error if a conversion fails.
 */
class ExchangeRateApiProvider extends ExchangeRateProvider {
  constructor({ apiKey }) {
    super();
    this.apiKey = apiKey;
    this.cache = new Map(); // "FROM-TO" -> { rate, fetchedAt }
    this.cacheTtlMs = 12 * 60 * 60 * 1000; // rates only update daily on the free tier; no point re-fetching more often than this
  }

  async getRate(from, to) {
    if (from === to) return 1;
    const key = `${from}-${to}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) return cached.rate;

    const response = await fetch(`https://v6.exchangerate-api.com/v6/${this.apiKey}/pair/${from}/${to}`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Exchange rate request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const data = await response.json();
    if (data.result !== "success" || typeof data.conversion_rate !== "number") {
      throw new Error(`Exchange rate API error: ${data["error-type"] || "unexpected response shape"}`);
    }
    this.cache.set(key, { rate: data.conversion_rate, fetchedAt: Date.now() });
    return data.conversion_rate;
  }
}

module.exports = { ExchangeRateApiProvider };
