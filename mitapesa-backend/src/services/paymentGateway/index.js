const env = require("../../lib/env");
const { MockPaymentGatewayProvider } = require("./MockPaymentGatewayProvider");

let instance;

function getPaymentGatewayProvider() {
  if (instance) return instance;

  switch (env.providers.paymentGateway) {
    // A real provider (Flutterwave, DPO, Selcom, or similar) gets added
    // here the same way OCR/voice/transcription providers were — a new
    // file implementing PaymentGatewayProvider, a new case below, and
    // whatever API key(s) that integration needs added to lib/env.js.
    // Deliberately not built yet: which gateway to use is a real business
    // decision (fees, settlement currency, which acquirer relationships
    // it already has) that shouldn't be guessed at in code.
    case "mock":
    default:
      instance = new MockPaymentGatewayProvider();
  }
  return instance;
}

module.exports = { getPaymentGatewayProvider };
