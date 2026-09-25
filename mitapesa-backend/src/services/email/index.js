const env = require("../../lib/env");
const { MockEmailProvider } = require("./MockEmailProvider");

let instance;

function getEmailProvider() {
  if (instance) return instance;

  switch (env.providers.email) {
    case "resend": {
      const { ResendEmailProvider } = require("./ResendEmailProvider");
      if (!env.email.resendApiKey) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY to be set");
      instance = new ResendEmailProvider({ apiKey: env.email.resendApiKey, fromAddress: env.email.fromAddress });
      break;
    }
    case "mock":
    default:
      instance = new MockEmailProvider();
  }
  return instance;
}

module.exports = { getEmailProvider };
