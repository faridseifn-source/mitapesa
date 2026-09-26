const { Router } = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { forbidden, badRequest } = require("../../lib/errors");
const { getSetting } = require("../../lib/settings");
const { getAnalyticsAssistantProvider } = require("../../services/analytics");
const { runAnalyticsQuery } = require("./analyticsQuery");
const { writeAudit } = require("../../lib/audit");
const { checkUsageAllowed, recordUsage, purchaseCredits } = require("../../lib/aiUsage");

const router = Router();
router.use(requireAuth);

// Same rationale as voice.routes.js's parseLimiter — each request here
// makes two real OpenAI calls (interpret, then summarize), both within
// one customer action of asking one question.
const askLimiter = rateLimit({ windowMs: 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false });

const askRequestSchema = z.object({
  question: z.string().min(1).max(500),
});

// Turns the real, computed query results into a simple chart spec the
// client can render directly — generic {label, value} pairs work for
// both a bar chart (categories, merchants, a two-period comparison) and
// a line chart (a trend over time), so the client needs only two
// rendering paths, not one per intent. null means no chart is useful
// for this answer — single_value is one number; a graph of one point
// adds nothing, exactly the "only if there's a need" the customer asked
// for.
function buildChart(querySpec, results) {
  switch (querySpec.intent) {
    case "breakdown":
      return results.byCategory.length ? { type: "bar", data: results.byCategory.map((c) => ({ label: c.name, value: c.amount })) } : null;
    case "ranking":
      return results.items.length ? { type: "bar", data: results.items.map((i) => ({ label: i.name, value: i.amount })) } : null;
    case "trend":
      return results.series.length > 1 ? { type: "line", data: results.series.map((s) => ({ label: s.period, value: s.amount })) } : null;
    case "comparison":
      return {
        type: "bar",
        data: [
          { label: "This period", value: results.period1.total },
          { label: "Previous period", value: results.period2.total },
        ],
      };
    case "single_value":
    default:
      return null;
  }
}

// GET /analytics/usage-status — same pattern as /voice/usage-status:
// checked the moment the "Ask AI" screen opens, before the customer even
// types a question, so an exhausted free allowance is visible
// immediately rather than discovered only after asking.
router.get(
  "/usage-status",
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("analytics_enabled")) !== "false";
    if (!enabled) {
      return res.json({ allowed: false, reason: "AI analytics is currently turned off.", canPurchaseCredits: false });
    }
    const usageCheck = await checkUsageAllowed(req.userId, "analytics");
    res.json(usageCheck);
  })
);

// POST /analytics/ask { question } — the customer's own free-text
// question about their own expense history. Two real OpenAI calls
// happen here (interpret, then summarize), with a real database query
// run in between by our own code — the model never computes a number
// itself, it only decides what to ask for and how to explain the real
// answer (see AnalyticsAssistantProvider's own doc comment for why this
// split exists). A question outside the five supported types, or too
// ambiguous to answer confidently, gets a clear clarification message
// instead of a guess.
router.post(
  "/ask",
  askLimiter,
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("analytics_enabled")) !== "false";
    if (!enabled) throw forbidden("AI analytics is currently turned off.");

    // Checked before any real provider call is made, same reasoning as
    // voice.routes.js: avoid incurring the cost in the first place once
    // a customer's allowance or the account's monthly ceiling is reached.
    const usageCheck = await checkUsageAllowed(req.userId, "analytics");
    if (!usageCheck.allowed) {
      throw forbidden(usageCheck.reason, {
        canPurchaseCredits: Boolean(usageCheck.canPurchaseCredits),
        packSize: usageCheck.packSize,
        packPriceTzs: usageCheck.packPriceTzs,
      });
    }

    const { question } = askRequestSchema.parse(req.body);
    let totalCostUsd = 0;

    const categories = await prisma.category.findMany({ where: { OR: [{ userId: null }, { userId: req.userId }] }, select: { name: true } });
    const categoryNames = categories.map((c) => c.name);
    const today = new Date().toISOString().slice(0, 10);

    let interpretation;
    try {
      interpretation = await getAnalyticsAssistantProvider().interpretQuestion({ question, today, categoryNames });
      totalCostUsd += interpretation.estimatedCostUsd || 0;
    } catch (err) {
      console.error("Analytics question interpretation failed:", err.message); // eslint-disable-line no-console
      throw badRequest("We couldn't understand that question — please try rephrasing it.");
    }

    const querySpec = interpretation.querySpec;
    if (querySpec.intent === "unsupported") {
      // Interpretation itself still genuinely called OpenAI and cost
      // real money even though the question couldn't be answered — that
      // real cost is recorded, same principle voice.routes.js's own
      // empty-transcript path already follows, rather than silently
      // dropped just because the outcome was "can't answer this."
      await recordUsage(req.userId, "analytics", totalCostUsd, usageCheck.usingCreditId);
      return res.json({ summary: querySpec.clarification || "I couldn't quite work out what you're asking — could you rephrase it?", chart: null, querySpec: null });
    }

    let results;
    try {
      results = await runAnalyticsQuery(req.userId, querySpec);
    } catch (err) {
      console.error("Analytics query execution failed:", err.message); // eslint-disable-line no-console
      await recordUsage(req.userId, "analytics", totalCostUsd, usageCheck.usingCreditId);
      throw badRequest("We understood your question but couldn't pull the data — please try again.");
    }

    let summary;
    try {
      const summarized = await getAnalyticsAssistantProvider().summarizeResults({ question, querySpec, results });
      summary = summarized.summary;
      totalCostUsd += summarized.estimatedCostUsd || 0;
    } catch (err) {
      console.error("Analytics summary generation failed:", err.message); // eslint-disable-line no-console
      // The interpretation and the real query both already succeeded —
      // don't throw the whole answer away just because the final
      // wording step failed. Fall back to a minimal, honest summary
      // built from the real results directly, rather than losing real,
      // already-computed data over a wording-only failure.
      summary = "Here's what I found, based on your real transaction data.";
    }

    await writeAudit(req.userId, "analytics.asked", { ip: req.ip, intent: querySpec.intent });
    await recordUsage(req.userId, "analytics", totalCostUsd, usageCheck.usingCreditId);

    res.json({ summary, chart: buildChart(querySpec, results), querySpec });
  })
);

// POST /analytics/credits/purchase — same pattern as
// /voice/credits/purchase, its own independent pack size/price/pricing
// settings (see lib/settings.js's analytics_* block).
router.post(
  "/credits/purchase",
  askLimiter,
  asyncHandler(async (req, res) => {
    const result = await purchaseCredits(req.userId, "analytics", "AI analytics questions");
    await writeAudit(req.userId, "analytics.credits_purchase", { ip: req.ip, success: result.success, creditsPurchased: result.creditsPurchased });
    if (!result.success) throw badRequest(result.failureReason);
    res.json({ creditsPurchased: result.creditsPurchased });
  })
);

module.exports = router;
