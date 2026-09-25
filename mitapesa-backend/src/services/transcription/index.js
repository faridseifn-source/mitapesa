const env = require("../../lib/env");
const { MockTranscriptionProvider } = require("./MockTranscriptionProvider");

let instance;

function getTranscriptionProvider() {
  if (instance) return instance;

  switch (env.providers.transcription) {
    case "openai": {
      const { OpenAiTranscriptionProvider } = require("./OpenAiTranscriptionProvider");
      if (!env.transcription.openaiApiKey) throw new Error("TRANSCRIPTION_PROVIDER=openai requires OPENAI_API_KEY to be set");
      instance = new OpenAiTranscriptionProvider({ apiKey: env.transcription.openaiApiKey });
      break;
    }
    case "mock":
    default:
      instance = new MockTranscriptionProvider();
  }
  return instance;
}

module.exports = { getTranscriptionProvider };
