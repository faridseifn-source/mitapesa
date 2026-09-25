const env = require("../../lib/env");
const { MockCbsProvider } = require("./MockCbsProvider");

let instance;

function getCbsProvider() {
  if (instance) return instance;
  switch (env.providers.cbs) {
    case "partner_bank":
      throw new Error("CBS_PROVIDER=partner_bank is not implemented yet — bank connection required. Use 'mock' to simulate it.");
    case "mock":
    default:
      instance = new MockCbsProvider();
  }
  return instance;
}

module.exports = { getCbsProvider };
