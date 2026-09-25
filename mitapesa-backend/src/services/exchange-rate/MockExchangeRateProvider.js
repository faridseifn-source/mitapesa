const { ExchangeRateProvider } = require("./ExchangeRateProvider");

// Rough, deliberately-static rates for local development only — good
// enough to exercise the conversion code paths without a real API call.
// Never accurate enough to trust for anything real; the whole point of
// labeling this MockExchangeRateProvider is that it's obviously not that.
const MOCK_RATES_TO_USD = {
  USD: 1,
  TZS: 1 / 2600,
  KES: 1 / 129,
  ZAR: 1 / 18.5,
  EUR: 1.08,
  GBP: 1.27,
  UGX: 1 / 3700,
};

class MockExchangeRateProvider extends ExchangeRateProvider {
  async getRate(from, to) {
    if (from === to) return 1;
    const fromToUsd = MOCK_RATES_TO_USD[from];
    const toToUsd = MOCK_RATES_TO_USD[to];
    if (!fromToUsd || !toToUsd) throw new Error(`Mock exchange rate provider has no rate for ${from} or ${to}`);
    return fromToUsd / toToUsd;
  }
}

module.exports = { MockExchangeRateProvider };
