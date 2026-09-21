const crypto = require("crypto");
const { CardFundingProvider } = require("./CardFundingProvider");

class MockVisaProvider extends CardFundingProvider {
  async chargeGateway({ paymentToken, amount }) {
    return { providerRef: crypto.randomUUID(), status: "completed", maskedSource: `•••• ${paymentToken.slice(-4)}` };
  }

  async pushFunds({ paymentToken, amount }) {
    return { providerRef: crypto.randomUUID(), status: "completed", maskedSource: `•••• ${paymentToken.slice(-4)}` };
  }
}

module.exports = { MockVisaProvider };
