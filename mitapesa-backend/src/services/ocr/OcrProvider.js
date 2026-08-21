/**
 * Every OCR provider implements this same shape, so the route that calls
 * it never needs to know which one is active.
 */
class OcrProvider {
  /**
   * @param {object} params
   * @param {string} params.imageBase64 - raw base64 image data (no data: URL prefix)
   * @param {string} params.mimeType - e.g. "image/jpeg"
   * @param {string[]} params.categoryNames - the customer's own category
   *   names, so a real provider can pick from what they actually use
   *   instead of guessing a generic category that doesn't exist for them.
   * @returns {Promise<{merchant: string|null, amount: number|null, currency: string, date: string|null, category: string|null, confidence: number|null}>}
   */
  // eslint-disable-next-line no-unused-vars
  async extractReceipt({ imageBase64, mimeType, categoryNames }) {
    throw new Error("Not implemented");
  }
}

module.exports = { OcrProvider };
