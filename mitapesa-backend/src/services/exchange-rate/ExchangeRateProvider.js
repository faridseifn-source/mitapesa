/**
 * Every exchange rate provider implements this same shape.
 */
class ExchangeRateProvider {
  /**
   * @param {string} from - ISO 4217 code, e.g. "USD"
   * @param {string} to - ISO 4217 code, e.g. "TZS"
   * @returns {Promise<number>} how many units of `to` one unit of `from` is worth
   */
  // eslint-disable-next-line no-unused-vars
  async getRate(from, to) {
    throw new Error("Not implemented");
  }
}

module.exports = { ExchangeRateProvider };
