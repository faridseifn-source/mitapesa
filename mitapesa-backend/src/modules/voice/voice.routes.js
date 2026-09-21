const { Router } = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { forbidden, badRequest } = require("../../lib/errors");
const { getSetting } = require("../../lib/settings");
const { getVoiceParserProvider } = require("../../services/voiceParser");
const { convertToTZS } = require("../../lib/currencyConversion");
const { writeAudit } = require("../../lib/audit");

const router = Router();
router.use(requireAuth);

// Same rationale as receipts.routes.js's scanLimiter — a real provider
// call costs real money per request, rate limited separately from the
// general API limits against an accidental client-side retry loop.
const parseLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// POST /voice/parse { transcript } — extracts one or more expenses from a
// spoken transcript (English, Swahili, or a natural mix of both), each
// with merchant, amount, currency, date, category, and note. Every
// extracted amount is converted to and stored in TZS, same policy as
// receipt scanning — the response discloses the conversion per expense
// rather than silently presenting a converted number as if it were what
// the customer actually said. Never falls back to placeholder data on
// failure or when disabled — either a real extraction, or a clear
// "unavailable" signal for the client, same posture as receipts.routes.js.
router.post(
  "/parse",
  parseLimiter,
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("voice_parsing_enabled")) !== "false";
    if (!enabled) throw forbidden("Voice logging is currently turned off — please add this expense manually.");

    const { transcript } = z.object({
      transcript: z.string().min(1).max(2000),
    }).parse(req.body);

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
      ip: req.ip, expenseCount: expenses.length, warnings: result.warnings.length,
    });

    res.json({ expenses, warnings: result.warnings });
  })
);

module.exports = router;
