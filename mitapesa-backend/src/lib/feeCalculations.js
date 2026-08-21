const { badRequest } = require("./errors");

/* ---------------------------------------------------------------------- *
 * Fee model computation — pure functions, no DB access. Deliberately kept
 * in their own dependency-free module (separate from feeEngine.js, which
 * does the DB-backed rule matching) specifically so this logic — the part
 * most prone to the kind of off-by-one/sign errors real money is sensitive
 * to — can be unit tested directly, without mocking a database.
 * ---------------------------------------------------------------------- */

function applyCap(fee, minFee, maxFee) {
  let f = fee;
  if (minFee !== null && minFee !== undefined) f = Math.max(f, Number(minFee));
  if (maxFee !== null && maxFee !== undefined) f = Math.min(f, Number(maxFee));
  return Math.max(0, Math.round(f * 100) / 100);
}

function resolveTier(tiers, amount) {
  return tiers.find((t) => amount >= Number(t.minAmount) && (t.maxAmount === null || amount <= Number(t.maxAmount)));
}

/**
 * Computes the raw fee for one FeeRule (or one FeeTier, which shares the
 * same fixed/percentage/model shape) against a transaction amount.
 */
function computeRuleFee(rule, amount) {
  switch (rule.feeModel) {
    case "zero":
    case "display_only":
      return 0;
    case "fixed":
      return applyCap(Number(rule.fixedAmount || 0), rule.minFee, rule.maxFee);
    case "percentage":
      return applyCap(amount * (Number(rule.percentage || 0) / 100), rule.minFee, rule.maxFee);
    case "fixed_plus_percentage":
      return applyCap(Number(rule.fixedAmount || 0) + amount * (Number(rule.percentage || 0) / 100), rule.minFee, rule.maxFee);
    case "tiered": {
      const tier = resolveTier(rule.tiers || [], amount);
      if (!tier) return 0; // a gap in tier coverage — validateTiers() should prevent this at save time
      const tierFee = tier.feeModel === "percentage" ? amount * (Number(tier.percentage || 0) / 100) : Number(tier.fixedAmount || 0);
      return applyCap(tierFee, rule.minFee, rule.maxFee);
    }
    default:
      return 0;
  }
}

/**
 * Rejects overlapping, gapped, or invalid tiers before a rule is saved.
 * Tiers must be contiguous starting at 0, non-overlapping, and the last
 * tier's maxAmount must be null (unbounded).
 */
function validateTiers(tiers) {
  if (!tiers.length) throw badRequest("A tiered fee rule needs at least one tier");
  const sorted = [...tiers].sort((a, b) => Number(a.minAmount) - Number(b.minAmount));
  if (Number(sorted[0].minAmount) !== 0) throw badRequest("The first tier must start at 0");
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (Number(t.minAmount) < 0) throw badRequest("Tier amounts can't be negative");
    if (t.maxAmount !== null && t.maxAmount !== undefined && Number(t.maxAmount) < Number(t.minAmount)) {
      throw badRequest("A tier's maximum can't be below its minimum");
    }
    if (t.feeModel === "fixed" && Number(t.fixedAmount) < 0) throw badRequest("Tier fees can't be negative");
    if (t.feeModel === "percentage" && Number(t.percentage) < 0) throw badRequest("Tier fees can't be negative");
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      if (t.maxAmount === null || t.maxAmount === undefined) throw badRequest("Only the last tier may be unbounded (no maximum)");
      // Tolerance of 1: the natural pattern for whole-currency bands is
      // "0–10,000" then "10,001–50,000" (an off-by-one boundary, exactly
      // the spec's own example) — that's contiguous, not a gap.
      if (Number(next.minAmount) - Number(t.maxAmount) > 1.01) throw badRequest(`Gap between tiers: ${t.maxAmount} to ${next.minAmount} isn't covered`);
      if (Number(t.maxAmount) >= Number(next.minAmount)) throw badRequest(`Tiers overlap around ${next.minAmount}`);
    } else if (t.maxAmount !== null && t.maxAmount !== undefined) {
      throw badRequest("The last tier must be unbounded (no maximum)");
    }
  }
}

function startOfDay(d) {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/**
 * Checks every optional matching dimension a FeeRule can have set. This is
 * exactly the logic class that caused a real bug earlier (a free-text
 * Channel field with a typo silently broke matching, no error, no
 * feedback) — kept pure and dependency-free specifically so it can be
 * unit tested directly.
 */
function ruleMatches(rule, ctx, now) {
  if (rule.status !== "ACTIVE") return false;
  // Compared at day granularity — a rule effective "today" should apply
  // for the whole day regardless of the exact hour, and regardless of any
  // gap between the admin's local timezone (e.g. EAT, UTC+3) and the
  // server's clock (UTC).
  if (startOfDay(rule.effectiveFrom) > startOfDay(now)) return false;
  if (rule.effectiveTo && startOfDay(rule.effectiveTo) < startOfDay(now)) return false;
  if (rule.minAmount !== null && ctx.amount < Number(rule.minAmount)) return false;
  if (rule.maxAmount !== null && ctx.amount > Number(rule.maxAmount)) return false;
  if (rule.channel && rule.channel !== ctx.channel) return false;
  if (rule.onUsOffUs && rule.onUsOffUs !== ctx.onUsOffUs) return false;
  if (rule.customerSegment && rule.customerSegment !== ctx.customerSegment) return false;
  if (rule.accountType && rule.accountType !== ctx.accountType) return false;
  if (rule.merchantCategory && rule.merchantCategory !== ctx.merchantCategory) return false;
  if (rule.currency && ctx.currency && rule.currency !== ctx.currency) return false;
  if (rule.customerId && rule.customerId !== ctx.userId) return false;
  return true;
}

/**
 * How many optional dimensions a rule pins down — more specific rules win
 * over more general ones at equal priority.
 */
function specificity(rule) {
  return ["minAmount", "maxAmount", "channel", "onUsOffUs", "customerSegment", "accountType", "merchantCategory", "customerId"]
    .filter((k) => rule[k] !== null && rule[k] !== undefined).length;
}

module.exports = { applyCap, resolveTier, computeRuleFee, validateTiers, startOfDay, ruleMatches, specificity };
