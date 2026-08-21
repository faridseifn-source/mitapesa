const env = require("../../lib/env");
const { MockTipsProvider } = require("./MockTipsProvider");

let instance;

function getTipsProvider() {
  if (instance) return instance;
  switch (env.providers.tips) {
    case "bot_tips":
      throw new Error("TIPS_RAIL_PROVIDER=bot_tips is not implemented yet — BOT/TIPS participant connection required. Use 'mock' to simulate it.");
    case "mock":
    default:
      instance = new MockTipsProvider();
  }
  return instance;
}

module.exports = { getTipsProvider };
