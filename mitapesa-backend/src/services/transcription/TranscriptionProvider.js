/**
 * Every audio transcription provider implements this same shape, so the
 * route that calls it never needs to know which one is active.
 */
class TranscriptionProvider {
  /**
   * @param {object} params
   * @param {string} params.audioBase64 - raw base64 audio data (no data:
   *   URL prefix)
   * @param {string} params.mimeType - e.g. "audio/webm", "audio/mp4"
   * @param {string} [params.language] - ISO 639-1 hint (e.g. "en", "sw")
   *   if the customer indicated which language they're speaking — a
   *   hint, not a hard requirement; a real provider should still attempt
   *   transcription without one.
   * @returns {Promise<{text: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async transcribe({ audioBase64, mimeType, language }) {
    throw new Error("Not implemented");
  }
}

module.exports = { TranscriptionProvider };
