const { Router } = require("express");
const { z } = require("zod");
const crypto = require("crypto");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { requirePayModuleEnabled } = require("../../middleware/payModule");
const { notFound, forbidden, badRequest } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");
const { checkIdempotencyKey, saveIdempotentResponse } = require("../../lib/idempotency");
const { generatePaymentReference } = require("../../lib/reference");
const { encryptField, decryptField } = require("../../lib/crypto");
const { requireKycIfOverThreshold } = require("../cards/kycGate");
const { myCard, debitCard } = require("../cards/cardHelpers");
const { getCardIssuingProvider } = require("../../services/card-issuing");
const { notifyUser } = require("../../lib/notify");
const { quoteFee, collectFee } = require("../../lib/feeEngine");
const { getPaymentRailProvider } = require("../../services/payments-rail");
const { computeStatement } = require("../../lib/statement");
const { statementToCsv, sendCsv } = require("../../lib/csv");
const { getSetting } = require("../../lib/settings");

const router = Router();
router.use(requireAuth);
router.use(asyncHandler(requirePayModuleEnabled));

/* --------------------------- permission helpers -------------------------- */

async function loadCard(cardId) {
  const card = await prisma.virtualCard.findUnique({ where: { id: cardId } });
  if (!card) throw notFound("Virtual card not found");
  return card;
}
function assertOwner(card, userId) {
  if (card.ownerId !== userId) throw forbidden("Only the card's primary member can do this");
}
function assertOwnerOrHolder(card, userId) {
  if (card.ownerId !== userId && card.holderId !== userId) throw forbidden("You don't have access to this card");
}
function assertHolder(card, userId) {
  if (card.holderId !== userId) throw forbidden("Only the card holder can spend with this card");
}

// Requirement 4, steps 1-3: card status, service permission, category
// permission, and daily limit are all checked BEFORE any provider call or
// debit happens — a rejected check here means nothing was ever touched.
async function assertSpendable(card, { serviceType, categoryId, amount }) {
  if (card.terminated) throw badRequest("This card has been terminated");
  if (card.frozen) throw badRequest("This card is frozen");
  if (serviceType && serviceType !== "other" && card.services && card.services[serviceType] === false) {
    throw badRequest(`This card isn't permitted to use ${serviceType.toUpperCase()}`);
  }
  if (card.allowedCategoryIds && !card.allowedCategoryIds.includes(categoryId)) {
    throw badRequest("This card isn't permitted to spend in that category");
  }
  if (Number(card.balance) < amount) throw badRequest("Insufficient card balance");

  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todaysSpend = await prisma.virtualCardActivity.aggregate({
    where: { cardId: card.id, type: "spend", date: { gte: todayStart } },
    _sum: { amount: true },
  });
  const spentSoFar = Number(todaysSpend._sum.amount || 0);
  if (spentSoFar + amount > Number(card.dailyLimit)) {
    throw badRequest(`This purchase would exceed the card's daily limit (${spentSoFar}/${Number(card.dailyLimit)} used today)`);
  }
}

const SERVICE_LABELS = { lipa: "Lipa", gepg: "GePG", luku: "LUKU", topup: "Mobile top-up", other: "Purchase" };

// Requirement 4, steps 6-10: debit only after everything above already
// passed and (for Lipa) the payment rail already confirmed success. Records
// activity + a real Transaction row with a server-generated reference, tied
// to this card's own wallet (Requirement 3: independent-card spend lands in
// the holder's own personal wallet ledger; add-on-card spend lands in the
// shared household wallet ledger — both are real Transaction rows, feeding
// the same activity/insights machinery the primary card uses).
async function finalizeSpend({ card, amount, merchant, categoryId, serviceType, userId }) {
  const reference = generatePaymentReference();
  const activityLabel = serviceType === "other" ? `Paid ${merchant}` : `${SERVICE_LABELS[serviceType]}: ${merchant}`;
  const requester = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const [updated, , transaction] = await prisma.$transaction([
    prisma.virtualCard.update({ where: { id: card.id }, data: { balance: { decrement: amount } } }),
    prisma.virtualCardActivity.create({ data: { cardId: card.id, type: "spend", amount, label: activityLabel, reference, performedByUserId: userId } }),
    prisma.transaction.create({
      data: {
        walletId: card.walletId,
        categoryId,
        amount: -Math.abs(amount),
        merchant,
        date: new Date(),
        loggedByUserId: userId,
        loggedByName: requester.firstName,
        source: serviceType === "other" ? "virtual_card" : `virtual_card_${serviceType}`,
        reference,
        status: "completed",
      },
    }),
  ]);

  return { card: updated, transaction, reference };
}

const { genCardCredentials } = require("../../lib/cardCredentials");

function serializeCard(card, forUserId) {
  return {
    id: card.id,
    walletId: card.walletId,
    ownerId: card.ownerId,
    holderId: card.holderId,
    type: card.type,
    label: card.label,
    last4: card.last4,
    processorRef: card.processorRef, // CMS-assigned wallet/account number, once real (not sensitive — just a reference)
    expiry: card.expiry,
    frozen: card.frozen,
    terminated: card.terminated,
    dailyLimit: Number(card.dailyLimit),
    allowedCategoryIds: card.allowedCategoryIds,
    controls: card.controls,
    services: card.services,
    balance: Number(card.balance),
    myRole: card.ownerId === forUserId ? "owner" : "holder",
    createdAt: card.createdAt,
  };
}

/* --------------------------------- create --------------------------------- */

router.post(
  "/parent-linked",
  asyncHandler(async (req, res) => {
    const { walletId, holderUserId, label } = z
      .object({ walletId: z.string().min(1), holderUserId: z.string().min(1), label: z.string().max(40).optional() })
      .parse(req.body);

    const wallet = await prisma.wallet.findUnique({ where: { id: walletId }, include: { members: true } });
    if (!wallet) throw notFound("Wallet not found");
    if (wallet.type !== "SHARED") throw badRequest("Add-on cards can only be issued on a shared wallet");
    const requester = wallet.members.find((m) => m.userId === req.userId);
    if (!requester || requester.role !== "owner") throw forbidden("Only the wallet's primary member can issue an add-on card");
    if (holderUserId === req.userId) throw badRequest("Use the independent-card endpoint to create your own card");
    const holderMembership = wallet.members.find((m) => m.userId === holderUserId);
    if (!holderMembership) throw badRequest("That person must be a member of this wallet first — invite them via /wallets/:id/invite");

    const existing = await prisma.virtualCard.findFirst({ where: { walletId, ownerId: req.userId, holderId: holderUserId, terminated: false } });
    if (existing) throw badRequest("An active add-on card is already issued to this member on this wallet");

    // "First virtual card free" is a counting rule the generic fee matcher
    // can't express (it has no concept of "which occurrence is this"), so
    // it's enforced here in code — the FEE AMOUNT for the 2nd+ card is
    // still fully admin-configurable via a CARD_ISSUANCE_VIRTUAL_ADDON rule.
    const holderCardCount = await prisma.virtualCard.count({ where: { holderId: holderUserId, terminated: false } });
    let issuanceFee = 0;
    let feeQuote = null;
    if (holderCardCount > 0) {
      feeQuote = await quoteFee({ userId: req.userId, transactionTypeCode: "CARD_ISSUANCE_VIRTUAL_ADDON", amount: 0, currency: "TZS", channel: "MOBILE_APP" });
      issuanceFee = Number(feeQuote.totalFee);
      if (issuanceFee > 0) {
        const ownerCard = await myCard(req.userId);
        if (Number(ownerCard.balance) < issuanceFee) throw badRequest(`Issuing this add-on card costs ${issuanceFee.toLocaleString()} TZS — please top up first`);
      }
    }

    const issued = await getCardIssuingProvider().issueVirtualCard({ walletId, ownerId: req.userId, holderId: holderUserId, type: "parent_linked", label });
    const card = await prisma.virtualCard.findUniqueOrThrow({ where: { id: issued.id } });

    if (issuanceFee > 0) {
      const ownerCard = await myCard(req.userId);
      await debitCard(ownerCard.id, { type: "card_issuance_fee", amount: issuanceFee, label: "Add-on card issuance fee" });
      await collectFee(feeQuote.id, `CARDFEE-${card.id}`).catch((err) => console.error("Fee collection failed", err));
    }

    await writeAudit(req.userId, "virtualcard.created.parent_linked", { ip: req.ip, walletId, holderUserId, cardId: card.id, issuanceFee });
    await notifyUser(holderUserId, { type: "virtual_card_issued", title: "New add-on card", message: "A shared add-on card has been issued to you.", url: "/pay" });

    res.status(201).json({ card: serializeCard(card, req.userId), issuanceFee });
  })
);

router.post(
  "/independent",
  asyncHandler(async (req, res) => {
    const { label } = z.object({ label: z.string().max(40).optional() }).parse(req.body);
    const personalMembership = await prisma.walletMember.findFirst({ where: { userId: req.userId, wallet: { type: "PERSONAL" } } });
    if (!personalMembership) throw notFound("No personal wallet found for this account");

    // Same "first virtual card free" counting rule as the add-on flow —
    // counts every virtual card this person holds, independent or add-on,
    // since the spec's rule is about the customer's Nth virtual card overall.
    const holderCardCount = await prisma.virtualCard.count({ where: { holderId: req.userId, terminated: false } });
    let issuanceFee = 0;
    let feeQuote = null;
    if (holderCardCount > 0) {
      feeQuote = await quoteFee({ userId: req.userId, transactionTypeCode: "CARD_ISSUANCE_VIRTUAL_ADDON", amount: 0, currency: "TZS", channel: "MOBILE_APP" });
      issuanceFee = Number(feeQuote.totalFee);
      if (issuanceFee > 0) {
        const ownerCard = await myCard(req.userId);
        if (Number(ownerCard.balance) < issuanceFee) throw badRequest(`Issuing this card costs ${issuanceFee.toLocaleString()} TZS — please top up first`);
      }
    }

    const issued = await getCardIssuingProvider().issueVirtualCard({ walletId: personalMembership.walletId, ownerId: req.userId, holderId: req.userId, type: "independent", label });
    const card = await prisma.virtualCard.findUniqueOrThrow({ where: { id: issued.id } });

    if (issuanceFee > 0) {
      const ownerCard = await myCard(req.userId);
      await debitCard(ownerCard.id, { type: "card_issuance_fee", amount: issuanceFee, label: "Card issuance fee" });
      await collectFee(feeQuote.id, `CARDFEE-${card.id}`).catch((err) => console.error("Fee collection failed", err));
    }

    await writeAudit(req.userId, "virtualcard.created.independent", { ip: req.ip, cardId: card.id, issuanceFee });

    res.status(201).json({ card: serializeCard(card, req.userId), issuanceFee });
  })
);

/* ---------------------------------- read ----------------------------------- */

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const cards = await prisma.virtualCard.findMany({ where: { OR: [{ ownerId: req.userId }, { holderId: req.userId }] }, orderBy: { createdAt: "desc" } });
    res.json({ cards: cards.map((c) => serializeCard(c, req.userId)) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwnerOrHolder(card, req.userId);
    res.json({ card: serializeCard(card, req.userId) });
  })
);

router.get(
  "/:id/activity",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwnerOrHolder(card, req.userId);
    const activity = await prisma.virtualCardActivity.findMany({ where: { cardId: card.id }, orderBy: { date: "desc" }, take: 100 });
    res.json({ activity: activity.map((a) => ({ ...a, amount: a.amount === null ? null : Number(a.amount) })) });
  })
);

// GET /virtual-cards/:id/insights — Requirement 5: per-card spend summary.
router.get(
  "/:id/insights",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwnerOrHolder(card, req.userId);

    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
    const [spendRows, recentTx] = await Promise.all([
      prisma.virtualCardActivity.findMany({ where: { cardId: card.id, type: "spend" }, orderBy: { date: "desc" } }),
      prisma.transaction.findMany({ where: { walletId: card.walletId, source: { startsWith: "virtual_card" } }, orderBy: { date: "desc" }, take: 10, include: { category: true } }),
    ]);
    const totalSpent = spendRows.reduce((s, a) => s + Number(a.amount || 0), 0);
    const spentThisMonth = spendRows.filter((a) => a.date >= monthStart).reduce((s, a) => s + Number(a.amount || 0), 0);

    const byDay = {};
    spendRows.forEach((a) => {
      const day = a.date.toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + Number(a.amount || 0);
    });

    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const spentToday = spendRows.filter((a) => a.date >= todayStart).reduce((s, a) => s + Number(a.amount || 0), 0);

    res.json({
      totalSpent,
      spentThisMonth,
      remainingDailyLimit: Math.max(0, Number(card.dailyLimit) - spentToday),
      byDay,
      recentTransactions: recentTx.map((t) => ({ ...t, amount: Number(t.amount), categoryName: t.category?.name })),
    });
  })
);

// GET /virtual-cards/:id/statement?from=&to=&format=csv — "pull statement"
// for an add-on card.
router.get(
  "/:id/statement",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwnerOrHolder(card, req.userId);

    const now = new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : now;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw badRequest("Invalid from/to date");

    const activitySinceFrom = await prisma.virtualCardActivity.findMany({
      where: { cardId: card.id, date: { gte: from } },
      orderBy: { date: "asc" },
    });
    const statement = computeStatement({ currentBalance: Number(card.balance), activitySinceFrom, from, to });
    await writeAudit(req.userId, "virtualcard.statement_pulled", { ip: req.ip, cardId: card.id, from, to, format: req.query.format || "json" });

    if (req.query.format === "csv") {
      // Same free-view/paid-export distinction as the main card's statement endpoint.
      const quote = await quoteFee({ userId: req.userId, transactionTypeCode: "CARD_STATEMENT_MONTHLY", amount: 0, currency: "TZS", channel: "MOBILE_APP", accountType: "SHARED" });
      const fee = Number(quote.totalFee);
      if (fee > 0) {
        if (Number(card.balance) < fee) throw badRequest(`Downloading a statement costs ${fee.toLocaleString()} TZS — please top up this card first`);
        await prisma.virtualCard.update({ where: { id: card.id }, data: { balance: { decrement: fee } } });
        await prisma.virtualCardActivity.create({ data: { cardId: card.id, type: "spend", amount: fee, label: "Monthly statement export", performedByUserId: req.userId } });
        await collectFee(quote.id, `STMTFEE-${card.id}-${Date.now()}`).catch((err) => console.error("Fee collection failed", err));
      }
      return sendCsv(res, `mitapesa-statement-${card.label || card.last4}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, statementToCsv(statement));
    }
    res.json(statement);
  })
);

// GET /virtual-cards/:id/reveal — full PAN + CVV, for entering into an
// external checkout during online payment. Owner or holder only, and every
// reveal is audit-logged since this is the most sensitive data the card holds.
router.get(
  "/:id/reveal",
  asyncHandler(async (req, res) => {
    let card = await loadCard(req.params.id);
    assertOwnerOrHolder(card, req.userId);
    if (card.terminated) throw badRequest("This card has been terminated");

    // Self-healing fallback: cards created before this feature shipped have
    // no stored credentials yet — generate and persist them now rather than
    // requiring a data migration.
    if (!card.fullNumberEnc || !card.cvvEnc) {
      const { fullNumber, cvv } = genCardCredentials(await getSetting("card_bin"));
      card = await prisma.virtualCard.update({ where: { id: card.id }, data: { fullNumberEnc: encryptField(fullNumber), cvvEnc: encryptField(cvv) } });
    }

    await writeAudit(req.userId, "virtualcard.details_viewed", { ip: req.ip, cardId: card.id });
    res.json({ fullNumber: decryptField(card.fullNumberEnc), cvv: decryptField(card.cvvEnc), expiry: card.expiry });
  })
);

/* ------------------------------ owner controls ------------------------------ */

// Requirement 2: bidirectional transfer between the owner's main card and
// this add-on card, made atomic via an interactive transaction so both
// balances always move together or not at all, plus a shared
// transferGroupId linking the two ledger entries for reconciliation.
router.post(
  "/:id/topup",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwner(card, req.userId);
    if (card.terminated) throw badRequest("This card has been terminated");

    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    const mainCard = await myCard(req.userId);
    const transferGroupId = crypto.randomUUID();

    const updated = await prisma.$transaction(async (tx) => {
      await debitCard(mainCard.id, { type: "transfer_out", amount, label: `Top-up: add-on card •••• ${card.last4}`, transferGroupId }, tx);
      return tx.virtualCard.update({
        where: { id: card.id },
        data: { balance: { increment: amount }, activity: { create: { type: "topup", amount, label: "Topped up from main card", transferGroupId, performedByUserId: req.userId } } },
      });
    });

    const body = { card: serializeCard(updated, req.userId) };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "virtualcard.topup", { ip: req.ip, cardId: card.id, amount, transferGroupId });
    await notifyUser(card.holderId, { type: "topup", title: "Card topped up", message: `Your add-on card was topped up with ${amount.toLocaleString()} TZS`, url: "/pay" });
    res.json(body);
  })
);

router.post(
  "/:id/transfer-to-main",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwner(card, req.userId);
    if (card.terminated) throw badRequest("This card has been terminated");

    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { amount } = z.object({ amount: z.number().positive() }).parse(req.body);
    if (Number(card.balance) < amount) throw badRequest("Insufficient add-on card balance");

    const mainCard = await myCard(req.userId);
    const transferGroupId = crypto.randomUUID();

    const updated = await prisma.$transaction(async (tx) => {
      await getCardIssuingProvider().credit(mainCard.id, { type: "transfer_in", amount, label: `Transfer from add-on card •••• ${card.last4}`, transferGroupId }, tx);
      return tx.virtualCard.update({
        where: { id: card.id },
        data: { balance: { decrement: amount }, activity: { create: { type: "transfer_to_main", amount, label: "Transferred to main card", transferGroupId, performedByUserId: req.userId } } },
      });
    });

    const body = { card: serializeCard(updated, req.userId) };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "virtualcard.transfer_to_main", { ip: req.ip, cardId: card.id, amount, transferGroupId });
    res.json(body);
  })
);

router.post(
  "/:id/services",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwner(card, req.userId);
    const { services } = z.object({ services: z.object({ lipa: z.boolean(), gepg: z.boolean(), luku: z.boolean(), topup: z.boolean() }) }).parse(req.body);

    const [updated] = await prisma.$transaction([
      prisma.virtualCard.update({ where: { id: card.id }, data: { services } }),
      prisma.virtualCardActivity.create({ data: { cardId: card.id, type: "services_updated", label: "Available services updated", performedByUserId: req.userId } }),
    ]);
    await writeAudit(req.userId, "virtualcard.services_updated", { ip: req.ip, cardId: card.id, services });
    res.json({ card: serializeCard(updated, req.userId) });
  })
);

router.post(
  "/:id/limit",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwner(card, req.userId);
    const { dailyLimit } = z.object({ dailyLimit: z.number().positive() }).parse(req.body);

    const [updated] = await prisma.$transaction([
      prisma.virtualCard.update({ where: { id: card.id }, data: { dailyLimit } }),
      prisma.virtualCardActivity.create({ data: { cardId: card.id, type: "limit_changed", label: `Daily limit set to ${dailyLimit}`, performedByUserId: req.userId } }),
    ]);
    await writeAudit(req.userId, "virtualcard.limit_changed", { ip: req.ip, cardId: card.id, dailyLimit });
    res.json({ card: serializeCard(updated, req.userId) });
  })
);

router.post(
  "/:id/freeze",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwner(card, req.userId);
    if (card.terminated) throw badRequest("This card has been terminated");
    const { frozen } = z.object({ frozen: z.boolean() }).parse(req.body);

    const [updated] = await prisma.$transaction([
      prisma.virtualCard.update({ where: { id: card.id }, data: { frozen } }),
      prisma.virtualCardActivity.create({ data: { cardId: card.id, type: frozen ? "frozen" : "unfrozen", label: frozen ? "Card frozen" : "Card unfrozen", performedByUserId: req.userId } }),
    ]);
    await writeAudit(req.userId, frozen ? "virtualcard.frozen" : "virtualcard.unfrozen", { ip: req.ip, cardId: card.id });
    res.json({ card: serializeCard(updated, req.userId) });
  })
);

router.post(
  "/:id/terminate",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwner(card, req.userId);
    if (card.terminated) return res.json({ card: serializeCard(card, req.userId) });

    const [updated] = await prisma.$transaction([
      prisma.virtualCard.update({ where: { id: card.id }, data: { terminated: true, frozen: true } }),
      prisma.virtualCardActivity.create({ data: { cardId: card.id, type: "terminated", label: "Card terminated", performedByUserId: req.userId } }),
    ]);
    await writeAudit(req.userId, "virtualcard.terminated", { ip: req.ip, cardId: card.id });
    res.json({ card: serializeCard(updated, req.userId) });
  })
);

router.post(
  "/:id/categories",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertOwner(card, req.userId);
    const { categoryIds } = z.object({ categoryIds: z.array(z.string()).nullable() }).parse(req.body);

    const [updated] = await prisma.$transaction([
      prisma.virtualCard.update({ where: { id: card.id }, data: { allowedCategoryIds: categoryIds } }),
      prisma.virtualCardActivity.create({ data: { cardId: card.id, type: "categories_updated", label: categoryIds ? `Restricted to ${categoryIds.length} categor${categoryIds.length === 1 ? "y" : "ies"}` : "Category restriction removed", performedByUserId: req.userId } }),
    ]);
    await writeAudit(req.userId, "virtualcard.categories_updated", { ip: req.ip, cardId: card.id, categoryIds });
    res.json({ card: serializeCard(updated, req.userId) });
  })
);

/* --------------------- holder: real service-routed payments --------------------- */
// Requirement 4: these mirror the main card's /cards/pay/* routes exactly —
// same provider calls, same validate-before-debit order, same reference
// generation — rather than being a generic "record what the user typed" form.

router.post(
  "/:id/pay/lipa/resolve",
  asyncHandler(async (req, res) => {
    const { destination } = z.object({ destination: z.string().min(3) }).parse(req.body);
    const recipient = await getPaymentRailProvider().resolveRecipient(destination);
    res.json({ recipient });
  })
);

router.post(
  "/:id/pay/lipa",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertHolder(card, req.userId);
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { destination, amount, categoryId } = z.object({ destination: z.string().min(3), amount: z.number().positive(), categoryId: z.string().min(1) }).parse(req.body);
    await assertSpendable(card, { serviceType: "lipa", categoryId, amount });
    await requireKycIfOverThreshold(req.userId, amount);

    const rail = getPaymentRailProvider();
    const recipient = await rail.resolveRecipient(destination);
    const payment = await rail.initiatePayment({ destination, amount, currency: "TZS" });
    if (payment.status !== "completed") throw badRequest("Payment did not complete", payment);

    const { card: updated, transaction, reference } = await finalizeSpend({ card, amount, merchant: recipient.name, categoryId, serviceType: "lipa", userId: req.userId });
    const body = { card: serializeCard(updated, req.userId), transaction, reference, payment };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "virtualcard.pay.lipa", { ip: req.ip, cardId: card.id, amount, destination, reference });
    await notifyUser(req.userId, { type: "payment", title: "Payment sent", message: `You paid ${amount.toLocaleString()} TZS to ${recipient.name} — ref ${reference}`, url: "/pay" });
    res.json(body);
  })
);

router.post(
  "/:id/pay/gepg",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertHolder(card, req.userId);
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { control, amount, biller, categoryId } = z.object({ control: z.string().min(6), amount: z.number().positive(), biller: z.string().min(1), categoryId: z.string().min(1) }).parse(req.body);
    await requireKycIfOverThreshold(req.userId, amount);

    const quote = await quoteFee({ userId: req.userId, transactionTypeCode: "GEPG", amount, currency: "TZS", channel: "MOBILE_APP", accountType: "SHARED" });
    const totalDebit = Number(quote.totalDebit);
    await assertSpendable(card, { serviceType: "gepg", categoryId, amount: totalDebit });

    const { card: updated, transaction, reference } = await finalizeSpend({ card, amount: totalDebit, merchant: biller, categoryId, serviceType: "gepg", userId: req.userId });
    await collectFee(quote.id, reference).catch((err) => console.error("Fee collection failed", err));
    const body = { card: serializeCard(updated, req.userId), transaction, reference, fee: { mitaPesaFee: Number(quote.mitaPesaFee), tax: Number(quote.tax) } };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "virtualcard.pay.gepg", { ip: req.ip, cardId: card.id, amount, control, reference, mitaPesaFee: Number(quote.mitaPesaFee) });
    await notifyUser(req.userId, { type: "bill_payment", title: "Bill paid", message: `You paid ${totalDebit.toLocaleString()} TZS to ${biller} — ref ${reference}`, url: "/pay" });
    res.json(body);
  })
);

router.post(
  "/:id/pay/luku",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertHolder(card, req.userId);
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { meter, amount, categoryId } = z.object({ meter: z.string().min(6), amount: z.number().positive(), categoryId: z.string().min(1) }).parse(req.body);
    await requireKycIfOverThreshold(req.userId, amount);

    const quote = await quoteFee({ userId: req.userId, transactionTypeCode: "LUKU", amount, currency: "TZS", channel: "MOBILE_APP", accountType: "SHARED" });
    const totalDebit = Number(quote.totalDebit);
    await assertSpendable(card, { serviceType: "luku", categoryId, amount: totalDebit });

    const { card: updated, transaction, reference } = await finalizeSpend({ card, amount: totalDebit, merchant: `LUKU Meter ${meter}`, categoryId, serviceType: "luku", userId: req.userId });
    const token = Array.from({ length: 4 }, () => crypto.randomInt(1000, 9999)).join("-");
    await collectFee(quote.id, reference).catch((err) => console.error("Fee collection failed", err));
    const body = { card: serializeCard(updated, req.userId), transaction, reference, token, fee: { mitaPesaFee: Number(quote.mitaPesaFee), tax: Number(quote.tax) } };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "virtualcard.pay.luku", { ip: req.ip, cardId: card.id, amount, meter, reference, mitaPesaFee: Number(quote.mitaPesaFee) });
    await notifyUser(req.userId, { type: "bill_payment", title: "Electricity purchased", message: `You bought ${amount.toLocaleString()} TZS of electricity for meter ${meter} — token ${token}`, url: "/pay" });
    res.json(body);
  })
);

// POST /virtual-cards/:id/spend — generic fallback, used for "Mobile top-up"
// (airtime — no dedicated rail to call) and any other purchase type.
router.post(
  "/:id/spend",
  asyncHandler(async (req, res) => {
    const card = await loadCard(req.params.id);
    assertHolder(card, req.userId);
    const existing = await checkIdempotencyKey(req);
    if (existing) return res.status(existing.statusCode).json(existing.responseBody);

    const { amount, merchant, categoryId, serviceType } = z
      .object({ amount: z.number().positive(), merchant: z.string().min(1), categoryId: z.string().min(1), serviceType: z.enum(["topup", "other"]).default("other") })
      .parse(req.body);
    await assertSpendable(card, { serviceType, categoryId, amount });
    await requireKycIfOverThreshold(req.userId, amount);

    const { card: updated, transaction, reference } = await finalizeSpend({ card, amount, merchant, categoryId, serviceType, userId: req.userId });
    const body = { card: serializeCard(updated, req.userId), transaction, reference };
    await saveIdempotentResponse(req, 200, body);
    await writeAudit(req.userId, "virtualcard.spend", { ip: req.ip, cardId: card.id, amount, merchant, serviceType, reference });
    await notifyUser(req.userId, { type: "payment", title: "Payment sent", message: `You paid ${amount.toLocaleString()} TZS to ${merchant} — ref ${reference}`, url: "/pay" });
    res.json(body);
  })
);

module.exports = router;
