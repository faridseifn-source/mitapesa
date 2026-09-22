const env = require("../../lib/env");
const { MockVoiceParserProvider } = require("./MockVoiceParserProvider");

let instance;

function getVoiceParserProvider() {
  if (instance) return instance;

  switch (env.providers.voiceParser) {
    case "openai": {
      const { OpenAiVoiceParserProvider } = require("./OpenAiVoiceParserProvider");
      if (!env.voiceParser.openaiApiKey) throw new Error("VOICE_PARSER_PROVIDER=openai requires OPENAI_API_KEY to be set");
      instance = new OpenAiVoiceParserProvider({ apiKey: env.voiceParser.openaiApiKey });
      break;
    }
    case "mock":
    default:
      instance = new MockVoiceParserProvider();
  }
  return instance;
}

module.exports = { getVoiceParserProvider };
