const env = require("../../lib/env");
const { MockCardProvider } = require("./MockCardProvider");
const { BpcSmartVistaSimProvider } = require("./BpcSmartVistaSimProvider");

let instance;

function getCardIssuingProvider() {
  if (instance) return instance;

  switch (env.providers.cardIssuing) {
    // The real BPC SmartVista connection, once the bank relationship and
    // credentials exist. Swapping this in means implementing this same
    // CardIssuingProvider interface against actual SOAP/HTTP calls — the
    // request/response shapes are already documented against the real
    // SVWG/SVAP specs in BpcSmartVistaSimProvider's comments, so this is a
    // transport-layer swap, not a redesign.
    case "bpc_smartvista":
      throw new Error("CARD_ISSUING_PROVIDER=bpc_smartvista is not implemented yet — bank connection required. Use 'bpc_smartvista_sim' to simulate it.");
    // Simulates the CMS using BPC SmartVista's real API shapes, so this
    // whole app can be built and demoed against a realistic contract before
    // the bank relationship exists.
    case "bpc_smartvista_sim":
      instance = new BpcSmartVistaSimProvider();
      break;
    case "processor":
      throw new Error("CARD_ISSUING_PROVIDER=processor is not implemented yet — use 'mock' or 'bpc_smartvista_sim'");
    case "mock":
    default:
      instance = new MockCardProvider();
  }
  return instance;
}

module.exports = { getCardIssuingProvider };
