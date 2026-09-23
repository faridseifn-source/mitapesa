const { Router } = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { requirePayModuleEnabled } = require("../../middleware/payModule");
const { badRequest } = require("../../lib/errors");
const { getCardFundingProvider } = require("../../services/card-funding");
const { getCardIssuingProvider } = require("../../services/card-issuing");
const { getPaymentRailProvider } = require("../../services/payments-rail");
const { requireKycIfOverThreshold } = require("./kycGate");
const { myCard, debitCard } = require("./cardHelpers");
const { writeAudit } = require("../../lib/audit");
const { checkIdempotencyKey, saveIdempotentResponse } = require("../../lib/idempotency");
const { generatePaymentReference } = require("../../lib/reference");
const { encryptField, decryptField } = require("../../lib/crypto");
const { genCardCredentials } = require("../../lib/cardCredentials");
const { computeStatement } = require("../../lib/statement");
const { statementToCsv, sendCsv } = require("../../lib/csv");
const { notifyUser } = require("../../lib/notify");
const { quoteFee, collectFee } = require("../../lib/feeEngine");
const { getSetting } = require("../../lib/settings");

const router = Router();
router.use(requireAuth);
router.use(asyncHandler(requirePayModuleEnabled));

router.get(
  "/me",
  asyncHandler(async (req, res) => {
    const card = await myCard(req.userId);
    const activity = await prisma.cardActivity.findMany({ where: { cardId: card.id }, orderBy: { date: "desc" }, take: 50 });
    res.json({ card, activity });
  })
);

// GET /cards/me/reveal — full PAN + CVV, for entering into an external
// checkout during online payment. Audit-logged, self-healing for any
// account whose card predates this feature.
router.get(
  "/me/reveal",
  asyncHandler(async (req, res) => {
    let card = await myCard(req.userId);
    if (!card.fullNumberEnc || !card.cvvEnc) {
      const { fullNumber, cvv } = genCardCredentials(await getSetting("card_bin"));
      card = await prisma.card.update({ where: { id: card.id }, data: { fullNumberEnc: encryptField(fullNumber), cvvEnc: encryptField(cvv) } });
    }
    await writeAudit(req.userId, "card.details_viewed", { ip: req.ip });
    res.json({ fullNumber: decryptField(card.fullNumberEnc), cvv: decryptField(card.cvvEnc), expiry: card.expiry });
  })
);

// GET /cards/me/statement?from=&to=&format=csv — "pull statement" for the
// primary card. Defaults to the current calendar month if no range is
// given; add &format=csv for a downloadable file instead of JSON.
router.get(
  "/me/statement",
  asyncHandler(async (req, res) => {
    const card = await myCard(req.userId);
    const now = new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : now;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw badRequest("Invalid from/to date");

    const activitySinceFrom = await prisma.cardActivity.findMany({
      where: { cardId: card.id, date: { gte: from } },
      orderBy: { date: "asc" },
    });
    const statement = computeStatement({ currentBalance: Number(card.balance), activitySinceFrom, from, to });
    await writeAudit(req.userId, "card.statement_pulled", { ip: req.ip, from, to, format: req.query.format || "json" });

    if (req.query.format === "csv") {
      // In-app statement viewing (the default JSON response above) is a
      // core PFM feature and stays free; requesting the formal downloadable
      // export is the specific monetizable "statement" service from the
      // fee-engine spec — charged here, before the file is returned.
      const quote = await quoteFee({ userId: req.userId, transactionTypeCode: "CARD_STATEMENT_MONTHLY", amount: 0, currency: "TZS", channel: "MOBILE_APP" });
      const fee = Number(quote.totalFee);
      if (fee > 0) {
        if (Number(card.balance) < fee) throw badRequest(`Downloading a statement costs ${fee.toLocaleString()} TZS — please top up first`);
        await debitCard(card.id, { type: "statement_fee", amount: fee, label: "Monthly statement export" });
        await collectFee(quote.id, `STMTFEE-${card.id}-${Date.now()}`).catch((err) => console.error("Fee collection failed", err));
      }
      return sendCsv(res, `mitapesa-statement-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, statementToCsv(statement));
    }
    res.json(statement);
  })
);

router.post(
  "/freeze",
  asyncHandler(async (req, res) => {
    const { frozen } = z.object({ frozen: z.boolean() }).parse(req.body);
    const card = await myCard(req.userId);
    const snapshot = await getCardIssuingProvider().setFrozen(card.id, frozen);
    await writeAudit(req.userId, frozen ? "card.frozen" : "card.unfrozen", { ip: req.ip });
    res.json({ card: snapshot });
  })
);

router.post(
  "/controls",
  asyncHandler(async (req, res) => {
    const controls = z.object({ online: z.boolean(), contactless: z.boolean(), atm: z.boolean() }).parse(req.body);
    const card = await myCard(req.userId);
    const snapshot = await getCardIssuingProvider().setControls(card.id, controls);
    await writeAudit(req.userId, "card.controls.updated", { ip: req.ip, controls });
    res.json({ card: snapshot });
  })
);

router.post(
  "/daily-limit",
  asyncHandler(async (req, res) => {
    const { dailyLimit } = z.object({ dailyLimit: z.number().positive() }).parse(req.body);
    const card = await myCard(req.userId);
    const snapshot = await getCardIssuingProvider().setDailyLimit(card.id, dailyLimit);
    await writeAudit(req.userId, "card.daily_limit.updated", { ip: req.ip, dailyLimit });
    res.json({ card: snapshot });
  })
);

// --- Funding: Visa gateway top-up or Original Credit Transaction push ---
// Both are idempotency-key-guarded and KYC-gated — real money enters the
// system here, so a retried request must never be double-processed.
const fundingInput = z.object({ paymentToken: z.string().min(4), amount: z.number().positive() });

// A card top-up adds real, new money to the system from an external
// source (a bank card or a mobile-money push) — unlike an internal
// transfer between the customer's own cards, this genuinely is income
// and needs to show up in Insights/Ledger/Budget the same way a Lipa,
// GePG, or LUKU payment shows up as an expense there.
// getCardIssuingProvider().credit() only updates the card's own balance
// and its CardActivity log (which only ever surfaces in that card's own
// "Activity" tab) — it was never wired to the main Transaction table
// those other features actually read from, so a top-up was previously
// invisible everywhere except the card balance itself. This is called
// after credit() has already succeeded, and deliberately never allowed
// to fail the response back to the customer — the money has genuinely
// already moved by this point, so a customer being told their top-up
// failed when it actually succeeded would be a worse outcome than this
// one transaction record being missing from Insights until the next
// successful top-up.
async function recordTopupTransaction(userId, amount, channelLabel, source) {
  const [wallet, requester, incomeCategory] = await Promise.all([
    prisma.walletMember.findFirstOrThrow({ where: { userId }, include: { wallet: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.category.findFirst({ where: { name: "Income", OR: [{ userId: null }, { userId }] } }),
  ]);
  if (!incomeCategory) return null; // seed hasn't created the Income category on this environment yet — skip rather than crash a successful top-up over it
  const incomeSubcategory = await prisma.subcategory.findFirst({ where: { categoryId: incomeCategory.id, name: "Other Income" } });
  return prisma.transaction.create({
    data: {
      walletId: wallet.walletId,
      categoryId: incomeCategory.id,
      subcategoryId: incomeSubcategory?.id || null,
      amount: Math.abs(amount),
      merchant: channelLabel,
      date: new Date(),
      loggedByUserId: userId,
      loggedByName: requester.firstName,
      source,
      reference: generatePaymentReference(),
      status: "completed",
    },
  });
}

router.post(
  "/topup/gateway",
  asyncHandler(async (req, res) => {
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { paymentToken, amount } = fundingInput.parse(req.body);
    await requireKycIfOverThreshold(req.userId, amount);

    const card = await myCard(req.userId);
    const funding = await getCardFundingProvider().chargeGateway({ paymentToken, amount, currency: "TZS" });
    if (funding.status !== "completed") throw badRequest("Funding did not complete", funding);

    const channelLabel = `Online (${funding.maskedSource})`;
    const snapshot = await getCardIssuingProvider().credit(card.id, { type: "topup", amount, label: `Top-up from ${channelLabel}` });
    try {
      await recordTopupTransaction(req.userId, amount, channelLabel, "topup_gateway");
    } catch (err) {
      console.error("Failed to record top-up as a Transaction (card was still credited successfully)", err); // eslint-disable-line no-console
    }
    const body = { card: snapshot, funding };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "card.topup.gateway", { ip: req.ip, amount, maskedSource: funding.maskedSource });
    await notifyUser(req.userId, { type: "topup", title: "Wallet topped up", message: `You added ${amount.toLocaleString()} TZS from ${channelLabel}`, url: "/pay" });
    res.json(body);
  })
);

router.post(
  "/topup/oct",
  asyncHandler(async (req, res) => {
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { paymentToken, amount } = fundingInput.parse(req.body);
    await requireKycIfOverThreshold(req.userId, amount);

    const card = await myCard(req.userId);
    const funding = await getCardFundingProvider().pushFunds({ paymentToken, amount, currency: "TZS" });
    if (funding.status !== "completed") throw badRequest("Funding did not complete", funding);

    const channelLabel = `OCT (${funding.maskedSource})`;
    const snapshot = await getCardIssuingProvider().credit(card.id, { type: "oct", amount, label: `Instant push from ${channelLabel}` });
    try {
      await recordTopupTransaction(req.userId, amount, channelLabel, "topup_oct");
    } catch (err) {
      console.error("Failed to record top-up as a Transaction (card was still credited successfully)", err); // eslint-disable-line no-console
    }
    const body = { card: snapshot, funding };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "card.topup.oct", { ip: req.ip, amount, maskedSource: funding.maskedSource });
    await notifyUser(req.userId, { type: "topup", title: "Wallet topped up", message: `You added ${amount.toLocaleString()} TZS from ${channelLabel}`, url: "/pay" });
    res.json(body);
  })
);

// --- Payments: Lipa (QR/TIPS), GePG (government bills), LUKU (electricity) ---

router.post(
  "/pay/lipa/resolve",
  asyncHandler(async (req, res) => {
    const { destination } = z.object({ destination: z.string().min(3) }).parse(req.body);
    const recipient = await getPaymentRailProvider().resolveRecipient(destination);
    res.json({ recipient });
  })
);

router.post(
  "/pay/lipa",
  asyncHandler(async (req, res) => {
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { destination, amount, categoryId } = z
      .object({ destination: z.string().min(3), amount: z.number().positive(), categoryId: z.string().min(1) })
      .parse(req.body);
    await requireKycIfOverThreshold(req.userId, amount);

    const card = await myCard(req.userId);
    const rail = getPaymentRailProvider();
    const recipient = await rail.resolveRecipient(destination);
    const payment = await rail.initiatePayment({ destination, amount, currency: "TZS" });
    if (payment.status !== "completed") throw badRequest("Payment did not complete", payment);

    const [snapshot, wallet] = await Promise.all([
      debitCard(card.id, { type: "lipa", amount, label: `Paid to ${recipient.name}` }),
      prisma.walletMember.findFirstOrThrow({ where: { userId: req.userId }, include: { wallet: true } }),
    ]);
    const requester = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const reference = generatePaymentReference();
    const transaction = await prisma.transaction.create({
      data: {
        walletId: wallet.walletId,
        categoryId,
        amount: -Math.abs(amount),
        merchant: recipient.name,
        date: new Date(),
        loggedByUserId: req.userId,
        loggedByName: requester.firstName,
        source: "lipa",
        reference,
        status: "completed",
      },
    });
    const body = { card: snapshot, transaction, payment, reference };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "card.pay.lipa", { ip: req.ip, amount, destination, merchant: recipient.name, reference });
    await notifyUser(req.userId, { type: "payment", title: "Payment sent", message: `You paid ${amount.toLocaleString()} TZS to ${recipient.name} — ref ${reference}`, url: "/pay" });
    res.json(body);
  })
);

router.post(
  "/pay/gepg",
  asyncHandler(async (req, res) => {
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { control, amount, biller, categoryId } = z
      .object({ control: z.string().min(6), amount: z.number().positive(), biller: z.string().min(1), categoryId: z.string().min(1) })
      .parse(req.body);
    await requireKycIfOverThreshold(req.userId, amount);

    const quote = await quoteFee({ userId: req.userId, transactionTypeCode: "GEPG", amount, currency: "TZS", channel: "MOBILE_APP", accountType: "PERSONAL" });
    const totalDebit = Number(quote.totalDebit);

    const card = await myCard(req.userId);
    const snapshot = await debitCard(card.id, { type: "gepg", amount: totalDebit, label: biller, sub: `Control No. ${control}` });
    const wallet = await prisma.walletMember.findFirstOrThrow({ where: { userId: req.userId } });
    const requester = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const reference = generatePaymentReference();
    const transaction = await prisma.transaction.create({
      data: { walletId: wallet.walletId, categoryId, amount: -Math.abs(totalDebit), merchant: biller, date: new Date(), loggedByUserId: req.userId, loggedByName: requester.firstName, source: "gepg", reference, status: "completed" },
    });
    await collectFee(quote.id, reference).catch((err) => console.error("Fee collection failed", err)); // best-effort, never blocks a payment that already succeeded
    const body = { card: snapshot, transaction, reference, fee: { mitaPesaFee: Number(quote.mitaPesaFee), tax: Number(quote.tax) } };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "card.pay.gepg", { ip: req.ip, amount, control, biller, reference, mitaPesaFee: Number(quote.mitaPesaFee) });
    await notifyUser(req.userId, { type: "bill_payment", title: "Bill paid", message: `You paid ${totalDebit.toLocaleString()} TZS to ${biller} — ref ${reference}`, url: "/pay" });
    res.json(body);
  })
);

router.post(
  "/pay/luku",
  asyncHandler(async (req, res) => {
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { meter, amount, categoryId } = z
      .object({ meter: z.string().min(6), amount: z.number().positive(), categoryId: z.string().min(1) })
      .parse(req.body);
    await requireKycIfOverThreshold(req.userId, amount);

    const quote = await quoteFee({ userId: req.userId, transactionTypeCode: "LUKU", amount, currency: "TZS", channel: "MOBILE_APP", accountType: "PERSONAL" });
    const totalDebit = Number(quote.totalDebit);

    const card = await myCard(req.userId);
    const snapshot = await debitCard(card.id, { type: "luku", amount: totalDebit, label: `Meter ${meter}` });
    const token = Array.from({ length: 4 }, () => crypto.randomInt(1000, 9999)).join("-");
    const wallet = await prisma.walletMember.findFirstOrThrow({ where: { userId: req.userId } });
    const requester = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const reference = generatePaymentReference();
    const transaction = await prisma.transaction.create({
      data: { walletId: wallet.walletId, categoryId, amount: -Math.abs(totalDebit), merchant: `LUKU Meter ${meter}`, date: new Date(), loggedByUserId: req.userId, loggedByName: requester.firstName, source: "luku", reference, status: "completed" },
    });
    await collectFee(quote.id, reference).catch((err) => console.error("Fee collection failed", err));
    const body = { card: snapshot, transaction, token, reference, fee: { mitaPesaFee: Number(quote.mitaPesaFee), tax: Number(quote.tax) } };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "card.pay.luku", { ip: req.ip, amount, meter, reference, mitaPesaFee: Number(quote.mitaPesaFee) });
    // The token itself still reflects the electricity value (`amount`) purchased — the fee is a separate charge, not part of the electricity value.
    await notifyUser(req.userId, { type: "bill_payment", title: "Electricity purchased", message: `You bought ${amount.toLocaleString()} TZS of electricity for meter ${meter} — token ${token}`, url: "/pay" });
    res.json(body);
  })
);

module.exports = router;
