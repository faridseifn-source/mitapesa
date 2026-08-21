/**
 * Contract for the partner bank's Core Banking System (CBS) — the system
 * of record for the settlement/control account and merchant accounts on
 * on-us payments. Once real, this becomes a SOAP/REST/ISO 8583 client
 * against the actual bank; today it's simulated so the rest of the QR
 * payment flow can be built and tested against a realistic contract.
 *
 * @typedef {Object} CbsPostingResult
 * @property {string} cbsRef
 * @property {"posted"|"failed"} status
 * @property {string} [failureReason]
 */
class CbsProvider {
  /**
   * Debits the wallet settlement/control account by `amount` — step 3-4 of
   * both the on-us and off-us flows (post the wallet-side movement in CBS).
   * @param {{ reference: string, amount: number, narrative: string }} params
   * @returns {Promise<CbsPostingResult>}
   */
  async debitSettlementAccount(params) {
    throw new Error("debitSettlementAccount not implemented");
  }

  /**
   * Credits the merchant's account held with the partner bank — on-us
   * flow step 5 only.
   * @param {{ reference: string, merchantAccountRef: string, amount: number, narrative: string }} params
   * @returns {Promise<CbsPostingResult>}
   */
  async creditMerchantAccount(params) {
    throw new Error("creditMerchantAccount not implemented");
  }

  /**
   * Debits the settlement account into the bank's TIPS transit account —
   * off-us flow step 5, ahead of routing through TIPS.
   * @param {{ reference: string, amount: number, narrative: string }} params
   * @returns {Promise<CbsPostingResult>}
   */
  async debitToTipsTransitAccount(params) {
    throw new Error("debitToTipsTransitAccount not implemented");
  }

  /** Reverses a prior posting by its cbsRef. */
  async reverse(cbsRef, reason) {
    throw new Error("reverse not implemented");
  }
}

module.exports = { CbsProvider };
