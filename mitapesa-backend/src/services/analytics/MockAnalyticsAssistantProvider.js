const { AnalyticsAssistantProvider } = require("./AnalyticsAssistantProvider");

/**
 * Used when no real analytics provider is configured (local dev without
 * an API key, or the feature deliberately turned off). Always resolves
 * to "unsupported" with an honest explanation rather than fabricating a
 * plausible-looking query or summary — same principle as every other
 * mock provider in this app: never pretend to be a real AI result.
 */
class MockAnalyticsAssistantProvider extends AnalyticsAssistantProvider {
  // eslint-disable-next-line no-unused-vars
  async interpretQuestion({ question, today, categoryNames }) {
    return {
      querySpec: { intent: "unsupported", clarification: "AI analytics is not configured on this server (mock provider active)." },
      estimatedCostUsd: 0,
    };
  }

  // eslint-disable-next-line no-unused-vars
  async summarizeResults({ question, querySpec, results }) {
    return { summary: "AI analytics is not configured on this server (mock provider active).", estimatedCostUsd: 0 };
  }
}

module.exports = { MockAnalyticsAssistantProvider };
