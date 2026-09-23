/**
 * Contract for the instant-payment rail (TIPS in Tanzania). A standalone
 * fintech typically reaches this through a sponsor bank / existing switch
 * participant rather than connecting to BoT directly — the real
 * implementation should assume it's calling that sponsor's wrapped API,
 * not TIPS' ISO 20022 interface directly.
 *
 * @typedef {Object} ResolvedRecipient
 * @property {string} name
 * @property {string} accountRef   masked account/till/phone reference
 *
 * @typedef {Object} PaymentResult
 * @property {string} providerRef  external transaction id, for reconciliation
 * @property {"completed"|"pending"|"failed"} status
 */
class PaymentRailProvider {
  /** @param {string} destination till number, phone number, or scanned QR payload @returns {Promise<ResolvedRecipient>} */
  async resolveRecipient(destination) {
    throw new Error("resolveRecipient not implemented");
  }

  /** @param {{ destination: string, amount: number, currency: string }} params @returns {Promise<PaymentResult>} */
  async initiatePayment(params) {
    throw new Error("initiatePayment not implemented");
  }

  /** @param {string} providerRef @returns {Promise<PaymentResult>} */
  async checkStatus(providerRef) {
    throw new Error("checkStatus not implemented");
  }
}

module.exports = { PaymentRailProvider };
