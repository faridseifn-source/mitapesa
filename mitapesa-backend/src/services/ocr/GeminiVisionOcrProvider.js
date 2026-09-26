const { OcrProvider } = require("./OcrProvider");

/**
 * Real receipt extraction via Google's Gemini API (Generative Language
 * API, generateContent endpoint) — same task as OpenAiVisionOcrProvider,
 * different provider, chosen specifically because Gemini's Flash/
 * Flash-Lite models retain a genuine free tier (no card required to
 * start), unlike OpenAI's pay-as-you-go-only API.
 *
 * IMPORTANT — same disclosed limitation as the OpenAI provider: this was
 * built and reviewed without the ability to make a live test call against
 * Google's API (no network access in the development sandbox this was
 * built in). The request/response shape below matches Gemini's documented
 * generateContent API as of this writing, but the first real deploy is
 * the actual first live test of this exact code path. Treat any failure
 * here as "check the Render logs for the raw Gemini error," not "assume
 * the whole feature is broken."
 *
 * A second, separate risk worth knowing about specifically for this
 * provider: Gemini model names and free-tier availability have changed
 * more than once in 2026 (e.g. Gemini 2.0 Flash was retired June 1,
 * 2026). GEMINI_OCR_MODEL is a real environment variable specifically so
 * the model can be updated without a code change if Google renames or
 * retires the default model again — check ai.google.dev's current model
 * list if extraction starts failing with a "model not found"-style error.
 */
class GeminiVisionOcrProvider extends OcrProvider {
  constructor({ apiKey, model }) {
    super();
    this.apiKey = apiKey;
    this.model = model || "gemini-3.5-flash-lite";
  }

  async extractReceipt({ imageBase64, mimeType, categoryNames }) {
    const categoryList = categoryNames.length ? categoryNames.join(", ") : "Other";
    const prompt = [
      "You are reading a photo of a purchase receipt for a personal finance app.",
      "Extract exactly these fields as a JSON object:",
      '- "merchant": the business/vendor name as printed on the receipt (string, or null if genuinely not legible)',
      '- "amount": the final TOTAL amount paid, as a plain number with no currency symbol or thousands separators (or null if not legible)',
      '- "currency": the ISO 4217 three-letter currency code for the amount above (e.g. "TZS", "USD", "KES", "ZAR", "EUR", "GBP", "UGX") — infer it from any currency symbol, code, or contextual clue on the receipt (e.g. a Kenyan shilling sign or "KSh" means "KES", a Tanzanian shilling sign or "TSh" means "TZS"). If genuinely not determinable, use "TZS".',
      '- "date": the transaction date in YYYY-MM-DD format if printed on the receipt, else null',
      `- "category": pick the single best-fitting category from exactly this list (copy the text exactly): [${categoryList}]. If nothing fits well, use "Other" if it's in the list, otherwise null.`,
      '- "confidence": your own honest confidence in this extraction as a whole number from 0 to 100',
      "Respond with ONLY the JSON object, no other text, no markdown code fences. If the image doesn't look like a receipt at all, set every field to null and confidence to 0.",
    ].join("\n");

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
            ],
          },
        ],
        generationConfig: {
          response_mime_type: "application/json",
          maxOutputTokens: 300,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Gemini OCR request failed (${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      // A blocked/empty response (e.g. safety filtering) looks like this
      // rather than a non-2xx status — worth a distinct error message so
      // it doesn't get misread as "image unreadable" during debugging.
      const blockReason = data?.promptFeedback?.blockReason;
      throw new Error(blockReason ? `Gemini blocked this request: ${blockReason}` : "Gemini OCR response had no content");
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Gemini OCR response wasn't valid JSON: ${raw.slice(0, 200)}`);
    }

    return {
      merchant: typeof parsed.merchant === "string" ? parsed.merchant.trim() || null : null,
      amount: typeof parsed.amount === "number" && parsed.amount >= 0 ? parsed.amount : null,
      currency: typeof parsed.currency === "string" && /^[A-Z]{3}$/.test(parsed.currency) ? parsed.currency : "TZS",
      date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null,
      category: typeof parsed.category === "string" && categoryNames.includes(parsed.category) ? parsed.category : null,
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null,
    };
  }
}

module.exports = { GeminiVisionOcrProvider };
