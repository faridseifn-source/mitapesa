const { VoiceParserProvider } = require("./VoiceParserProvider");

/**
 * Real expense extraction from a spoken transcript, via OpenAI's chat
 * completions API. Deliberately uses a real language model rather than
 * regex/keyword matching — the previous approach (parseVoiceExpense on
 * the frontend) only recognized an expense if it happened to match a
 * handful of rigid patterns ("at <Capitalized Name>", a bare number, a
 * literal category name or keyword in the sentence), which broke on
 * ordinary natural phrasing, spoken number words, and anything not in
 * English. A real model genuinely understands the sentence instead of
 * pattern-matching it — including Swahili, English, and the natural mix
 * of both a Tanzanian customer is likely to actually speak, and multiple
 * expenses said in one breath ("5,000 on lunch and 2,000 on the bajaji"),
 * which a single-pass regex could never separate correctly.
 *
 * IMPORTANT — a real, disclosed limitation of this implementation: this
 * was built and reviewed without the ability to make a live test call
 * against OpenAI's API (no network access in the development sandbox this
 * was built in). The request/response shape below matches OpenAI's
 * documented Chat Completions + JSON-mode API as of this writing, but the
 * first real deploy is the actual first live test of this exact code
 * path. Treat any failure here as "check the Render logs for the raw
 * OpenAI error," not "assume the whole feature is broken." Same posture
 * as OpenAiVisionOcrProvider before its own first live use.
 */
class OpenAiVoiceParserProvider extends VoiceParserProvider {
  constructor({ apiKey }) {
    super();
    this.apiKey = apiKey;
  }

  async parseExpenses({ transcript, categoryNames, today }) {
    const categoryList = categoryNames.length ? categoryNames.join(", ") : "Other";
    const prompt = [
      "You are reading a transcript of a Tanzanian customer speaking out loud to log one or more personal expenses (or, occasionally, income) into a finance app.",
      "The customer may speak in English, Swahili, or a natural mix of both in the same sentence — this is completely normal for how people actually talk in Tanzania, not an error to flag. Understand spoken number words in either language (e.g. \"ten thousand\", \"elfu kumi\", \"elfu tano na mia mbili\") the same as digits.",
      `Today's date is ${today}. Resolve any relative date the customer says (\"yesterday\", \"jana\", \"today\", \"leo\", \"this morning\", \"asubuhi hii\") into an actual YYYY-MM-DD date using that. If no date or time reference is said at all, use today's date.`,
      "The customer may describe more than one expense in a single transcript (e.g. \"nilitumia elfu tano kwa chakula na elfu mbili kwa bajaji\" — two separate expenses, food and a bajaji fare). Extract every distinct expense you can genuinely identify as its own entry — do not merge separate purchases into one, and do not split one purchase into several.",
      "Extract a JSON object with exactly one key, \"expenses\", an array. Each entry in the array must have exactly these fields:",
      '- "amount": the amount for this one expense, as a plain number with no currency symbol or thousands separators (or null if genuinely not stated for this entry)',
      '- "currency": the ISO 4217 three-letter currency code (almost always "TZS" for a Tanzanian customer speaking casually; only use another code if a foreign currency was explicitly named)',
      '- "merchant": the vendor, place, or person named, in properly capitalized form (e.g. "Cafe Roma", not "cafe roma") — or null if genuinely not said',
      `- "category": pick the single best-fitting category from exactly this list (copy the text exactly): [${categoryList}]. If nothing fits well, use "Other" if it's in the list, otherwise null.`,
      '- "date": YYYY-MM-DD, resolved per the instructions above',
      '- "note": a short (under 10 words) plain-English restatement of what this expense was for, if the customer gave any detail beyond just the category — or null',
      '- "confidence": your own honest confidence in this one entry as a whole number from 0 to 100',
      "If the transcript doesn't describe any identifiable expense at all (silence, an unrelated remark, pure noise), return an empty array for \"expenses\" — never invent an entry to fill the response.",
      "Respond with ONLY the JSON object, no other text.",
    ].join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        max_tokens: 800, // several expenses per transcript need more room than a single receipt read
        messages: [
          { role: "user", content: [{ type: "text", text: `${prompt}\n\nTranscript: "${transcript}"` }] },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`OpenAI voice-parse request failed (${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("OpenAI voice-parse response had no content");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OpenAI voice-parse response wasn't valid JSON: ${raw.slice(0, 200)}`);
    }

    const rawExpenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const expenses = rawExpenses
      .map((e) => ({
        amount: typeof e?.amount === "number" && e.amount >= 0 ? e.amount : null,
        currency: typeof e?.currency === "string" && /^[A-Z]{3}$/.test(e.currency) ? e.currency : "TZS",
        merchant: typeof e?.merchant === "string" ? e.merchant.trim() || null : null,
        category: typeof e?.category === "string" && categoryNames.includes(e.category) ? e.category : null,
        date: typeof e?.date === "string" && dateRe.test(e.date) ? e.date : today,
        note: typeof e?.note === "string" ? e.note.trim().slice(0, 200) || null : null,
        confidence: typeof e?.confidence === "number" ? Math.max(0, Math.min(100, Math.round(e.confidence))) : null,
      }))
      // An entry with no amount at all isn't a usable expense — drop it
      // rather than hand the customer a blank row to fill in themselves,
      // same principle as the OCR provider never fabricating a value.
      .filter((e) => e.amount !== null);

    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w) => typeof w === "string").slice(0, 5) : [];

    // gpt-4o-mini: $0.15/M input tokens, $0.60/M output tokens, verified
    // against multiple current sources. Chat completions responses
    // reliably include a usage object (well-established, standard OpenAI
    // API behavior, more certain than the transcription endpoint's
    // response shape) — no fallback estimate needed the way the
    // transcription provider has one.
    const usage = data?.usage;
    const estimatedCostUsd = usage
      ? (usage.prompt_tokens || 0) * (0.15 / 1_000_000) + (usage.completion_tokens || 0) * (0.60 / 1_000_000)
      : 0;

    return { expenses, warnings, estimatedCostUsd };
  }
}

module.exports = { OpenAiVoiceParserProvider };
