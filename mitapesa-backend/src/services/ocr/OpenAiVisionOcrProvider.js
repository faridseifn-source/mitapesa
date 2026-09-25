const { OcrProvider } = require("./OcrProvider");

/**
 * Real receipt extraction via OpenAI's vision-capable chat completions API.
 * Deliberately uses a vision LLM rather than a plain OCR engine (e.g.
 * Tesseract/Cloud Vision) — a plain OCR engine returns raw text that still
 * needs separate parsing logic to find "which line is the total" or "which
 * line is the merchant name," which is exactly the kind of brittle,
 * receipt-format-specific logic a vision model handles natively in one
 * call, and it can pick from the customer's own category list directly
 * rather than needing a second matching step.
 *
 * IMPORTANT — a real, disclosed limitation of this implementation: this
 * was built and reviewed without the ability to make a live test call
 * against OpenAI's API (no network access in the development sandbox this
 * was built in). The request/response shape below matches OpenAI's
 * documented Chat Completions + vision + JSON-mode API as of this
 * writing, but the first real deploy is the actual first live test of
 * this exact code path. Treat any failure here as "check the Render logs
 * for the raw OpenAI error," not "assume the whole feature is broken."
 */
class OpenAiVisionOcrProvider extends OcrProvider {
  constructor({ apiKey }) {
    super();
    this.apiKey = apiKey;
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
      "Respond with ONLY the JSON object, no other text. If the image doesn't look like a receipt at all, set every field to null and confidence to 0.",
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
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`OpenAI OCR request failed (${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("OpenAI OCR response had no content");

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OpenAI OCR response wasn't valid JSON: ${raw.slice(0, 200)}`);
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

module.exports = { OpenAiVisionOcrProvider };
