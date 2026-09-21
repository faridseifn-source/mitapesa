const env = require("../../lib/env");
const { MockSmsProvider } = require("./MockSmsProvider");

let instance;

function getSmsProvider() {
  if (instance) return instance;

  switch (env.providers.sms) {
    case "africastalking": {
      const { AfricasTalkingSmsProvider } = require("./AfricasTalkingSmsProvider");
      if (!env.sms.atApiKey) throw new Error("SMS_PROVIDER=africastalking requires AFRICASTALKING_API_KEY to be set");
      instance = new AfricasTalkingSmsProvider({ apiKey: env.sms.atApiKey, username: env.sms.atUsername, senderId: env.sms.atSenderId });
      break;
    }
    case "mock":
    default:
      instance = new MockSmsProvider();
  }
  return instance;
}

module.exports = { getSmsProvider };
