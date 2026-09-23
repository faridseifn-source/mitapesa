const env = require("../../lib/env");
const { MockExchangeRateProvider } = require("./MockExchangeRateProvider");

let instance;

function getExchangeRateProvider() {
  if (instance) return instance;

  switch (env.providers.exchangeRate) {
    case "exchangerate_api": {
      const { ExchangeRateApiProvider } = require("./ExchangeRateApiProvider");
      if (!env.exchangeRate.apiKey) throw new Error("EXCHANGE_RATE_PROVIDER=exchangerate_api requires EXCHANGE_RATE_API_KEY to be set");
      instance = new ExchangeRateApiProvider({ apiKey: env.exchangeRate.apiKey });
      break;
    }
    case "mock":
      instance = new MockExchangeRateProvider();
      break;
    case "manual":
    default: {
      // The sensible default: no external API key or network access
      // needed at all — an admin enters rates directly (Admin Portal ->
      // Exchange Rates) and the whole feature works immediately.
      const { ManualExchangeRateProvider } = require("./ManualExchangeRateProvider");
      instance = new ManualExchangeRateProvider();
    }
  }
  return instance;
}

module.exports = { getExchangeRateProvider };
