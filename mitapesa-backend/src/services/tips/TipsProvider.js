/**
 * Contract for the Tanzania Instant Payment System (TIPS) rail — used for
 * off-us payments where the merchant's acquirer isn't our partner bank.
 * Real TIPS connectivity requires the bank's own BOT/TIPS participant
 * relationship; this interface lets the rest of the app be built and
 * tested against a realistic contract until that connection exists.
 *
 * @typedef {Object} TipsResult
 * @property {string} tipsRef
 * @property {"completed"|"pending"|"failed"} status
 * @property {string} [failureReason]
 */
class TipsProvider {
  /**
   * Initiates and routes a payment through TIPS to the merchant's acquiring
   * institution — off-us flow steps 6-8 combined into one call, since our
   * simulation resolves synchronously (a real integration would likely
   * split "initiate" and "await webhook/poll for final response").
   * @param {{ reference: string, acquirerId: string, merchantId: string, amount: number, currency: string }} params
   * @returns {Promise<TipsResult>}
   */
  async routePayment(params) {
    throw new Error("routePayment not implemented");
  }

  /** @param {string} tipsRef @returns {Promise<TipsResult>} */
  async checkStatus(tipsRef) {
    throw new Error("checkStatus not implemented");
  }
}

module.exports = { TipsProvider };
