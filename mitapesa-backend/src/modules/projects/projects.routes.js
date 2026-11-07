const { Router } = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { badRequest, forbidden } = require("../../lib/errors");
const { assertWalletMember, userWalletIds } = require("../wallets/wallets.helpers");
const { loadProjectForUser, summarizeProject, resolveProjectCategoryIds, STATUSES } = require("../../lib/projects");
const { templatesForClient, TEMPLATES } = require("../../lib/projectTemplates");
const { getSetting } = require("../../lib/settings");
const { checkUsageAllowed, recordUsage } = require("../../lib/aiUsage");
const { getAnalyticsAssistantProvider } = require("../../services/analytics");
const { writeAudit } = require("../../lib/audit");

const router = Router();
router.use(requireAuth);

const suggestLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

const TYPE_KEYS = TEMPLATES.map((t) => t.key);
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  budget: z.number().positive().max(1e12).nullable().optional(),
  targetDate: z.string().nullable().optional(), // ISO date
  walletId: z.string().nullable().optional(), // omit/null = personal project
  note: z.string().max(500).nullable().optional(),
  type: z.enum(TYPE_KEYS).nullable().optional(), // which template it started from
  categories: z.array(z.string().max(40)).max(12).optional(), // this project's own category set (names)
});
const patchSchema = createSchema.omit({ walletId: true, type: true }).partial().extend({ status: z.enum(STATUSES).optional() });

const parseDate = (v) => {
  if (v == null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest("Invalid target date");
  return d;
};

// catMap: { [categoryId]: {id,name,color} } for every category referenced by the projects being shaped.
const shape = (p, spendRows, catMap = {}) => {
  const s = summarizeProject(p, spendRows);
  return {
    id: p.id, name: p.name, status: p.status, walletId: p.walletId, userId: p.userId, note: p.note || null, type: p.type || null,
    budget: p.budget == null ? null : Number(p.budget), targetDate: p.targetDate ? p.targetDate.toISOString().slice(0, 10) : null,
    createdAt: p.createdAt,
    categories: (p.categoryIds || []).map((id) => catMap[id]).filter(Boolean),
    spent: s.spent, funded: s.funded, count: s.count, remaining: s.remaining, pctUsed: s.pctUsed, health: s.health, daysLeft: s.daysLeft,
  };
};
async function categoryMapFor(projects) {
  const ids = [...new Set(projects.flatMap((p) => p.categoryIds || []))];
  if (!ids.length) return {};
  const rows = await prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, color: true } });
  return Object.fromEntries(rows.map((c) => [c.id, c]));
}

// GET /projects/templates — project types with recommended starting categories (plain data, no AI, no cost)
router.get("/templates", asyncHandler(async (req, res) => { res.json({ templates: templatesForClient() }); }));

// POST /projects/suggest { description, language } — optional AI help: suggests a starting category set for a custom project.
// Metered like the other AI features (own free allowance, spend ceiling, switch). Names only in and out.
router.post(
  "/suggest",
  suggestLimiter,
  asyncHandler(async (req, res) => {
    const { description, language } = z.object({ description: z.string().trim().min(3).max(300), language: z.enum(["en", "sw"]).default("en") }).parse(req.body);
    if ((await getSetting("project_ai_enabled")) === "false") throw forbidden("AI suggestions are turned off right now.");
    const usage = await checkUsageAllowed(req.userId, "project_ai");
    if (!usage.allowed) throw forbidden(usage.reason || "You've used your free AI suggestions for this month.", { canPurchaseCredits: false });

    let result;
    try {
      result = await getAnalyticsAssistantProvider().suggestProjectCategories({ description, language });
    } catch (err) {
      console.error("Project category suggestion failed:", err.message); // eslint-disable-line no-console
      throw badRequest("We couldn't come up with suggestions just now. Pick a project type or add your own categories.");
    }
    if (result.unavailable) return res.json({ available: false, title: null, categories: [] });
    await recordUsage(req.userId, "project_ai", result.estimatedCostUsd || 0, usage.usingCreditId);
    await writeAudit(req.userId, "project.ai_suggest", { ip: req.ip, suggested: result.categories.length }); // never the description text
    res.json({ available: true, title: result.title, categories: result.categories });
  })
);

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
    const catMap = await categoryMapFor(projects);
    res.json({ projects: projects.map((p) => shape(p, by[p.id] || [], catMap)) });
  })
);

router.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    if (input.walletId) await assertWalletMember(req.userId, input.walletId);
    const categoryIds = await resolveProjectCategoryIds(req.userId, input.categories || []);
    const project = await prisma.project.create({
      data: { userId: req.userId, walletId: input.walletId || null, name: input.name, budget: input.budget ?? null, targetDate: parseDate(input.targetDate), note: input.note ?? null, type: input.type || null, categoryIds },
    });
    res.status(201).json({ project: shape(project, [], await categoryMapFor([project])) });
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
      project: shape(project, rows, await categoryMapFor([project])),
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
    // Replacing the category set never touches existing transactions: a transaction keeps the category it was saved with.
    if (patch.categories !== undefined) data.categoryIds = await resolveProjectCategoryIds(req.userId, patch.categories);
    const updated = await prisma.project.update({ where: { id: project.id }, data });
    const rows = await prisma.transaction.findMany({ where: { projectId: project.id }, select: { amount: true, date: true } });
    res.json({ project: shape(updated, rows, await categoryMapFor([updated])) });
  })
);

// POST /projects/:id/categories { name } — add one of the customer's own categories to a project (from the Add transaction screen)
router.post(
  "/:id/categories",
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(2).max(40) }).parse(req.body);
    const project = await loadProjectForUser(req.userId, req.params.id);
    const [id] = await resolveProjectCategoryIds(req.userId, [name]);
    const categoryIds = [...new Set([...(project.categoryIds || []), id])];
    const updated = await prisma.project.update({ where: { id: project.id }, data: { categoryIds } });
    const catMap = await categoryMapFor([updated]);
    res.status(201).json({ project: shape(updated, [], catMap), category: catMap[id] });
  })
);

// Projects are never deleted — archive them instead (PATCH status "archived"); their transactions stay filed under them.

module.exports = router;
