// Projects: a customer's goal-sized spending (house build, renovation, wedding…)
// tracked apart from everyday spending.
//
// Rules (agreed):
//  - A transaction with projectId is EXCLUDED from everyday spending analytics
//    (budgets, Home totals, insights) but STILL counts towards the balance.
//  - Personal project (walletId null): owner only, personal-wallet transactions only.
//  - Shared project (walletId set): any member of that wallet, that wallet's transactions only.
//  - Deleting a project never deletes transactions: they return to normal spending.
const prisma = require("./prisma");
const { forbidden, notFound, badRequest } = require("./errors");

const STATUSES = ["active", "done", "archived"];

// Global categories offered only inside projects (every category used by a project template). Created on first use,
// so no manual seed run is needed.
const { ALL_CATEGORY_NAMES, colorFor: projectCategoryColor } = require("./projectTemplates");
const PROJECT_CATEGORIES = ALL_CATEGORY_NAMES.map((name) => ({ name, color: projectCategoryColor(name) }));
let projectCategoriesEnsured = false;
async function ensureProjectCategories() {
  if (projectCategoriesEnsured) return;
  for (const c of PROJECT_CATEGORIES) {
    const exists = await prisma.category.findFirst({ where: { name: c.name, userId: null } });
    if (!exists) await prisma.category.create({ data: { name: c.name, color: c.color, scope: "project", userId: null } });
  }
  projectCategoriesEnsured = true;
}
function _resetEnsureFlag() { projectCategoriesEnsured = false; }

// Turns a list of category names into category ids for a project: reuse a global or the user's own project category of
// that name, otherwise create a new user-owned PROJECT category (a custom one the customer typed). Never touches
// everyday categories, even if the name matches one (it would then be a different, project-only category).
async function resolveProjectCategoryIds(userId, names) {
  const clean = [];
  for (const raw of names || []) {
    const n = String(raw || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (n.length >= 2 && !clean.some((x) => x.toLowerCase() === n.toLowerCase())) clean.push(n);
    if (clean.length >= 12) break;
  }
  await ensureProjectCategories();
  const ids = [];
  for (const name of clean) {
    let cat = await prisma.category.findFirst({ where: { name, scope: "project", userId: null } })
      || await prisma.category.findFirst({ where: { name, scope: "project", userId } });
    if (!cat) {
      const used = (await prisma.category.findMany({ where: { scope: "project", userId }, select: { color: true } })).length;
      const color = ["#B5546B", "#4F8FA3", "#9A7B2F", "#6C8F5C", "#8E5B7F", "#C97B63"][used % 6];
      try {
        cat = await prisma.category.create({ data: { name, scope: "project", userId, color } });
      } catch (err) {
        // The customer already has an everyday category with this exact name (unique per user): keep both, tell them apart.
        if (err && err.code === "P2002") cat = await prisma.category.create({ data: { name: `${name} (project)`, scope: "project", userId, color } });
        else throw err;
      }
    }
    ids.push(cat.id);
  }
  return ids;
}

// Project-scope categories belong to project spending only.
//  strict: reject (create, bulk, or an explicit category change).
//  otherwise (a transaction moved OUT of a project): fall back to the everyday "Other" category.
async function checkCategoryForProject(categoryId, projectId, { strict }) {
  const cat = categoryId ? await prisma.category.findUnique({ where: { id: categoryId } }) : null;
  if (!cat || cat.scope !== "project" || projectId) return { categoryId, changed: false };
  if (strict) throw badRequest("That category is only for project spending. Choose a project, or pick an everyday category.");
  const other = await prisma.category.findFirst({ where: { name: "Other", userId: null } });
  return { categoryId: other ? other.id : categoryId, changed: !!other };
}

async function isWalletMember(userId, walletId) {
  const m = await prisma.walletMember.findUnique({ where: { walletId_userId: { walletId, userId } } });
  return !!m;
}

// Throws unless the user may see/use this project. Returns the project.
async function loadProjectForUser(userId, projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw notFound("Project not found");
  if (project.walletId) {
    if (!(await isWalletMember(userId, project.walletId))) throw forbidden("Not a member of this project's wallet");
  } else if (project.userId !== userId) {
    throw forbidden("This project is private to its owner");
  }
  return project;
}

// Validates attaching a transaction (in `walletId`) to a project. projectId null/undefined = no-op.
async function assertProjectForTransaction(userId, projectId, walletId) {
  if (!projectId) return null;
  const project = await loadProjectForUser(userId, projectId);
  if (project.status === "archived") throw badRequest("This project is archived. Re-open it to add or move transactions.");
  if (project.walletId) {
    if (project.walletId !== walletId) throw badRequest("This shared project only accepts transactions from its own wallet.");
  } else {
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet || wallet.type !== "PERSONAL") throw badRequest("A personal project only accepts transactions from your personal wallet.");
  }
  return project;
}

const WEEK_MS = 7 * 86400000;

function weekStartKey(d) {
  const x = new Date(d);
  const day = (x.getUTCDay() + 6) % 7; // Monday-first
  x.setUTCDate(x.getUTCDate() - day);
  return x.toISOString().slice(0, 10);
}

// rows: project transactions [{ amount, date, category?:{name}, merchant, id }]
function summarizeProject(project, rows, now = new Date()) {
  const expenses = rows.filter((r) => Number(r.amount) < 0);
  const incomeRows = rows.filter((r) => Number(r.amount) > 0);
  const spent = expenses.reduce((s, r) => s + Math.abs(Number(r.amount)), 0);
  const funded = incomeRows.reduce((s, r) => s + Number(r.amount), 0);
  const budget = project.budget == null ? null : Number(project.budget);

  const byCat = {};
  for (const r of expenses) {
    const k = r.category?.name || "Other";
    byCat[k] = (byCat[k] || 0) + Math.abs(Number(r.amount));
  }
  const byCategory = Object.entries(byCat).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);

  const wk = {};
  for (const r of expenses) {
    const k = weekStartKey(r.date);
    wk[k] = (wk[k] || 0) + Math.abs(Number(r.amount));
  }
  const weekly = Object.entries(wk).map(([week, amount]) => ({ week, amount })).sort((a, b) => a.week.localeCompare(b.week));

  const biggest = [...expenses]
    .sort((a, b) => Number(a.amount) - Number(b.amount))
    .slice(0, 5)
    .map((r) => ({ id: r.id, merchant: r.merchant, amount: Math.abs(Number(r.amount)), date: r.date }));

  // Performance
  let avgWeeklySpend = 0;
  if (expenses.length) {
    const first = Math.min(...expenses.map((r) => new Date(r.date).getTime()));
    const weeks = Math.max(1, (now.getTime() - first) / WEEK_MS);
    avgWeeklySpend = spent / weeks;
  }
  const remaining = budget == null ? null : budget - spent;
  const pctUsed = budget ? spent / budget : null;
  let weeksToBudget = null;
  if (budget != null && remaining > 0 && avgWeeklySpend > 0) weeksToBudget = remaining / avgWeeklySpend;

  const target = project.targetDate ? new Date(project.targetDate) : null;
  const daysLeft = target ? Math.ceil((target.getTime() - now.getTime()) / 86400000) : null;

  // "over" = budget exceeded; "at_risk" = projected to run out before target date, or >90% used; else "on_track"
  let health = "on_track";
  if (budget != null) {
    if (spent > budget) health = "over";
    else if (pctUsed >= 0.9) health = "at_risk";
    else if (daysLeft != null && daysLeft > 0 && weeksToBudget != null && weeksToBudget * 7 < daysLeft) health = "at_risk";
  }
  if (budget == null) health = "no_budget";

  return { spent, funded, count: rows.length, budget, remaining, pctUsed, byCategory, weekly, biggest, avgWeeklySpend, weeksToBudget, daysLeft, health };
}

module.exports = { resolveProjectCategoryIds, PROJECT_CATEGORIES, ensureProjectCategories, checkCategoryForProject, _resetEnsureFlag, STATUSES, loadProjectForUser, assertProjectForTransaction, summarizeProject, weekStartKey, isWalletMember };
