const { VoiceParserProvider } = require("./VoiceParserProvider");

/**
 * Used when no real voice-parsing provider is configured (local dev
 * without an API key, or the feature deliberately turned off). Returns a
 * clearly-labeled, honest result rather than a fabricated-looking
 * expense — the voice.routes.js layer is what actually decides whether
 * this should surface as "unavailable" to the customer; this class's own
 * job is just to never pretend to be a real extraction.
 */
class MockVoiceParserProvider extends VoiceParserProvider {
  // eslint-disable-next-line no-unused-vars
  async parseExpenses({ transcript, categoryNames, today }) {
    return {
      expenses: [],
      warnings: ["Voice parsing provider is not configured (mock provider active) — no real extraction was performed."],
    };
  }
}

module.exports = { MockVoiceParserProvider };
