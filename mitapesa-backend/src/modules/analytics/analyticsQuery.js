const prisma = require("../../lib/prisma");
const { userWalletIds } = require("../wallets/wallets.helpers");

// All amounts in the Transaction table are negative for expenses,
// positive for income (see schema.prisma) — every function here filters
// to expenses only (amount: { lt: 0 }) and returns Math.abs() values,
// since "how much did I spend" is what every one of the five supported
// question types is actually asking, never a raw signed number a
// customer would have to mentally flip.

function endOfDay(dateStr) {
  const d = new Date(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// A pragmatic, non-ISO week label (year + which 7-day block since Jan 1)
// — good enough for a customer-facing "spend by week" trend where the
// exact ISO week-numbering convention doesn't matter, only that periods
// sort and group consistently.
function weekKey(date) {
  const d = new Date(date);
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  const daysSince = Math.floor((d - startOfYear) / 86400000);
  const week = Math.floor(daysSince / 7) + 1;
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function expenseWhere({ walletIds, from, to, categoryFilter }) {
  const where = { walletId: { in: walletIds }, date: { gte: new Date(from), lte: endOfDay(to) }, amount: { lt: 0 } };
  if (categoryFilter) where.category = { name: categoryFilter };
  return where;
}

async function categoryNamesById(categoryIds) {
  if (!categoryIds.length) return {};
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } });
  return Object.fromEntries(categories.map((c) => [c.id, c.name]));
}

async function runBreakdown({ walletIds, from, to, categoryFilter, metric }) {
  const where = expenseWhere({ walletIds, from, to, categoryFilter });
  const rows = await prisma.transaction.groupBy({ by: ["categoryId"], where, _sum: { amount: true }, _avg: { amount: true }, _count: true });
  const nameById = await categoryNamesById(rows.map((r) => r.categoryId));

  const byCategory = rows
    .map((r) => ({
      name: nameById[r.categoryId] || "Unknown",
      amount: Math.abs(Number(metric === "average" ? r._avg.amount : r._sum.amount)),
      count: r._count,
    }))
    .sort((a, b) => b.amount - a.amount);

  return { total: byCategory.reduce((sum, c) => sum + c.amount, 0), byCategory };
}

async function runTrend({ walletIds, from, to, groupBy, categoryFilter }) {
  const where = expenseWhere({ walletIds, from, to, categoryFilter });
  // Prisma's groupBy can't truncate a date to a month/week bucket
  // directly, so this fetches the (date-range-bounded, so inherently
  // limited) matching transactions and buckets them in JS — the same
  // approach the rest of this app already uses for the same limitation
  // (see lib/aiUsage.js's findAvailableCredit).
  const transactions = await prisma.transaction.findMany({ where, select: { amount: true, date: true } });

  const buckets = {};
  for (const t of transactions) {
    const key = groupBy === "week" ? weekKey(t.date) : monthKey(t.date);
    buckets[key] = (buckets[key] || 0) + Math.abs(Number(t.amount));
  }
  const series = Object.entries(buckets)
    .map(([period, amount]) => ({ period, amount }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return { series };
}

async function runRanking({ walletIds, from, to, groupBy, limit, categoryFilter }) {
  const where = expenseWhere({ walletIds, from, to, categoryFilter });
  const take = limit || 5;

  if (groupBy === "merchant") {
    const rows = await prisma.transaction.groupBy({ by: ["merchant"], where, _sum: { amount: true }, orderBy: { _sum: { amount: "asc" } }, take });
    return { items: rows.map((r) => ({ name: r.merchant, amount: Math.abs(Number(r._sum.amount)) })) };
  }

  const rows = await prisma.transaction.groupBy({ by: ["categoryId"], where, _sum: { amount: true }, orderBy: { _sum: { amount: "asc" } }, take });
  const nameById = await categoryNamesById(rows.map((r) => r.categoryId));
  return { items: rows.map((r) => ({ name: nameById[r.categoryId] || "Unknown", amount: Math.abs(Number(r._sum.amount)) })) };
}

async function runSingleValue({ walletIds, from, to, metric, categoryFilter }) {
  const where = expenseWhere({ walletIds, from, to, categoryFilter });
  const agg = await prisma.transaction.aggregate({ where, _sum: { amount: true }, _avg: { amount: true }, _count: true });
  const value =
    metric === "average" ? Math.abs(Number(agg._avg.amount || 0)) :
    metric === "count" ? agg._count :
    Math.abs(Number(agg._sum.amount || 0));
  return { value, count: agg._count };
}

async function runComparison({ walletIds, from, to, compareFrom, compareTo, categoryFilter, groupBy, metric }) {
  if (groupBy === "category") {
    const [period1, period2] = await Promise.all([
      runBreakdown({ walletIds, from, to, categoryFilter, metric }),
      runBreakdown({ walletIds, from: compareFrom, to: compareTo, categoryFilter, metric }),
    ]);
    return {
      period1: { from, to, total: period1.total, byCategory: period1.byCategory },
      period2: { from: compareFrom, to: compareTo, total: period2.total, byCategory: period2.byCategory },
      difference: period1.total - period2.total,
    };
  }
  const [v1, v2] = await Promise.all([
    runSingleValue({ walletIds, from, to, metric, categoryFilter }),
    runSingleValue({ walletIds, from: compareFrom, to: compareTo, metric, categoryFilter }),
  ]);
  return {
    period1: { from, to, total: v1.value },
    period2: { from: compareFrom, to: compareTo, total: v2.value },
    difference: v1.value - v2.value,
  };
}

// The single entry point this module exposes — takes a validated query
// spec (already sanitized by OpenAiAnalyticsAssistantProvider: known
// enum values, real dates, a category name that actually belongs to this
// app) and a userId, and runs it. walletIds is resolved here from the
// real, authenticated userId via the same proven helper every other
// wallet-scoped endpoint in this app already uses — never from anything
// the AI-generated query spec itself supplied, so no query shape the
// model could ever produce is able to reach another customer's data.
async function runAnalyticsQuery(userId, querySpec) {
  const walletIds = await userWalletIds(userId);
  const params = { walletIds, ...querySpec };

  switch (querySpec.intent) {
    case "breakdown": return runBreakdown(params);
    case "trend": return runTrend(params);
    case "ranking": return runRanking(params);
    case "comparison": return runComparison(params);
    case "single_value": return runSingleValue(params);
    default: throw new Error(`Unhandled analytics intent: ${querySpec.intent}`);
  }
}

module.exports = { runAnalyticsQuery };
