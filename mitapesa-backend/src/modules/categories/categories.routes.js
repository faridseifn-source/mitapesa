const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { badRequest, notFound, forbidden } = require("../../lib/errors");

const router = Router();
router.use(requireAuth);

const COLOR_POOL = ["#8E5B7F", "#7E8E4E", "#C97B63", "#5E9E8A", "#8C7EA8", "#B0876B", "#6F9BB8", "#A67C52"];

async function nextColor(userId) {
  const used = (await prisma.category.findMany({ where: { OR: [{ userId: null }, { userId }] }, select: { color: true } })).map((c) => c.color);
  return COLOR_POOL.find((c) => !used.includes(c)) || COLOR_POOL[used.length % COLOR_POOL.length];
}

// GET /categories — global defaults + this user's own categories, with subcategories.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { OR: [{ userId: null }, { userId: req.userId }] },
      include: { subcategories: true },
      orderBy: { name: "asc" },
    });
    res.json({ categories });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(req.body);

    const existing = await prisma.category.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, OR: [{ userId: null }, { userId: req.userId }] },
    });
    if (existing) return res.status(200).json({ category: existing });

    const category = await prisma.category.create({
      data: { name, color: await nextColor(req.userId), userId: req.userId },
      include: { subcategories: true },
    });
    res.status(201).json({ category });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(req.body);
    const category = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!category) throw notFound("Category not found");
    if (category.userId !== req.userId) throw forbidden("Cannot edit a shared default category");

    const updated = await prisma.category.update({ where: { id: category.id }, data: { name } });
    res.json({ category: updated });
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!category) throw notFound("Category not found");
    if (category.userId !== req.userId) throw forbidden("Cannot delete a shared default category");
    if (category.name === "Other") throw badRequest("The 'Other' category cannot be deleted");

    const fallback = await prisma.category.findFirst({ where: { name: "Other", OR: [{ userId: null }, { userId: req.userId }] } });

    await prisma.$transaction([
      prisma.transaction.updateMany({ where: { categoryId: category.id }, data: { categoryId: fallback.id, subcategoryId: null } }),
      prisma.budget.deleteMany({ where: { categoryId: category.id } }),
      prisma.category.delete({ where: { id: category.id } }),
    ]);
    res.status(204).send();
  })
);

router.post(
  "/:id/subcategories",
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(req.body);
    const category = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!category) throw notFound("Category not found");

    const existing = await prisma.subcategory.findFirst({ where: { categoryId: category.id, name: { equals: name, mode: "insensitive" } } });
    if (existing) return res.status(200).json({ subcategory: existing });

    const subcategory = await prisma.subcategory.create({ data: { name, categoryId: category.id } });
    res.status(201).json({ subcategory });
  })
);

router.patch(
  "/subcategories/:subId",
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(req.body);
    const subcategory = await prisma.subcategory.update({ where: { id: req.params.subId }, data: { name } });
    res.json({ subcategory });
  })
);

router.delete(
  "/subcategories/:subId",
  asyncHandler(async (req, res) => {
    await prisma.transaction.updateMany({ where: { subcategoryId: req.params.subId }, data: { subcategoryId: null } });
    await prisma.subcategory.delete({ where: { id: req.params.subId } });
    res.status(204).send();
  })
);

module.exports = router;
