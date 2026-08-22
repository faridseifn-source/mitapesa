const { Router } = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { requirePayModuleEnabled } = require("../../middleware/payModule");
const { notFound } = require("../../lib/errors");
const { checkIdempotencyKey, saveIdempotentResponse } = require("../../lib/idempotency");
const { resolveQrPayload, resolveByAlias, payViaQr, getPaymentStatus } = require("./qrPayment.service");
const { previewInstitutionFee } = require("../../lib/institutionRules");
const { quoteFee, previewFeeRule, previewCoverage } = require("../../lib/feeEngine");

function serializeSuggestedBundle(b) {
  if (!b) return null;
  return { id: b.id, nameEn: b.nameEn, nameSw: b.nameSw, price: Number(b.price), validity: b.validity };
}
const { computeCrc16, buildAliasMerchantId } = require("../../lib/tanqr");
const { getSetting } = require("../../lib/settings");

const router = Router();
router.use(requireAuth);
router.use(asyncHandler(requirePayModuleEnabled));

// Scanning/resolving is deliberately not idempotency-gated (it moves no
// money) but is rate-limited — a malformed-payload retry loop shouldn't be
// able to hammer the parser.
const scanLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

// POST /qr/resolve { payload } — parse + validate a scanned QR and return
// merchant details for display before confirmation. No money moves here.
router.post(
  "/resolve",
  scanLimiter,
  asyncHandler(async (req, res) => {
    const { payload } = z.object({ payload: z.string().min(10) }).parse(req.body);
    const { parsed, merchant, isOnUs } = await resolveQrPayload(payload);
    const partnerFeePreview = isOnUs ? { feeAmount: 0, feeType: "none", institutionKnown: true, transfersEnabled: true } : await previewInstitutionFee(merchant.acquirerId, parsed.amount);
    const transactionTypeCode = isOnUs ? "QR_ON_US" : "QR_OFF_US";

    const transfersActuallyEnabled = isOnUs || (partnerFeePreview.institutionKnown && partnerFeePreview.transfersEnabled !== false);

    let fee;
    if (parsed.amountFixed && transfersActuallyEnabled) {
      // A real, authoritative quote — the amount is already known.
      const quote = await quoteFee({
        userId: req.userId, transactionTypeCode, amount: parsed.amount, currency: "TZS", channel: "MOBILE_APP",
        onUsOffUs: isOnUs ? "ON_US" : "OFF_US", merchantCategory: merchant.mcc || undefined, partnerFee: partnerFeePreview.feeAmount,
      });
      fee = {
        mitaPesaFee: Number(quote.mitaPesaFee), partnerFee: Number(quote.partnerFee), tax: Number(quote.tax), totalFee: Number(quote.totalFee),
        bundleBenefit: Number(quote.bundleBenefit || 0), taxTreatment: quote.taxTreatment, vatRate: Number(quote.vatRate || 0),
        disclosureEn: quote.disclosureEn, disclosureSw: quote.disclosureSw, transfersEnabled: true,
        suggestedBundle: serializeSuggestedBundle(quote.suggestedBundle),
      };
    } else {
      // Amount not known yet — check bundle/exemption coverage first (this
      // was the gap: it previously skipped straight to the raw rule fee
      // regardless of any active bundle), then fall back to a structural
      // rule preview for live client-side estimation if nothing covers it.
      const previewCtx = { onUsOffUs: isOnUs ? "ON_US" : "OFF_US", merchantCategory: merchant.mcc || undefined };
      const coverage = await previewCoverage(transactionTypeCode, req.userId, previewCtx);
      if (coverage.covered) {
        fee = { mitaPesaFeeRule: coverage.wouldBeRule, coveredMessage: coverage.reason, coveredMessageSw: coverage.reasonSw, partnerFee: partnerFeePreview, transfersEnabled: transfersActuallyEnabled };
      } else {
        const rulePreview = await previewFeeRule(transactionTypeCode, previewCtx);
        fee = { mitaPesaFeeRule: rulePreview, partnerFee: partnerFeePreview, transfersEnabled: transfersActuallyEnabled, suggestedBundle: serializeSuggestedBundle(coverage.suggestedBundle) };
      }
    }

    res.json({
      merchant: { id: merchant.id, name: merchant.name, city: merchant.city, mcc: merchant.mcc },
      isOnUs,
      pointOfInitiationMethod: parsed.pointOfInitiationMethod,
      amount: parsed.amount, // null if the customer needs to enter one
      amountFixed: parsed.amountFixed,
      currency: "TZS",
      fee,
    });
  })
);

// POST /qr/resolve-alias { aliasMerchantId } — the manual-entry path
// (Requirement: "manual entry of merchant... following the TIPS standard"),
// TANQR Annex 3 §2's 8-digit Alias Merchant ID scheme. No fixed amount is
// ever carried by an alias — the customer enters one on confirmation.
router.post(
  "/resolve-alias",
  scanLimiter,
  asyncHandler(async (req, res) => {
    const { aliasMerchantId } = z.object({ aliasMerchantId: z.string().length(8) }).parse(req.body);
    const { merchant, isOnUs } = await resolveByAlias(aliasMerchantId);
    const partnerFeePreview = isOnUs ? { feeAmount: 0, feeType: "none", institutionKnown: true, transfersEnabled: true } : await previewInstitutionFee(merchant.acquirerId, null);
    const transfersActuallyEnabled = isOnUs || (partnerFeePreview.institutionKnown && partnerFeePreview.transfersEnabled !== false);
    const transactionTypeCode = isOnUs ? "QR_ON_US" : "QR_OFF_US";
    const previewCtx = { onUsOffUs: isOnUs ? "ON_US" : "OFF_US", merchantCategory: merchant.mcc || undefined };
    const coverage = await previewCoverage(transactionTypeCode, req.userId, previewCtx);
    const fee = coverage.covered
      ? { mitaPesaFeeRule: coverage.wouldBeRule, coveredMessage: coverage.reason, coveredMessageSw: coverage.reasonSw, partnerFee: partnerFeePreview, transfersEnabled: transfersActuallyEnabled }
      : { mitaPesaFeeRule: await previewFeeRule(transactionTypeCode, previewCtx), partnerFee: partnerFeePreview, transfersEnabled: transfersActuallyEnabled, suggestedBundle: serializeSuggestedBundle(coverage.suggestedBundle) };

    res.json({
      merchant: { id: merchant.id, name: merchant.name, city: merchant.city, mcc: merchant.mcc },
      isOnUs,
      pointOfInitiationMethod: "manual_alias",
      amount: null,
      amountFixed: false,
      currency: "TZS",
      fee,
    });
  })
);

// POST /qr/pay — the full customer journey from confirmed payment through
// to settlement. Requires an Idempotency-Key so a retried tap (or a flaky
// connection) can never double-debit. Identifies the merchant via EITHER a
// scanned payload OR a manually-entered alias — exactly one of the two.
router.post(
  "/pay",
  asyncHandler(async (req, res) => {
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { payload, aliasMerchantId, cardType, cardId, amount, categoryId, authMethod } = z
      .object({
        payload: z.string().min(10).optional(),
        aliasMerchantId: z.string().length(8).optional(),
        cardType: z.enum(["main", "virtual"]),
        cardId: z.string().min(1),
        amount: z.number().positive().optional(), // required only when the QR/alias doesn't fix one
        categoryId: z.string().min(1),
        authMethod: z.enum(["pin", "biometric", "otp", "none"]),
      })
      .refine((v) => !!v.payload !== !!v.aliasMerchantId, { message: "Provide exactly one of payload or aliasMerchantId" })
      .parse(req.body);

    const { payment } = await payViaQr({ userId: req.userId, rawPayload: payload, aliasMerchantId, cardType, cardId, amountOverride: amount, categoryId, authMethod });

    const body = { payment: serializePayment(payment) };
    await saveIdempotentResponse(req, 200, body);
    res.json(body);
  })
);

// GET /qr/payments/:reference — status enquiry (Requirement: "transaction-
// status enquiries"), including the full per-stage event history.
router.get(
  "/payments/:reference",
  asyncHandler(async (req, res) => {
    const payment = await getPaymentStatus(req.params.reference, req.userId);
    res.json({
      payment: serializePayment(payment),
      merchant: payment.merchant ? { name: payment.merchant.name, city: payment.merchant.city } : undefined,
      events: payment.events?.map((e) => ({ stage: e.stage, outcome: e.outcome, createdAt: e.createdAt })),
    });
  })
);

// GET /qr/payments — the customer's own QR payment history.
router.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const payments = await prisma.qrPayment.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { merchant: { select: { name: true, city: true } } },
    });
    res.json({ payments: payments.map((p) => ({ ...serializePayment(p), merchantName: p.merchant.name, merchantCity: p.merchant.city })) });
  })
);

function serializePayment(p) {
  return {
    id: p.id,
    reference: p.reference,
    amount: Number(p.amount),
    feeAmount: Number(p.feeAmount || 0), // partner/institution fee
    mitaPesaFeeAmount: Number(p.mitaPesaFeeAmount || 0),
    taxAmount: Number(p.taxAmount || 0),
    currency: p.currency,
    isOnUs: p.isOnUs,
    status: p.status,
    stage: p.stage,
    failureReason: p.failureReason,
    reversalReason: p.reversalReason,
    createdAt: p.createdAt,
    completedAt: p.completedAt,
  };
}

function buildTag(tag, value) {
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

// Builds a spec-valid TANQR payload string, using the same CRC
// implementation the parser validates against — so a "sample" QR here is
// exactly as real, from the parser's point of view, as a scanned one.
function buildSamplePayload({ acquirerId, merchantId, merchantName, city, mcc, amount }) {
  const merchantAccountInfo = buildTag("00", "tz.go.bot.tips") + buildTag("01", acquirerId) + buildTag("02", merchantId);
  let body =
    buildTag("00", "01") +
    buildTag("01", "12") + // dynamic, since we're generating a specific sample each time
    buildTag("26", merchantAccountInfo) +
    buildTag("52", mcc || "5999") +
    buildTag("53", "834") +
    (amount ? buildTag("54", String(amount)) : "") +
    buildTag("58", "TZ") +
    buildTag("59", merchantName) +
    buildTag("60", city || "DAR ES SALAAM");
  body += "6304";
  const crc = computeCrc16(body);
  return body + crc;
}

// GET /qr/dev/sample-payloads — generates (and pre-registers, so their
// aliases resolve immediately too) one on-us and one off-us sample for
// testing the full flow without a real merchant QR. Admin-toggleable via
// the "qr_test_samples_enabled" setting — turn this off once real merchant
// QR codes are in use, so customers never see a "test payment" hint.
router.get(
  "/dev/sample-payloads",
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("qr_test_samples_enabled")) !== "false";
    if (!enabled) throw notFound("Test payments are not available");

    const partnerAcquirerId = await getSetting("partner_bank_acquirer_id");
    const offUsAcquirerId = partnerAcquirerId === "01002" ? "01003" : "01002";

    const samples = [
      { acquirerId: partnerAcquirerId, merchantId: "10023456", merchantName: "MITAPESA CAFE", city: "DAR ES SALAAM", mcc: "5814", amount: null, key: "onUs", description: "On-us sample — settles directly through the partner bank's CBS" },
      { acquirerId: offUsAcquirerId, merchantId: "20098765", merchantName: "KARIAKOO MARKET STALL 12", city: "DAR ES SALAAM", mcc: "5399", amount: 15000, key: "offUs", description: "Off-us sample — routes through TIPS, fixed amount of TZS 15,000" },
    ];

    const result = {};
    for (const s of samples) {
      const payload = buildSamplePayload(s);
      const isOnUs = s.acquirerId === partnerAcquirerId;
      const aliasMerchantId = buildAliasMerchantId(s.acquirerId, s.merchantId);
      // Pre-register so the alias (manual-entry) path also works immediately,
      // without requiring the sample QR to be "scanned" first.
      await prisma.merchant.upsert({
        where: { acquirerId_merchantId: { acquirerId: s.acquirerId, merchantId: s.merchantId } },
        update: { name: s.merchantName, city: s.city, mcc: s.mcc, isOnUs, aliasMerchantId },
        create: { acquirerId: s.acquirerId, merchantId: s.merchantId, name: s.merchantName, city: s.city, mcc: s.mcc, isOnUs, aliasMerchantId },
      });
      // Off-us payments now require a registered FinancialInstitution with
      // transfer rules — without this, the off-us sample would be rejected
      // by assertTransferAllowed with "institution not yet supported."
      if (!isOnUs) {
        await prisma.financialInstitution.upsert({
          where: { acquirerId: s.acquirerId },
          update: {},
          create: {
            acquirerId: s.acquirerId,
            categoryCode: s.acquirerId.slice(0, 2),
            participantCode: s.acquirerId.slice(2),
            name: "Sample Off-Us Bank (test)",
            shortCode: "TESTBANK",
            institutionType: "bank",
            isActive: true,
            transfersEnabled: true,
            feeType: "percentage",
            feePercentage: 1.0,
            feeCapAmount: 2000,
          },
        });
      }
      result[s.key] = { payload, aliasMerchantId, description: s.description };
    }
    res.json(result);
  })
);

module.exports = router;
