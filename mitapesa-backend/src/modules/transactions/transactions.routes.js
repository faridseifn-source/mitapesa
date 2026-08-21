const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, forbidden, badRequest } = require("../../lib/errors");
const { assertWalletMember, userWalletIds } = require("../wallets/wallets.helpers");
const { notifyUser } = require("../../lib/notify");
const { getSetting } = require("../../lib/settings");
const { csvRow, sendCsv } = require("../../lib/csv");
const { convertToTZS } = require("../../lib/currencyConversion");

const router = Router();
router.use(requireAuth);

const txInput = z.object({
  walletId: z.string().min(1),
  categoryId: z.string().min(1),
  subcategoryId: z.string().min(1).optional().nullable(),
  amount: z.number(), // negative = expense, positive = income. If `currency` below is set and differs from the customer's preferredCurrency, this is interpreted as the amount IN THAT currency, not the customer's own — converted before storage.
  currency: z.string().length(3).optional(), // ISO 4217 — omit for an ordinary same-currency entry
  merchant: z.string().min(1),
  note: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  date: z.string(), // ISO date
  source: z.enum(["manual", "scan", "voice", "import", "lipa", "gepg", "luku"]).default("manual"),
});

// GET /transactions?walletId=&from=&to=&category=&format=csv
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const walletIds = await userWalletIds(req.userId);
    const { walletId, from, to, categoryId } = req.query;

    if (walletId && !walletIds.includes(walletId)) throw forbidden("Not a member of this wallet");

    const where = {
      walletId: walletId ? walletId : { in: walletIds },
      ...(categoryId ? { categoryId } : {}),
      ...(from || to
        ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    };

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      include: { category: true, subcategory: true },
    });

    if (req.query.format === "csv") {
      const enabled = (await getSetting("pfm_export_enabled")) !== "false";
      if (!enabled) throw forbidden("Exporting your transaction history is currently turned off.");
      if (!from || !to) throw badRequest("Select a date range to export.");

      let out = csvRow(["MitaPesa Transaction Export"]);
      out += csvRow(["Period", `${from} to ${to}`]);
      out += csvRow(["Generated", new Date().toISOString()]);
      out += csvRow(["Total transactions", transactions.length]);
      out += csvRow([]);
      out += csvRow(["Date", "Merchant", "Category", "Subcategory", "Type", "Amount TZS", "Note"]);
      for (const tx of transactions) {
        out += csvRow([
          tx.date.toISOString().slice(0, 10),
          tx.merchant,
          tx.category?.name || "",
          tx.subcategory?.name || "",
          Number(tx.amount) >= 0 ? "Income" : "Expense",
          Math.abs(Number(tx.amount)),
          tx.note || "",
        ]);
      }
      return sendCsv(res, `mitapesa-transactions-${from}-to-${to}.csv`, out);
    }

    res.json({ transactions });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = txInput.parse(req.body);
    await assertWalletMember(req.userId, input.walletId);

    const requester = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const { currency, ...rest } = input;
    let amountFields = { amount: input.amount, originalAmount: null, originalCurrency: null, exchangeRate: null };
    if (currency && currency !== "TZS") {
      try {
        amountFields = await convertToTZS({ amount: input.amount, currency });
      } catch (err) {
        console.error("Currency conversion failed for manual transaction entry:", err.message); // eslint-disable-line no-console
        throw badRequest(`Couldn't convert from ${currency} right now — please enter the amount in TZS instead, or try again shortly.`);
      }
    }
    delete rest.amount;

    const transaction = await prisma.transaction.create({
      data: {
        ...rest,
        ...amountFields,
        date: new Date(input.date),
        loggedByUserId: req.userId,
        loggedByName: `${requester.firstName}`,
      },
      include: { category: true, subcategory: true, wallet: true },
    });

    // Only shared wallets notify — and only the OTHER members, never the
    // person who just logged it (they already see it appear in their own
    // UI immediately; notifying them too would just be noise).
    if (transaction.wallet.type === "SHARED") {
      const otherMembers = await prisma.walletMember.findMany({ where: { walletId: input.walletId, userId: { not: req.userId } } });
      await Promise.all(otherMembers.map((m) => notifyUser(m.userId, {
        type: "shared_expense",
        title: "New shared expense",
        message: `${requester.firstName} logged ${Math.abs(Number(transaction.amount)).toLocaleString()} TZS at ${transaction.merchant}`,
        url: "/",
      })));
    }

    res.status(201).json({ transaction });
  })
);

// Bulk import (e.g. bank statement ingest, already parsed client-side).
router.post(
  "/bulk",
  asyncHandler(async (req, res) => {
    const items = z.array(txInput).min(1).parse(req.body.transactions);
    const walletIds = [...new Set(items.map((i) => i.walletId))];
    for (const walletId of walletIds) await assertWalletMember(req.userId, walletId);

    const requester = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const created = await prisma.$transaction(
      items.map((input) =>
        prisma.transaction.create({
          data: { ...input, date: new Date(input.date), loggedByUserId: req.userId, loggedByName: requester.firstName, source: "import" },
        })
      )
    );
    res.status(201).json({ transactions: created });
  })
);

// Sources verified by a real external channel (a card gateway charge, an
// instant push confirmed by the sending bank) — the record of what
// actually happened has to match that channel exactly. A customer editing
// the amount/date/who-it-was-from afterward would create a mismatch
// between MitaPesa's ledger and the verified movement that channel
// actually confirmed, which is a real integrity problem for anything
// downstream (reconciliation, insights, eventually the bank relationship
// itself) - not something to allow just because the UI happens to let
// any transaction be edited. Category, subcategory, and note stay
// editable regardless, since those are the customer's own classification
// of *why* they received it, not a claim about what happened.
const VERIFIED_CHANNEL_SOURCES = ["topup_gateway", "topup_oct"];
const LOCKED_FIELDS_FOR_VERIFIED_SOURCES = ["amount", "merchant", "date", "source"];

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = txInput.partial().parse(req.body);
    const existing = await prisma.transaction.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Transaction not found");
    await assertWalletMember(req.userId, existing.walletId);

    if (VERIFIED_CHANNEL_SOURCES.includes(existing.source)) {
      const lockedFieldAttempted = LOCKED_FIELDS_FOR_VERIFIED_SOURCES.find((field) => field in patch);
      if (lockedFieldAttempted) {
        throw badRequest("This top-up was verified by the payment channel that processed it, so its amount, source, and date can't be changed here — only the note and category can be edited.");
      }
    }

    const transaction = await prisma.transaction.update({
      where: { id: existing.id },
      data: { ...patch, ...(patch.date ? { date: new Date(patch.date) } : {}) },
      include: { category: true, subcategory: true },
    });
    res.json({ transaction });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.transaction.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Transaction not found");
    await assertWalletMember(req.userId, existing.walletId);
    await prisma.transaction.delete({ where: { id: existing.id } });
    res.status(204).send();
  })
);

router.post(
  "/bulk-delete",
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
    const existing = await prisma.transaction.findMany({ where: { id: { in: ids } } });
    const walletIds = [...new Set(existing.map((t) => t.walletId))];
    if (walletIds.length === 0) throw badRequest("No matching transactions");
    for (const walletId of walletIds) await assertWalletMember(req.userId, walletId);

    await prisma.transaction.deleteMany({ where: { id: { in: ids } } });
    res.status(204).send();
  })
);

module.exports = router;
