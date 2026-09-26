const { TranscriptionProvider } = require("./TranscriptionProvider");

/**
 * Used when no real transcription provider is configured (local dev
 * without an API key, or the feature deliberately turned off). Returns an
 * honest empty result rather than a fabricated-looking transcript.
 */
class MockTranscriptionProvider extends TranscriptionProvider {
  // eslint-disable-next-line no-unused-vars
  async transcribe({ audioBase64, mimeType, language, durationSeconds }) {
    return { text: "", estimatedCostUsd: 0 };
  }
}

module.exports = { MockTranscriptionProvider };
