const { TranscriptionProvider } = require("./TranscriptionProvider");

// Common formats a browser's MediaRecorder (or a native recording,
// re-encoded client-side) is likely to produce — used only to give the
// uploaded file a sensible extension; OpenAI's endpoint reads the actual
// audio format from the file content itself, not the filename.
const EXTENSION_BY_MIME = {
  "audio/webm": "webm",
  "audio/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
};

/**
 * Real audio transcription via OpenAI's dedicated /v1/audio/transcriptions
 * endpoint — a genuinely different API shape from the chat completions
 * endpoint the other providers in this app use: this one is a
 * multipart/form-data file upload, not a JSON request, since it's
 * actually sending an audio file rather than describing one.
 *
 * Deliberately not Apple's or Android's own on-device speech engine —
 * confirmed in testing that Apple's SFSpeechRecognizer (what the native
 * voice-logging feature used until now) has no Swahili model at all, and
 * more broadly only supports a few dozen languages total, explicitly
 * excluding African languages. Sending the raw audio to a cloud model
 * instead sidesteps whatever language support happens to be built into
 * the customer's specific device and OS version — the same architectural
 * choice Anthropic's own Claude apps make for voice input, confirmed
 * directly from their own documentation: audio is streamed to a server
 * for transcription rather than processed on-device.
 *
 * IMPORTANT — a real, disclosed limitation of this implementation, same
 * posture as this app's other AI providers: built and reviewed without
 * the ability to make a live test call against OpenAI's API (no network
 * access in the development sandbox this was built in), and additionally
 * without the ability to record real audio in a Capacitor WebView to
 * confirm what MIME type and format actually gets produced on each
 * platform. The request shape below matches OpenAI's documented
 * multipart transcription API as of this writing, but the first real
 * deploy is the actual first live test of this exact code path — treat
 * any failure as "check the Render logs for the raw error and the
 * client's actual reported MIME type," not "assume the whole feature is
 * broken."
 */
// Pricing constants, verified against multiple current sources as of this
// writing — gpt-4o-mini-transcribe is $1.25 per million input tokens and
// $5 per million output tokens, which OpenAI's own docs also express as
// roughly $0.003/minute for typical speech. Both are used below: the
// per-token rate when the API response includes actual usage counts (the
// accurate path), and the per-minute rate as a fallback using the
// customer's own device-reported recording length, for the rare case the
// response doesn't include token usage. Kept as named constants, not
// inlined, since this is exactly the kind of number that goes stale —
// worth checking against OpenAI's current pricing page periodically.
const INPUT_COST_PER_TOKEN = 1.25 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 5 / 1_000_000;
const FALLBACK_COST_PER_MINUTE = 0.003;

class OpenAiTranscriptionProvider extends TranscriptionProvider {
  constructor({ apiKey }) {
    super();
    this.apiKey = apiKey;
  }

  async transcribe({ audioBase64, mimeType, language, durationSeconds }) {
    const audioBuffer = Buffer.from(audioBase64, "base64");
    // Browsers commonly report MediaRecorder's actual type with codec
    // parameters attached — e.g. "audio/mp4;codecs=mp4a.40.2", not the
    // plain "audio/mp4" this app's own EXTENSION_BY_MIME table keys on.
    // Confirmed happening in testing: an unstripped codec suffix meant
    // no table entry matched, so the file got labeled .webm regardless
    // of its real container format — a real mp4/AAC recording mislabeled
    // as webm, which OpenAI correctly refused to parse ("Audio file
    // might be corrupted or unsupported"). The base type before any ";"
    // is what actually determines the container/codec, so that's the
    // only part used for both the lookup and the Blob's own type below.
    const baseMimeType = (mimeType || "").split(";")[0].trim();
    const extension = EXTENSION_BY_MIME[baseMimeType] || "webm";
    const blob = new Blob([audioBuffer], { type: baseMimeType || "audio/webm" });

    const form = new FormData();
    form.append("file", blob, `recording.${extension}`);
    // gpt-4o-mini-transcribe — the newer, generally more accurate
    // successor to whisper-1 on the same endpoint, and consistent with
    // this app's other providers already using the "mini" tier of
    // OpenAI's models for cost reasons.
    form.append("model", "gpt-4o-mini-transcribe");
    // A hint, not a hard requirement — OpenAI's docs note the model can
    // detect the language on its own, but passing it when known (this
    // app always knows it, from the customer's own language toggle)
    // improves accuracy, particularly for a less-common language like
    // Swahili where auto-detection is more likely to guess wrong.
    if (language) form.append("language", language);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      // No Content-Type header set manually — fetch derives the correct
      // multipart/form-data boundary automatically from the FormData body.
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`OpenAI transcription request failed (${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const text = typeof data?.text === "string" ? data.text.trim() : "";

    // Prefer the API's own reported token usage when present — this is
    // the actual, real basis for what OpenAI bills, not an approximation.
    // A disclosed uncertainty, same posture as the rest of this file: it
    // isn't confirmed from a live call whether this endpoint's response
    // reliably includes a usage object the way chat completions does, so
    // this falls back to the duration-based estimate whenever it's
    // missing, rather than assuming a shape that turns out to be wrong.
    let estimatedCostUsd;
    const usage = data?.usage;
    if (usage && (typeof usage.input_tokens === "number" || typeof usage.prompt_tokens === "number")) {
      const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
      const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
      estimatedCostUsd = inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN;
    } else {
      const minutes = (Number(durationSeconds) || 0) / 60;
      estimatedCostUsd = minutes * FALLBACK_COST_PER_MINUTE;
    }

    return { text, estimatedCostUsd };
  }
}

module.exports = { OpenAiTranscriptionProvider };
