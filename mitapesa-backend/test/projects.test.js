const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createFakePrisma } = require("./helpers/fakePrisma");

let fake = createFakePrisma();
const prismaPath = require.resolve("../src/lib/prisma");
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: new Proxy({}, { get: (_, p) => fake[p] }) };

const P = require("../src/lib/projects");
const { expenseWhere } = require("../src/modules/analytics/analyticsQuery");

let n = 0;
async function setup() {
  fake = createFakePrisma();
  const a = await fake.user.create({ data: { firstName: "Asha", lastName: "T", email: `a${++n}@x.com`, phone: `700${n}` } });
  const b = await fake.user.create({ data: { firstName: "Baraka", lastName: "T", email: `b${++n}@x.com`, phone: `700${n}` } });
  const pa = await fake.wallet.create({ data: { type: "PERSONAL" } });
  const pb = await fake.wallet.create({ data: { type: "PERSONAL" } });
  const sh = await fake.wallet.create({ data: { type: "SHARED" } });
  for (const [w, u] of [[pa, a], [pb, b], [sh, a], [sh, b]]) await fake.walletMember.create({ data: { walletId: w.id, userId: u.id } });
  return { a, b, pa, pb, sh };
}

describe("project access", () => {
  test("personal project is private to its owner", async () => {
    const { a, b } = await setup();
    const p = await fake.project.create({ data: { userId: a.id, walletId: null, name: "House" } });
    assert.equal((await P.loadProjectForUser(a.id, p.id)).id, p.id);
    await assert.rejects(() => P.loadProjectForUser(b.id, p.id), /private/);
  });
  test("shared project is visible to every wallet member, not outsiders", async () => {
    const { a, b, sh } = await setup();
    const c = await fake.user.create({ data: { firstName: "C", lastName: "T", email: "c@x.com", phone: "7999" } });
    const p = await fake.project.create({ data: { userId: a.id, walletId: sh.id, name: "Wedding" } });
    assert.ok(await P.loadProjectForUser(b.id, p.id));
    await assert.rejects(() => P.loadProjectForUser(c.id, p.id), /Not a member/);
  });
  test("missing project is 404", async () => {
    const { a } = await setup();
    await assert.rejects(() => P.loadProjectForUser(a.id, "nope"), /not found/i);
  });
});

describe("attaching transactions", () => {
  test("no projectId is a no-op", async () => {
    const { a, pa } = await setup();
    assert.equal(await P.assertProjectForTransaction(a.id, null, pa.id), null);
    assert.equal(await P.assertProjectForTransaction(a.id, undefined, pa.id), null);
  });
  test("personal project accepts personal wallet, rejects shared wallet", async () => {
    const { a, pa, sh } = await setup();
    const p = await fake.project.create({ data: { userId: a.id, walletId: null, name: "House" } });
    assert.ok(await P.assertProjectForTransaction(a.id, p.id, pa.id));
    await assert.rejects(() => P.assertProjectForTransaction(a.id, p.id, sh.id), /personal wallet/);
  });
  test("shared project only accepts its own wallet", async () => {
    const { a, pa, sh } = await setup();
    const p = await fake.project.create({ data: { userId: a.id, walletId: sh.id, name: "Wedding" } });
    assert.ok(await P.assertProjectForTransaction(a.id, p.id, sh.id));
    await assert.rejects(() => P.assertProjectForTransaction(a.id, p.id, pa.id), /own wallet/);
  });
  test("cannot attach to someone else's personal project", async () => {
    const { a, b, pb } = await setup();
    const p = await fake.project.create({ data: { userId: a.id, walletId: null, name: "House" } });
    await assert.rejects(() => P.assertProjectForTransaction(b.id, p.id, pb.id), /private/);
  });
  test("archived project refuses new transactions", async () => {
    const { a, pa } = await setup();
    const p = await fake.project.create({ data: { userId: a.id, walletId: null, name: "Old", status: "archived" } });
    await assert.rejects(() => P.assertProjectForTransaction(a.id, p.id, pa.id), /archived/);
  });
});

describe("spending vs balance", () => {
  test("everyday spending filter excludes project transactions; balance sum includes them", async () => {
    const { a, pa } = await setup();
    const p = await fake.project.create({ data: { userId: a.id, walletId: null, name: "House" } });
    await fake.transaction.create({ data: { walletId: pa.id, amount: -10000, projectId: null } });
    await fake.transaction.create({ data: { walletId: pa.id, amount: -500000, projectId: p.id } });
    await fake.transaction.create({ data: { walletId: pa.id, amount: 2000000, projectId: null } });
    const where = expenseWhere({ walletIds: [pa.id], from: "2020-01-01", to: "2030-01-01" });
    assert.equal(where.projectId, null);
    // fake matcher ignores date/amount ops it supports; apply expense filter as the real query would
    const spending = (await fake.transaction.findMany({ where: { walletId: pa.id, projectId: null, amount: { lt: 0 } } })).reduce((s, t) => s + t.amount, 0);
    assert.equal(spending, -10000);
    const balance = (await fake.transaction.findMany({ where: { walletId: pa.id } })).reduce((s, t) => s + t.amount, 0);
    assert.equal(balance, 1490000);
  });
  test("moving a transaction in and out changes spending but never balance", async () => {
    const { a, pa } = await setup();
    const p = await fake.project.create({ data: { userId: a.id, walletId: null, name: "House" } });
    const t = await fake.transaction.create({ data: { walletId: pa.id, amount: -40000, projectId: null } });
    const spend = async () => (await fake.transaction.findMany({ where: { walletId: pa.id, projectId: null, amount: { lt: 0 } } })).reduce((s, x) => s + x.amount, 0);
    const bal = async () => (await fake.transaction.findMany({ where: { walletId: pa.id } })).reduce((s, x) => s + x.amount, 0);
    assert.deepEqual([await spend(), await bal()], [-40000, -40000]);
    await fake.transaction.update({ where: { id: t.id }, data: { projectId: p.id } });
    assert.deepEqual([await spend(), await bal()], [0, -40000]);
    await fake.transaction.update({ where: { id: t.id }, data: { projectId: null } });
    assert.deepEqual([await spend(), await bal()], [-40000, -40000]);
  });
});

describe("summarizeProject", () => {
  const now = new Date("2026-11-30T00:00:00Z");
  const row = (amount, date, cat = "Home", merchant = "Duka") => ({ id: `${amount}${date}`, amount, date: new Date(date), category: { name: cat }, merchant });
  test("totals, categories, funding and biggest items", () => {
    const rows = [row(-300000, "2026-11-02", "Materials"), row(-100000, "2026-11-10", "Labour"), row(-50000, "2026-11-11", "Materials"), row(1000000, "2026-11-01", "Income")];
    const s = P.summarizeProject({ budget: 1000000, targetDate: null }, rows, now);
    assert.equal(s.spent, 450000);
    assert.equal(s.funded, 1000000);
    assert.equal(s.remaining, 550000);
    assert.deepEqual(s.byCategory.map((c) => [c.name, c.amount]), [["Materials", 350000], ["Labour", 100000]]);
    assert.equal(s.biggest[0].amount, 300000);
    assert.equal(s.health, "on_track");
  });
  test("health: over, at risk by percent, at risk by projection, no budget", () => {
    assert.equal(P.summarizeProject({ budget: 100 }, [row(-150, "2026-11-20")], now).health, "over");
    assert.equal(P.summarizeProject({ budget: 100 }, [row(-95, "2026-11-20")], now).health, "at_risk");
    // spending 1000/week, 2000 left (≈14 days), target in 30 days -> runs out early
    const rows = [row(-4000, "2026-11-02")];
    const s = P.summarizeProject({ budget: 6000, targetDate: new Date("2026-12-30T00:00:00Z") }, rows, now);
    assert.equal(s.health, "at_risk");
    assert.equal(P.summarizeProject({ budget: null }, rows, now).health, "no_budget");
  });
  test("empty project is safe", () => {
    const s = P.summarizeProject({ budget: 500 }, [], now);
    assert.equal(s.spent, 0); assert.equal(s.avgWeeklySpend, 0); assert.equal(s.weeksToBudget, null);
  });
});

describe("project-only categories", () => {
  test("strict: project category without a project is rejected, with a project is allowed, everyday is always allowed", async () => {
    fake = createFakePrisma();
    const mat = await fake.category.create({ data: { name: "Materials", userId: null, scope: "project" } });
    const food = await fake.category.create({ data: { name: "Food", userId: null, scope: "everyday" } });
    await assert.rejects(() => P.checkCategoryForProject(mat.id, null, { strict: true }), /only for project/);
    assert.equal((await P.checkCategoryForProject(mat.id, "p1", { strict: true })).changed, false);
    assert.equal((await P.checkCategoryForProject(food.id, null, { strict: true })).changed, false);
  });
  test("moved out of a project with a project category falls back to Other", async () => {
    fake = createFakePrisma();
    const mat = await fake.category.create({ data: { name: "Materials", userId: null, scope: "project" } });
    const other = await fake.category.create({ data: { name: "Other", userId: null, scope: "everyday" } });
    const r = await P.checkCategoryForProject(mat.id, null, { strict: false });
    assert.deepEqual([r.categoryId, r.changed], [other.id, true]);
  });
  test("ensureProjectCategories creates the set once and is idempotent", async () => {
    fake = createFakePrisma(); P._resetEnsureFlag();
    await P.ensureProjectCategories(); P._resetEnsureFlag(); await P.ensureProjectCategories();
    const all = await fake.category.findMany({ where: { scope: "project" } });
    assert.equal(all.length, P.PROJECT_CATEGORIES.length);
  });
});

describe("project templates and categories", () => {
  const T = require("../src/lib/projectTemplates");
  test("every template category is created as a project-scope category; names never clash with everyday ones", () => {
    const everyday = ["Food & Dining", "Transportation", "Housing & Utilities", "Shopping", "Health & Medical", "Education", "Entertainment", "Bills & Subscriptions", "Family", "Personal Care", "Financial", "Travel", "Other", "Income"];
    for (const t of T.TEMPLATES) for (const c of t.categories) { assert.ok(T.ALL_CATEGORY_NAMES.includes(c)); assert.ok(!everyday.includes(c), c); }
    assert.ok(T.TEMPLATES.find((t) => t.key === "custom").categories.length === 0);
    assert.equal(new Set(T.ALL_CATEGORY_NAMES).size, T.ALL_CATEGORY_NAMES.length);
  });
  test("every template ends with Contingency except custom", () => {
    for (const t of T.TEMPLATES.filter((x) => x.key !== "custom")) assert.equal(t.categories.at(-1), "Contingency", t.key);
  });
  test("resolveProjectCategoryIds reuses global, creates a user's own custom one, dedupes and cleans", async () => {
    fake = createFakePrisma(); P._resetEnsureFlag();
    const ids = await P.resolveProjectCategoryIds("u1", ["Materials", "  Labour ", "materials", "Roofing sheets", "x"]);
    assert.equal(ids.length, 3); // Materials, Labour, Roofing sheets ("materials" dup, "x" too short)
    const custom = await fake.category.findFirst({ where: { name: "Roofing sheets" } });
    assert.equal(custom.userId, "u1"); assert.equal(custom.scope, "project");
    const again = await P.resolveProjectCategoryIds("u1", ["Roofing sheets"]);
    assert.equal(again[0], custom.id);
  });
  test("a custom name that clashes with the user's own everyday category gets a (project) suffix", async () => {
    fake = createFakePrisma(); P._resetEnsureFlag();
    const orig = fake.category.create.bind(fake.category);
    await orig({ data: { name: "Gifts", userId: "u2", scope: "everyday", color: "#000" } });
    // emulate the DB unique (userId,name) rule for this test
    fake.category.create = async (args) => {
      if (args.data.userId === "u2" && args.data.name === "Gifts") { const e = new Error("dup"); e.code = "P2002"; throw e; }
      return orig(args);
    };
    const [id] = await P.resolveProjectCategoryIds("u2", ["Gifts"]);
    const c = await fake.category.findUnique({ where: { id } });
    assert.equal(c.name, "Gifts (project)");
  });
});
