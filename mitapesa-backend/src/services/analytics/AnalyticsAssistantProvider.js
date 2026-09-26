/**
 * Turns a customer's free-text question about their own expense data into
 * two things, in two separate stages: first a structured, constrained
 * query (interpretQuestion) — never raw SQL, never free-form code, so it
 * can be validated and safely executed by our own query logic rather
 * than trusted directly — and second, once that query has actually been
 * run against the real database, a plain-language executive summary of
 * the real, computed results (summarizeResults). The model never
 * computes a number itself; it only decides what to ask for and how to
 * explain the answer. This split exists specifically so a customer can
 * never be shown a spending figure the model invented or miscalculated
 * — every number in the final answer traces back to an actual database
 * query, not the model's own arithmetic.
 */
class AnalyticsAssistantProvider {
  /**
   * @param {object} params
   * @param {string} params.question - the customer's own words
   * @param {string} params.today - YYYY-MM-DD, so relative periods
   *   ("this month", "last 3 months") can be resolved to real dates
   * @param {string[]} params.categoryNames - this customer's actual
   *   category names, so categoryFilter (if set) matches something real
   * @returns {Promise<{querySpec: object, estimatedCostUsd: number}>}
   */
  // eslint-disable-next-line no-unused-vars
  async interpretQuestion({ question, today, categoryNames }) {
    throw new Error("Not implemented");
  }

  /**
   * @param {object} params
   * @param {string} params.question - the customer's original question,
   *   for tone/framing only — never a source of numbers
   * @param {object} params.querySpec - what was actually asked for
   * @param {object} params.results - the real, computed results from our
   *   own database query — the only source of numbers this may reference
   * @returns {Promise<{summary: string, estimatedCostUsd: number}>}
   */
  // eslint-disable-next-line no-unused-vars
  async summarizeResults({ question, querySpec, results }) {
    throw new Error("Not implemented");
  }
}

module.exports = { AnalyticsAssistantProvider };
