/**
 * Every voice-parsing provider implements this same shape, so the route
 * that calls it never needs to know which one is active.
 */
class VoiceParserProvider {
  /**
   * @param {object} params
   * @param {string} params.transcript - the raw speech-to-text transcript,
   *   as spoken by the customer — may be in English, Swahili, or a natural
   *   mix of both, and may describe more than one expense in one breath.
   * @param {string[]} params.categoryNames - the customer's own category
   *   names, so a real provider can pick from what they actually use
   *   instead of guessing a generic category that doesn't exist for them.
   * @param {string} params.today - today's date as YYYY-MM-DD, so the
   *   provider can resolve relative dates the customer actually says
   *   ("yesterday", "jana", "this morning") into real dates rather than
   *   leaving that translation to a second parsing pass.
   * @returns {Promise<{expenses: Array<{amount: number|null, currency: string, merchant: string|null, category: string|null, date: string|null, note: string|null, confidence: number|null}>, warnings: string[], estimatedCostUsd: number}>}
   *   expenses is an array deliberately, even for a single-expense
   *   transcript — a customer logging their whole day at once ("5,000 on
   *   lunch and 2,000 on the bajaji") is a first-class case, not an edge
   *   case bolted on later. warnings carries anything the provider wants
   *   to surface but isn't itself a hard failure (e.g. "heard an amount
   *   but couldn't make out what it was for").
   */
  // eslint-disable-next-line no-unused-vars
  async parseExpenses({ transcript, categoryNames, today }) {
    throw new Error("Not implemented");
  }
}

module.exports = { VoiceParserProvider };
