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
    const budget = await prisma.budget.upsert({
      where: { userId_categoryId_period: { userId: req.userId, categoryId, period } },
      update: { limit },
      create: { userId: req.userId, categoryId, limit, period },
      include: { category: true },
    });
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

module.exports = router;
