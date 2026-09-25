const env = require("../../lib/env");
const { MockAnalyticsAssistantProvider } = require("./MockAnalyticsAssistantProvider");

let instance;

function getAnalyticsAssistantProvider() {
  if (instance) return instance;

  switch (env.providers.analytics) {
    case "openai": {
      const { OpenAiAnalyticsAssistantProvider } = require("./OpenAiAnalyticsAssistantProvider");
      // Reuses the same OPENAI_API_KEY as voiceParser/transcription/OCR
      // — one shared key across every OpenAI-backed feature in this app,
      // not a separate credential per feature.
      if (!env.voiceParser.openaiApiKey) throw new Error("ANALYTICS_PROVIDER=openai requires OPENAI_API_KEY to be set");
      instance = new OpenAiAnalyticsAssistantProvider({ apiKey: env.voiceParser.openaiApiKey });
      break;
    }
    case "mock":
    default:
      instance = new MockAnalyticsAssistantProvider();
  }
  return instance;
}

module.exports = { getAnalyticsAssistantProvider };
