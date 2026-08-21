/**
 * Contract for the prepaid card program manager — the Card Management
 * System (CMS), e.g. Marqeta/Galileo/i2c-style, or a sponsor bank's own
 * issuing platform. Once real, this provider is the source of truth for
 * balance and authorizations — our DB's `Card`/`VirtualCard` rows become a
 * cache updated via webhook, not the ledger of record.
 *
 * Every card-creating and card-controlling action in the app — for both the
 * primary card and add-on cards — is meant to route through this single
 * interface, so a real CMS integration is a one-file swap (a new class
 * implementing this same contract) rather than a scattered rewrite.
 *
 * @typedef {Object} CardSnapshot
 * @property {string} externalCardId
 * @property {number} balance
 * @property {boolean} frozen
 * @property {Object} controls
 *
 * @typedef {Object} VirtualCardSnapshot
 * @property {string} id
 * @property {string} last4
 * @property {string} expiry
 */
class CardIssuingProvider {
  /** @param {{ userId: string, holderName: string }} params @returns {Promise<CardSnapshot>} */
  async issueCard(params) {
    throw new Error("issueCard not implemented");
  }

  /**
   * Requests a new add-on (sub-)card from the CMS — either parent-linked or
   * independent. A real CMS call here is the "send request to generate
   * virtual card" step.
   * @param {{ walletId: string, ownerId: string, holderId: string, type: "parent_linked"|"independent", label?: string }} params
   * @returns {Promise<VirtualCardSnapshot>}
   */
  async issueVirtualCard(params) {
    throw new Error("issueVirtualCard not implemented");
  }

  /** @param {string} externalCardId @returns {Promise<CardSnapshot>} */
  async getBalance(externalCardId) {
    throw new Error("getBalance not implemented");
  }

  /** @param {string} externalCardId @param {boolean} frozen */
  async setFrozen(externalCardId, frozen) {
    throw new Error("setFrozen not implemented");
  }

  /** @param {string} externalCardId @param {Object} controls e.g. { online, contactless, atm } */
  async setControls(externalCardId, controls) {
    throw new Error("setControls not implemented");
  }

  /** @param {string} externalCardId @param {number} dailyLimit */
  async setDailyLimit(externalCardId, dailyLimit) {
    throw new Error("setDailyLimit not implemented");
  }

  /** @param {string} externalCardId @param {{ type: string, amount: number, label: string }} params — debit against card balance
   * @param {import("@prisma/client").PrismaClient} [client] optional interactive-transaction client for atomic card-to-card transfers */
  async debit(externalCardId, params, client) {
    throw new Error("debit not implemented");
  }
}

module.exports = { CardIssuingProvider };
