/**
 * Contract for loading funds onto the MitaPesa card from an external Visa
 * card. IMPORTANT: once this is real, raw PAN/CVV must never reach our
 * backend — the client should collect card data via Visa/processor-hosted
 * fields (e.g. Cybersource Secure Acceptance) and hand this provider only
 * a single-use payment token. Storing/transmitting raw PANs puts the whole
 * backend in PCI DSS scope, which we want to avoid entirely.
 *
 * @typedef {Object} FundingResult
 * @property {string} providerRef
 * @property {"completed"|"pending"|"failed"} status
 * @property {string} maskedSource   e.g. "•••• 4821"
 */
class CardFundingProvider {
  /** @param {{ paymentToken: string, amount: number, currency: string }} params @returns {Promise<FundingResult>} */
  async chargeGateway(params) {
    throw new Error("chargeGateway not implemented");
  }

  /** @param {{ paymentToken: string, amount: number, currency: string }} params @returns {Promise<FundingResult>} Visa Original Credit Transaction — instant push */
  async pushFunds(params) {
    throw new Error("pushFunds not implemented");
  }
}

module.exports = { CardFundingProvider };
