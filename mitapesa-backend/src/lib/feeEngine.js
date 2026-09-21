const prisma = require("./prisma");
const { badRequest, notFound } = require("./errors");
const { computeRuleFee, validateTiers, ruleMatches, specificity } = require("./feeCalculations");

const QUOTE_TTL_MS = 5 * 60 * 1000; // configurable-in-spirit; see docs/FEE_ENGINE.md for how to make this a real setting

/* ---------------------------------------------------------------------- *
 * Rule matching — finds the best-fit ACTIVE rule for a given context.
 * ---------------------------------------------------------------------- */

async function findBestRule(transactionTypeId, ctx, now) {
  const candidates = await prisma.feeRule.findMany({
    where: { transactionTypeId, status: "ACTIVE" },
    include: { tiers: { orderBy: { sortOrder: "asc" } } },
  });
  const matching = candidates.filter((r) => ruleMatches(r, ctx, now));
  if (!matching.length) return null;
  // Individual-customer exceptions and campaign rules should naturally win
  // via higher specificity; ties broken by priority (lower wins), then most
  // recently created.
  matching.sort((a, b) => specificity(b) - specificity(a) || a.priority - b.priority || b.createdAt - a.createdAt);
  return matching[0];
}

/* ---------------------------------------------------------------------- *
 * Bundle + exemption lookups
 * ---------------------------------------------------------------------- */

async function findActiveExemption(userId, transactionTypeId, now) {
  return prisma.feeExemption.findFirst({
    where: {
      userId,
      isActive: true,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
      AND: [{ OR: [{ transactionTypeId: null }, { transactionTypeId }] }],
    },
    orderBy: { transactionTypeId: "asc" }, // prefer a type-specific exemption over a blanket one when both exist
  });
}

async function findActiveBundle(userId, transactionTypeId, amount, now) {
  const subs = await prisma.customerBundleSubscription.findMany({
    where: { userId, status: "ACTIVE", expiresAt: { gte: now } },
    include: { bundle: true },
  });
  console.log(`[bundle-match] userId=${userId} lookingFor=${transactionTypeId} amount=${amount} activeSubs=${subs.length}`); // eslint-disable-line no-console
  for (const sub of subs) {
    const included = Array.isArray(sub.bundle.includedTransactionTypeIds) ? sub.bundle.includedTransactionTypeIds : [];
    const includesMatch = included.includes(transactionTypeId);
    console.log(`[bundle-match] sub=${sub.id} bundle="${sub.bundle.nameEn}" includedTypeIds=${JSON.stringify(included)} includesLookedForType=${includesMatch} maxTxValue=${sub.bundle.maxTransactionValue} txCount=${sub.transactionsUsed}/${sub.bundle.includedTransactionCount}`); // eslint-disable-line no-console
    if (!includesMatch) continue;
    if (sub.bundle.maxTransactionValue && amount > Number(sub.bundle.maxTransactionValue)) { console.log(`[bundle-match] sub=${sub.id} rejected: amount ${amount} exceeds maxTransactionValue ${sub.bundle.maxTransactionValue}`); continue; } // eslint-disable-line no-console
    if (sub.bundle.includedTransactionCount !== null && sub.transactionsUsed >= sub.bundle.includedTransactionCount) { console.log(`[bundle-match] sub=${sub.id} rejected: transaction count exhausted`); continue; } // eslint-disable-line no-console
    if (sub.bundle.fairUsageLimit !== null && sub.transactionsUsed >= sub.bundle.fairUsageLimit) { console.log(`[bundle-match] sub=${sub.id} rejected: fair usage limit reached`); continue; } // eslint-disable-line no-console
    console.log(`[bundle-match] sub=${sub.id} MATCHED — this transaction should be covered`); // eslint-disable-line no-console
    return sub;
  }
  console.log(`[bundle-match] no active subscription covers transactionTypeId=${transactionTypeId}`); // eslint-disable-line no-console
  return null;
}

/**
 * Purely for upsell display (the "Subscribe" prompt on a payment confirm
 * screen when a fee is being charged) — never affects the actual fee
 * calculation. Only called when findActiveBundle already returned null,
 * so there's no risk of ever suggesting a bundle the customer is already
 * covered by. Picks the cheapest matching bundle as a simple, sensible
 * default when more than one would apply.
 */
async function findSuggestableBundle(userId, transactionTypeId, now) {
  const bundles = await prisma.feeBundle.findMany({
    where: {
      isActive: true,
      OR: [{ startDate: null }, { startDate: { lte: now } }],
      AND: [{ OR: [{ endDate: null }, { endDate: { gte: now } }] }],
    },
  });
  const matching = bundles.filter((b) => {
    const included = Array.isArray(b.includedTransactionTypeIds) ? b.includedTransactionTypeIds : [];
    return included.includes(transactionTypeId);
  });
  if (matching.length === 0) return null;
  return matching.sort((a, b) => Number(a.price) - Number(b.price))[0];
}

/* ---------------------------------------------------------------------- *
 * The public API — quoteFee() and collectFee()
 * ---------------------------------------------------------------------- */

/**
 * The reusable calculation service described in the spec's Section 10.
 * Implements the pricing priority chain:
 *   1. Regulatory/mandatory exemption + 2. customer-specific waiver
 *      (both modeled as FeeExemption — see docs/FEE_ENGINE.md)
 *   3. Active promotional rule (a FeeRule with campaignName set)
 *   4. Active bundle entitlement
 *   5. Applicable standard or tiered fee (best-matching FeeRule)
 *   6. Default fallback (zero — see docs/FEE_ENGINE.md "Assumptions")
 *
 * @param {object} ctx - { userId, transactionTypeCode, amount, currency,
 *   channel, onUsOffUs, customerSegment, accountType, merchantCategory,
 *   partnerFee (already-known, e.g. an institution markup — never
 *   recomputed here, only carried through and disclosed) }
 */
async function quoteFee(ctx) {
  const now = new Date();
  const type = await prisma.feeTransactionType.findUnique({ where: { code: ctx.transactionTypeCode } });

  const partnerFee = Number(ctx.partnerFee || 0);
  const base = { userId: ctx.userId, transactionTypeCode: ctx.transactionTypeCode, amount: ctx.amount, currency: ctx.currency || "TZS", context: ctx };

  const finalize = async (fields) => {
    // bundleBenefit/discount are disclosed, informational fields (e.g. "you
    // saved 200 TZS") — NOT amounts to subtract again here. mitaPesaFee
    // already reflects the real, net fee in every code path that sets it
    // (0 when a bundle/exemption covers it, the computed rule fee
    // otherwise), so subtracting the benefit a second time would double-
    // count it — and could zero out an unrelated partner fee via the
    // clamp below if bundleBenefit ever exceeded mitaPesaFee + partnerFee.
    const totalFee = Number(fields.mitaPesaFee) + partnerFee + Number(fields.tax || 0);
    const quote = await prisma.feeQuote.create({
      data: {
        ...base,
        mitaPesaFee: fields.mitaPesaFee,
        partnerFee,
        tax: fields.tax || 0,
        discount: fields.discount || 0,
        bundleBenefit: fields.bundleBenefit || 0,
        totalFee: Math.max(0, totalFee),
        totalDebit: Number(ctx.amount) + Math.max(0, totalFee),
        feeRuleId: fields.feeRuleId || null,
        feeRuleVersion: fields.feeRuleVersion || null,
        bundleSubscriptionId: fields.bundleSubscriptionId || null,
        exemptionId: fields.exemptionId || null,
        disclosureEn: fields.disclosureEn,
        disclosureSw: fields.disclosureSw,
        expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
      },
    });
    // taxTreatment/vatRate are display-only extras, not persisted columns —
    // purely so the API response can label the tax line correctly
    // ("VAT inclusive" vs "VAT added"), without needing a schema change.
    return { ...quote, taxTreatment: fields.taxTreatment || "NONE", vatRate: fields.vatRate || 0, suggestedBundle: fields.suggestedBundle || null };
  };

  // Not a monetizable type at all (or not yet registered) — free, no rule needed.
  if (!type || !type.isMonetizable || !type.isActive) {
    return finalize({
      mitaPesaFee: 0,
      disclosureEn: partnerFee > 0 ? `No MitaPesa fee. A partner charge of ${partnerFee.toLocaleString()} TZS applies.` : "This is a free MitaPesa feature.",
      disclosureSw: partnerFee > 0 ? `Hakuna ada ya MitaPesa. Ada ya mshirika ya TZS ${partnerFee.toLocaleString()} inatumika.` : "Hii ni huduma ya bure ya MitaPesa.",
    });
  }

  // Priority 1+2: exemption / waiver
  const exemption = await findActiveExemption(ctx.userId, type.id, now);
  if (exemption) {
    return finalize({
      mitaPesaFee: 0,
      exemptionId: exemption.id,
      disclosureEn: `Fee waived: ${exemption.reason}.`,
      disclosureSw: `Ada imesamehewa: ${exemption.reason}.`,
    });
  }

  // Priority 4: active bundle (checked before the standard rule lookup —
  // priority 3's "active promotional rule" is just a FeeRule with a
  // campaignName, so it's naturally picked up by findBestRule below and
  // wins there via higher specificity/priority; the bundle check sits
  // between exemptions and the standard-rule fallback per the spec order)
  const bundleSub = await findActiveBundle(ctx.userId, type.id, ctx.amount, now);
  if (bundleSub) {
    // Compute what the fee WOULD have been without the bundle — this is
    // what makes bundleBenefit a real, disclosed number rather than
    // silently always 0, and lets the customer actually see the value the
    // bundle provided rather than just "covered" with no context.
    const wouldBeRule = await findBestRule(type.id, {
      amount: ctx.amount, channel: ctx.channel, onUsOffUs: ctx.onUsOffUs, customerSegment: ctx.customerSegment,
      accountType: ctx.accountType, merchantCategory: ctx.merchantCategory, currency: ctx.currency, userId: ctx.userId,
    }, now);
    const wouldBeFee = wouldBeRule && wouldBeRule.feeModel !== "display_only" ? computeRuleFee(wouldBeRule, ctx.amount) : 0;
    const savingsNote = wouldBeFee > 0 ? ` You saved ${wouldBeFee.toLocaleString()} TZS.` : "";
    const savingsNoteSw = wouldBeFee > 0 ? ` Umeokoa TZS ${wouldBeFee.toLocaleString()}.` : "";
    return finalize({
      mitaPesaFee: 0,
      bundleBenefit: wouldBeFee,
      bundleSubscriptionId: bundleSub.id,
      disclosureEn: `Covered by your ${bundleSub.bundle.nameEn} bundle.${savingsNote}`,
      disclosureSw: `Ada hii imejumuishwa katika kifurushi chako cha ${bundleSub.bundle.nameSw}.${savingsNoteSw}`,
    });
  }

  // Priority 3 (promotional) and 5 (standard/tiered) both resolve here —
  // a promotional rule is just a FeeRule with a campaignName and higher
  // specificity/priority, so it wins the match naturally.
  const rule = await findBestRule(type.id, {
    amount: ctx.amount, channel: ctx.channel, onUsOffUs: ctx.onUsOffUs, customerSegment: ctx.customerSegment,
    accountType: ctx.accountType, merchantCategory: ctx.merchantCategory, currency: ctx.currency, userId: ctx.userId,
  }, now);

  if (!rule) {
    // Priority 6: default fallback. See docs/FEE_ENGINE.md — undercharging
    // (zero) is the deliberate safe default over blocking an otherwise-
    // working transaction that simply hasn't been priced yet.
    return finalize({
      mitaPesaFee: 0,
      disclosureEn: partnerFee > 0 ? `No MitaPesa fee configured yet. A partner charge of ${partnerFee.toLocaleString()} TZS applies.` : "No fee currently applies to this transaction.",
      disclosureSw: partnerFee > 0 ? `Hakuna ada ya MitaPesa iliyowekwa bado. Ada ya mshirika ya TZS ${partnerFee.toLocaleString()} inatumika.` : "Hakuna ada inayotumika kwa muamala huu kwa sasa.",
    });
  }

  const mitaPesaFee = rule.feeModel === "display_only" ? 0 : computeRuleFee(rule, ctx.amount);
  const displayOnlyPartnerFee = rule.feeModel === "display_only" ? computeRuleFee(rule, ctx.amount) : 0;
  let tax = 0;
  if (rule.taxTreatment === "VAT_EXCLUSIVE") tax = mitaPesaFee * (Number(rule.vatRate) / 100);
  // VAT_INCLUSIVE: the configured fee already includes VAT — tax is disclosed as a component, not added on top.
  const vatComponent = rule.taxTreatment === "VAT_INCLUSIVE" ? mitaPesaFee - mitaPesaFee / (1 + Number(rule.vatRate) / 100) : tax;

  const enDesc = rule.descriptionEn || `${rule.name} applies to this transaction.`;
  const swDesc = rule.descriptionSw || `Ada ya ${rule.name} inatumika kwa muamala huu.`;

  const suggestedBundle = mitaPesaFee > 0 ? await findSuggestableBundle(ctx.userId, type.id, now) : null;

  return finalize({
    mitaPesaFee,
    partnerFee: partnerFee + displayOnlyPartnerFee,
    tax: vatComponent,
    taxTreatment: rule.taxTreatment,
    vatRate: Number(rule.vatRate),
    feeRuleId: rule.id,
    feeRuleVersion: rule.version,
    disclosureEn: enDesc,
    disclosureSw: swDesc,
    suggestedBundle,
  });
}

/**
 * Finalizes a quote against a completed transaction — idempotent: calling
 * this twice with the same quoteId simply returns the existing record
 * rather than double-collecting. Must be called before (or atomically
 * with) marking the underlying transaction complete, and the quote must
 * not have expired.
 */
async function collectFee(quoteId, transactionRef) {
  const existing = await prisma.feeCollectionRecord.findUnique({ where: { quoteId } });
  if (existing) return existing; // idempotent — already collected for this quote

  const quote = await prisma.feeQuote.findUnique({ where: { id: quoteId } });
  if (!quote) throw notFound("Fee quote not found");
  if (quote.consumedAt) throw badRequest("This fee quote has already been used");
  if (quote.expiresAt < new Date()) throw badRequest("This fee quote has expired — please try again");

  await prisma.feeQuote.update({ where: { id: quoteId }, data: { consumedAt: new Date() } });

  const record = await prisma.feeCollectionRecord.create({
    data: {
      quoteId,
      transactionRef,
      transactionTypeCode: quote.transactionTypeCode,
      userId: quote.userId,
      mitaPesaFeeCollected: quote.mitaPesaFee,
      partnerFeeDisclosed: quote.partnerFee,
      taxCollected: quote.tax,
    },
  });

  if (quote.bundleSubscriptionId) {
    await prisma.customerBundleSubscription.update({
      where: { id: quote.bundleSubscriptionId },
      data: { transactionsUsed: { increment: 1 } },
    });
  }

  return record;
}

/**
 * Reverses a previously collected fee — full or partial. Called alongside
 * (not instead of) reversing the underlying transaction itself.
 */
async function reverseFee(transactionRef, amount /* null = full reversal */) {
  const record = await prisma.feeCollectionRecord.findFirst({ where: { transactionRef, status: { in: ["COLLECTED", "PARTIALLY_REVERSED"] } } });
  if (!record) return null;
  const already = Number(record.reversedAmount);
  const collected = Number(record.mitaPesaFeeCollected);
  const toReverse = amount === null || amount === undefined ? collected - already : Math.min(amount, collected - already);
  const newReversed = already + toReverse;
  return prisma.feeCollectionRecord.update({
    where: { id: record.id },
    data: { reversedAmount: newReversed, reversedAt: new Date(), status: newReversed >= collected ? "REVERSED" : "PARTIALLY_REVERSED" },
  });
}

/**
 * Non-persisting lookup for display purposes when the amount isn't known
 * yet (the customer hasn't entered one) — returns the raw matching rule's
 * fee-model fields so the frontend can mirror the calculation live as they
 * type, the same pattern used for partner/institution fee previews. The
 * real, authoritative quote is always computed by quoteFee() once an
 * amount exists, whether that's at resolve time (fixed-amount QR) or pay
 * time (customer-entered amount).
 */
/**
 * Checks whether an exemption or bundle would cover a transaction type
 * BEFORE an amount is known — used by the "amount not fixed yet" preview
 * path, which previously skipped this entirely and went straight to
 * showing the raw rule fee regardless of bundle coverage. Amount-dependent
 * bundle limits (maxTransactionValue, count caps) can't be checked yet
 * without an amount, so this is optimistic — quoteFee() at actual payment
 * time is what actually enforces those for real.
 */
async function previewCoverage(transactionTypeCode, userId, ctx = {}) {
  const type = await prisma.feeTransactionType.findUnique({ where: { code: transactionTypeCode } });
  if (!type) return { covered: false };
  const now = new Date();

  // The rule that WOULD apply if nothing covered this — used to show the
  // customer what they're saving, not just that they're covered.
  const wouldBeRule = await findBestRule(type.id, { amount: 0, ...ctx }, now);
  const wouldBeRulePreview = wouldBeRule ? {
    feeModel: wouldBeRule.feeModel,
    fixedAmount: wouldBeRule.fixedAmount !== null ? Number(wouldBeRule.fixedAmount) : null,
    percentage: wouldBeRule.percentage !== null ? Number(wouldBeRule.percentage) : null,
    minFee: wouldBeRule.minFee !== null ? Number(wouldBeRule.minFee) : null,
    maxFee: wouldBeRule.maxFee !== null ? Number(wouldBeRule.maxFee) : null,
    taxTreatment: wouldBeRule.taxTreatment,
    vatRate: Number(wouldBeRule.vatRate),
    tiers: (wouldBeRule.tiers || []).map((t) => ({
      minAmount: Number(t.minAmount), maxAmount: t.maxAmount !== null ? Number(t.maxAmount) : null,
      feeModel: t.feeModel, fixedAmount: t.fixedAmount !== null ? Number(t.fixedAmount) : null, percentage: t.percentage !== null ? Number(t.percentage) : null,
    })),
  } : null;

  const exemption = await findActiveExemption(userId, type.id, now);
  if (exemption) return { covered: true, reason: `Fee waived: ${exemption.reason}.`, reasonSw: `Ada imesamehewa: ${exemption.reason}.`, wouldBeRule: wouldBeRulePreview };

  const subs = await prisma.customerBundleSubscription.findMany({ where: { userId, status: "ACTIVE", expiresAt: { gte: now } }, include: { bundle: true } });
  for (const sub of subs) {
    const included = Array.isArray(sub.bundle.includedTransactionTypeIds) ? sub.bundle.includedTransactionTypeIds : [];
    if (included.includes(type.id)) {
      return {
        covered: true,
        reason: `Covered by your ${sub.bundle.nameEn} bundle.`,
        reasonSw: `Ada hii imejumuishwa katika kifurushi chako cha ${sub.bundle.nameSw}.`,
        wouldBeRule: wouldBeRulePreview,
      };
    }
  }

  const hasRealFee = wouldBeRulePreview && wouldBeRulePreview.feeModel !== "zero" && wouldBeRulePreview.feeModel !== "display_only";
  const suggestedBundle = hasRealFee ? await findSuggestableBundle(userId, type.id, now) : null;
  return { covered: false, wouldBeRule: wouldBeRulePreview, suggestedBundle };
}

async function previewFeeRule(transactionTypeCode, ctx) {
  const type = await prisma.feeTransactionType.findUnique({ where: { code: transactionTypeCode } });
  if (!type || !type.isMonetizable || !type.isActive) return null;
  const now = new Date();
  // Passing amount=0 means a rule that's itself amount-banded via
  // minAmount (rather than using tiers) might not match here even though
  // the customer's eventual real amount would — a known limitation of
  // previewing before an amount exists. quoteFee() at actual pay time is
  // always authoritative regardless of what this preview showed.
  const rule = await findBestRule(type.id, { amount: 0, ...ctx }, now);
  if (!rule) return null;
  return {
    feeModel: rule.feeModel,
    fixedAmount: rule.fixedAmount !== null ? Number(rule.fixedAmount) : null,
    percentage: rule.percentage !== null ? Number(rule.percentage) : null,
    minFee: rule.minFee !== null ? Number(rule.minFee) : null,
    maxFee: rule.maxFee !== null ? Number(rule.maxFee) : null,
    taxTreatment: rule.taxTreatment,
    vatRate: Number(rule.vatRate),
    tiers: (rule.tiers || []).map((t) => ({
      minAmount: Number(t.minAmount), maxAmount: t.maxAmount !== null ? Number(t.maxAmount) : null,
      feeModel: t.feeModel, fixedAmount: t.fixedAmount !== null ? Number(t.fixedAmount) : null, percentage: t.percentage !== null ? Number(t.percentage) : null,
    })),
  };
}

module.exports = { quoteFee, collectFee, reverseFee, previewFeeRule, previewCoverage, computeRuleFee, validateTiers, QUOTE_TTL_MS };
