const env = require("../../lib/env");
const { MockNidaProvider } = require("./MockNidaProvider");

let instance;

function getKycProvider() {
  if (instance) return instance;

  switch (env.providers.kyc) {
    case "nida":
      // Swap in once NIDA Reliant Party access + an SMS/USSD gateway are live:
      // const { NidaProvider } = require("./NidaProvider");
      // instance = new NidaProvider({ ...env-driven credentials... });
      throw new Error("KYC_PROVIDER=nida is not implemented yet — use 'mock'");
    case "mock":
    default:
      instance = new MockNidaProvider();
  }
  return instance;
}

module.exports = { getKycProvider };
