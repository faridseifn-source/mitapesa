const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, forbidden } = require("../../lib/errors");

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const budgets = await prisma.budget.findMany({ where: { userId: req.userId }, include: { category: true } });
    res.json({ budgets });
  })
);

const upsertSchema = z.object({
  categoryId: z.string().min(1),
  limit: z.number().positive(),
  period: z.enum(["monthly", "weekly"]).default("monthly"),
});

router.put(
  "/",
  asyncHandler(async (req, res) => {
    const { categoryId, limit, period } = upsertSchema.parse(req.body);
    const existing = await prisma.budget.findUnique({
      where: { userId_categoryId_period: { userId: req.userId, categoryId, period } },
    });
    // Record a history entry only when the limit is genuinely new or has
    // actually changed — not on every save, or re-saving an unchanged
    // value would pollute the lifetime-limit calculation below with
    // spurious extra segments. This history is append-only (see the
    // schema comment on BudgetLimitHistory) — it's what lets "lifetime
    // budget" be a real, honest figure instead of just today's limit
    // multiplied by an arbitrary number of months.
    const limitChanged = !existing || Number(existing.limit) !== limit;
    const [budget] = await prisma.$transaction([
      prisma.budget.upsert({
        where: { userId_categoryId_period: { userId: req.userId, categoryId, period } },
        update: { limit },
        create: { userId: req.userId, categoryId, limit, period },
        include: { category: true },
      }),
      ...(limitChanged
        ? [prisma.budgetLimitHistory.create({ data: { userId: req.userId, categoryId, limit, period } })]
        : []),
    ]);
    res.json({ budget });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const budget = await prisma.budget.findUnique({ where: { id: req.params.id } });
    if (!budget) throw notFound("Budget not found");
    if (budget.userId !== req.userId) throw forbidden();
    await prisma.budget.delete({ where: { id: budget.id } });
    res.status(204).send();
  })
);

// GET /budgets/lifetime-limit
// Sums what each category's budget limit actually was, for every calendar
// month the customer has used the app — not just today's limits multiplied
// by a month count, which would be wrong the moment any limit is ever
// changed. Pairs with the Home page hero card's "lifetime" view; the
// "this month" view doesn't need this endpoint at all, since today's
// limits (from GET /budgets) are already correct for that.
router.get(
  "/lifetime-limit",
  asyncHandler(async (req, res) => {
    const personalWallet = await prisma.wallet.findFirst({
      where: { type: "PERSONAL", members: { some: { userId: req.userId } } },
    });
    const earliestTx = personalWallet
      ? await prisma.transaction.findFirst({
          where: { walletId: personalWallet.id },
          orderBy: { date: "asc" },
          select: { date: true },
        })
      : null;

    if (!earliestTx) {
      return res.json({ lifetimeLimit: 0 });
    }

    const history = await prisma.budgetLimitHistory.findMany({
      where: { userId: req.userId, period: "monthly" },
      orderBy: [{ categoryId: "asc" }, { effectiveFrom: "asc" }],
    });

    const monthIndexOf = (d) => d.getFullYear() * 12 + d.getMonth();
    const startIdx = monthIndexOf(earliestTx.date);
    const nowIdx = monthIndexOf(new Date());

    const byCategory = new Map();
    for (const h of history) {
      if (!byCategory.has(h.categoryId)) byCategory.set(h.categoryId, []);
      byCategory.get(h.categoryId).push({ limit: Number(h.limit), fromIdx: monthIndexOf(h.effectiveFrom) });
    }

    let lifetimeLimit = 0;
    for (const segments of byCategory.values()) {
      // Months before this category's earliest recorded change predate
      // history tracking (or predate the category having a budget at
      // all) — the only honest assumption available for those months is
      // the earliest known limit, so that's carried backward to startIdx.
      // This is an approximation for pre-existing accounts, not a gap in
      // the logic — real accuracy begins the first time a limit is set
      // or changed after this feature shipped.
      for (let m = startIdx; m <= nowIdx; m++) {
        let activeLimit = segments[0].limit;
        for (const seg of segments) {
          if (seg.fromIdx <= m) activeLimit = seg.limit;
          else break;
        }
        lifetimeLimit += activeLimit;
      }
    }

    res.json({ lifetimeLimit: Math.round(lifetimeLimit * 100) / 100 });
  })
);

module.exports = router;
