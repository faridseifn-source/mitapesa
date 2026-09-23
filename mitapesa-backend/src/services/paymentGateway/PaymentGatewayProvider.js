/**
 * Every payment gateway provider implements this same shape, so the
 * route that calls it never needs to know which one is active. This is
 * deliberately a separate service from anything involving the partner
 * bank's prepaid card wallet (see cardHelpers.js and the pay_module_
 * enabled setting) — that relationship requires the partner bank to be
 * onboarded and to expose its prepaid cards for this purpose, neither of
 * which is ready. A payment gateway is a different, standard merchant-
 * acquiring relationship: MitaPesa is the merchant, the customer pays
 * with their own existing bank card, and no partner bank involvement is
 * needed at all — which is exactly why this can be built and used
 * (initially with the mock provider below) well before that banking
 * partnership is finalized.
 */
class PaymentGatewayProvider {
  /**
   * @param {object} params
   * @param {string} params.userId - MitaPesa's own customer ID, so a real
   *   provider can look up or create its own corresponding customer/card
   *   record for repeat charges.
   * @param {number} params.amountTzs - the amount to charge, in TZS.
   * @param {string} params.description - shown on the gateway's own
   *   dashboard/receipt, for reconciliation — not shown to the customer
   *   by this app itself.
   * @returns {Promise<{success: boolean, gatewayReference: string|null, failureReason: string|null}>}
   */
  // eslint-disable-next-line no-unused-vars
  async chargeCard({ userId, amountTzs, description }) {
    throw new Error("Not implemented");
  }
}

module.exports = { PaymentGatewayProvider };
