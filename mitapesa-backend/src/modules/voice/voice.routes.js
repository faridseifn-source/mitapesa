const { Router } = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { forbidden, badRequest } = require("../../lib/errors");
const { getSetting } = require("../../lib/settings");
const { getVoiceParserProvider } = require("../../services/voiceParser");
const { getTranscriptionProvider } = require("../../services/transcription");
const { convertToTZS } = require("../../lib/currencyConversion");
const { writeAudit } = require("../../lib/audit");

const router = Router();
router.use(requireAuth);

// Same rationale as receipts.routes.js's scanLimiter — a real provider
// call costs real money per request, rate limited separately from the
// general API limits against an accidental client-side retry loop. Kept
// as a single limiter covering the whole /parse request even though it
// may now make two real API calls internally (transcription, then
// parsing) — both happen within the one customer action of logging a
// voice expense, so limiting per-request rather than per-provider-call
// is what actually reflects customer-facing usage.
const parseLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// Accepts either a transcript directly (the website's browser-based
// speech recognition already produces text client-side, nothing further
// to transcribe) or raw recorded audio (the installed app's own path —
// records audio rather than relying on the phone's native speech engine,
// since that engine's language support varies by device and, for iOS
// specifically, confirmed in testing to have no Swahili model at all).
// Exactly one of the two must be present — a request with both or
// neither is rejected rather than guessing which was intended.
const parseRequestSchema = z.object({
  transcript: z.string().min(1).max(2000).optional(),
  audioBase64: z.string().min(100).optional(), // a real recording is always far larger than this; guards against an empty/near-empty payload
  mimeType: z.string().optional(),
  language: z.string().min(2).max(5).optional(), // ISO 639-1 hint, e.g. "en" or "sw"
}).refine((data) => Boolean(data.transcript) !== Boolean(data.audioBase64), {
  message: "Provide exactly one of transcript or audioBase64, not both or neither.",
});

// POST /voice/parse { transcript } | { audioBase64, mimeType, language? }
// — extracts one or more expenses from spoken input (English, Swahili, or
// a natural mix of both), each with merchant, amount, currency, date,
// category, and note. Every extracted amount is converted to and stored
// in TZS, same policy as receipt scanning — the response discloses the
// conversion per expense rather than silently presenting a converted
// number as if it were what the customer actually said. Never falls back
// to placeholder data on failure or when disabled — either a real
// extraction, or a clear "unavailable" signal for the client, same
// posture as receipts.routes.js.
router.post(
  "/parse",
  parseLimiter,
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("voice_parsing_enabled")) !== "false";
    if (!enabled) throw forbidden("Voice logging is currently turned off — please add this expense manually.");

    const input = parseRequestSchema.parse(req.body);

    let transcript = input.transcript;
    if (input.audioBase64) {
      try {
        const { text } = await getTranscriptionProvider().transcribe({
          audioBase64: input.audioBase64,
          mimeType: input.mimeType || "audio/webm",
          language: input.language,
        });
        transcript = text;
      } catch (err) {
        console.error("Voice audio transcription failed:", err.message); // eslint-disable-line no-console
        throw badRequest("We couldn't hear that clearly — please try again, or add this expense manually.");
      }
      if (!transcript) {
        // A genuinely empty transcript (silence, or a provider that
        // couldn't make out anything at all) isn't an error — it's an
        // honest "nothing to parse" result, same as the OCR provider
        // never fabricating a receipt read from a blank image.
        return res.json({ transcript: "", expenses: [], warnings: [] });
      }
    }

    const categories = await prisma.category.findMany({ where: { OR: [{ userId: null }, { userId: req.userId }] }, select: { name: true } });
    const categoryNames = categories.map((c) => c.name);
    const today = new Date().toISOString().slice(0, 10);

    let result;
    try {
      result = await getVoiceParserProvider().parseExpenses({ transcript, categoryNames, today });
    } catch (err) {
      console.error("Voice expense parsing failed:", err.message); // eslint-disable-line no-console
      throw badRequest("We couldn't make sense of that — please try again, or add this expense manually.");
    }

    const expenses = [];
    for (const e of result.expenses) {
      let converted = { amount: e.amount, originalAmount: null, originalCurrency: null, exchangeRate: null };
      let conversionFailed = false;
      if (e.amount !== null && e.currency && e.currency !== "TZS") {
        try {
          converted = await convertToTZS({ amount: e.amount, currency: e.currency });
        } catch (err) {
          // The extraction itself succeeded for this entry — don't throw
          // it away just because the conversion step failed. Surface the
          // original, unconverted amount and let the customer confirm the
          // TZS equivalent themselves, same as receipts.routes.js.
          console.error("Currency conversion failed after successful voice parse:", err.message); // eslint-disable-line no-console
          conversionFailed = true;
        }
      }
      expenses.push({
        merchant: e.merchant,
        amount: converted.amount, // always TZS
        originalAmount: converted.originalAmount,
        originalCurrency: converted.originalCurrency,
        exchangeRate: converted.exchangeRate,
        conversionFailed,
        date: e.date,
        category: e.category,
        note: e.note,
        confidence: e.confidence,
      });
    }

    await writeAudit(req.userId, "voice.parsed", {
      ip: req.ip, expenseCount: expenses.length, warnings: result.warnings.length, viaAudio: Boolean(input.audioBase64),
    });

    // transcript is echoed back so the client can show what it actually
    // heard — necessary now that audio-based requests don't have the
    // text client-side at all until this response arrives.
    res.json({ transcript, expenses, warnings: result.warnings });
  })
);

module.exports = router;
