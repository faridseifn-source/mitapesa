const env = require("../../lib/env");
const { MockVisaProvider } = require("./MockVisaProvider");

let instance;

function getCardFundingProvider() {
  if (instance) return instance;

  switch (env.providers.cardFunding) {
    case "visa":
      // const { VisaProvider } = require("./VisaProvider");
      // instance = new VisaProvider({ ...acquirer/cert credentials... });
      throw new Error("CARD_FUNDING_PROVIDER=visa is not implemented yet — use 'mock'");
    case "mock":
    default:
      instance = new MockVisaProvider();
  }
  return instance;
}

module.exports = { getCardFundingProvider };
