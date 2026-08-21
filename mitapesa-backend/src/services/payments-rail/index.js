const env = require("../../lib/env");
const { MockTipsProvider } = require("./MockTipsProvider");

let instance;

function getPaymentRailProvider() {
  if (instance) return instance;

  switch (env.providers.paymentsRail) {
    case "tips":
      // const { TipsProvider } = require("./TipsProvider");
      // instance = new TipsProvider({ ...sponsor-bank credentials... });
      throw new Error("PAYMENTS_RAIL_PROVIDER=tips is not implemented yet — use 'mock'");
    case "mock":
    default:
      instance = new MockTipsProvider();
  }
  return instance;
}

module.exports = { getPaymentRailProvider };
