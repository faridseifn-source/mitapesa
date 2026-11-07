const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { badRequest } = require("../../lib/errors");
const { assertWalletMember, userWalletIds } = require("../wallets/wallets.helpers");
const { loadProjectForUser, summarizeProject, STATUSES } = require("../../lib/projects");

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  budget: z.number().positive().max(1e12).nullable().optional(),
  targetDate: z.string().nullable().optional(), // ISO date
  walletId: z.string().nullable().optional(), // omit/null = personal project
  note: z.string().max(500).nullable().optional(),
});
const patchSchema = createSchema.omit({ walletId: true }).partial().extend({ status: z.enum(STATUSES).optional() });

const parseDate = (v) => {
  if (v == null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest("Invalid target date");
  return d;
};

const shape = (p, spendRows) => {
  const s = summarizeProject(p, spendRows);
  return {
    id: p.id, name: p.name, status: p.status, walletId: p.walletId, userId: p.userId, note: p.note || null,
    budget: p.budget == null ? null : Number(p.budget), targetDate: p.targetDate ? p.targetDate.toISOString().slice(0, 10) : null,
    createdAt: p.createdAt,
    spent: s.spent, funded: s.funded, count: s.count, remaining: s.remaining, pctUsed: s.pctUsed, health: s.health, daysLeft: s.daysLeft,
  };
};

// GET /projects — my personal projects + projects of every wallet I belong to
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const walletIds = await userWalletIds(req.userId);
    const projects = await prisma.project.findMany({
      where: { OR: [{ userId: req.userId, walletId: null }, { walletId: { in: walletIds } }] },
      orderBy: { createdAt: "desc" },
    });
    const rows = projects.length ? await prisma.transaction.findMany({ where: { projectId: { in: projects.map((p) => p.id) } }, select: { projectId: true, amount: true, date: true } }) : [];
    const by = {};
    for (const r of rows) (by[r.projectId] ||= []).push(r);
    res.json({ projects: projects.map((p) => shape(p, by[p.id] || [])) });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    if (input.walletId) await assertWalletMember(req.userId, input.walletId);
    const project = await prisma.project.create({
      data: { userId: req.userId, walletId: input.walletId || null, name: input.name, budget: input.budget ?? null, targetDate: parseDate(input.targetDate), note: input.note ?? null },
    });
    res.status(201).json({ project: shape(project, []) });
  })
);

// GET /projects/:id — detail: summary + insights + performance + transactions
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const project = await loadProjectForUser(req.userId, req.params.id);
    const rows = await prisma.transaction.findMany({
      where: { projectId: project.id },
      orderBy: { date: "desc" },
      include: { category: true, subcategory: true },
    });
    const summary = summarizeProject(project, rows);
    res.json({
      project: shape(project, rows),
      insights: { byCategory: summary.byCategory, weekly: summary.weekly, biggest: summary.biggest },
      performance: { avgWeeklySpend: summary.avgWeeklySpend, weeksToBudget: summary.weeksToBudget, daysLeft: summary.daysLeft, health: summary.health, remaining: summary.remaining, pctUsed: summary.pctUsed },
      transactions: rows.map((t) => ({
        id: t.id, amount: Number(t.amount), merchant: t.merchant, category: t.category?.name, subcategory: t.subcategory?.name || null,
        date: t.date.toISOString().slice(0, 10), note: t.note || null, loggedBy: t.loggedByName,
      })),
    });
  })
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    const project = await loadProjectForUser(req.userId, req.params.id);
    const data = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.budget !== undefined) data.budget = patch.budget;
    if (patch.targetDate !== undefined) data.targetDate = parseDate(patch.targetDate);
    if (patch.note !== undefined) data.note = patch.note;
    if (patch.status !== undefined) data.status = patch.status;
    const updated = await prisma.project.update({ where: { id: project.id }, data });
    const rows = await prisma.transaction.findMany({ where: { projectId: project.id }, select: { amount: true, date: true } });
    res.json({ project: shape(updated, rows) });
  })
);

// Projects are never deleted — archive them instead (PATCH status "archived"); their transactions stay filed under them.

module.exports = router;
