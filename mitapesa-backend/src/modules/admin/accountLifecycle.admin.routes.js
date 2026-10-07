const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { requireAdmin, requireAdminRole } = require("../../middleware/admin");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, badRequest } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");
const { notifyUser } = require("../../lib/notify");
const { getCardIssuingProvider } = require("../../services/card-issuing");
const { restoreArchive, purgeArchive, getRetentionDays } = require("../../lib/accountArchive");

/**
 * Admin side of "delete my account": the statistics on closed accounts, read
 * access to each account's archived data, export, restore, permanent erase,
 * and the queue of card-closure requests raised when a customer tried to
 * delete an account that still held money.
 *
 * Tiers: the statistics and the list are viewer-level — the list with contact
 * details masked, exactly as the users page does for viewers. Anything that opens the archived
 * data itself — profile detail, transactions, export — is support and above,
 * and every such read is audit-logged. Restore and permanent erase change
 * what exists, so they are super-admin only.
 */
const router = Router();
router.use(requireAuth, requireAdmin);

const DAY_MS = 24 * 60 * 60 * 1000;

// Viewer-tier admins are "read-only, no customer PII" (see lib/adminRoles.js):
// the main users list gives them names but masked contact details, and so
// does this one. Same masking as admin.routes.js.
const maskEmail = (email) => email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
const maskPhone = (phone) => `***${String(phone).slice(-4)}`;

// Everything on an archive row except the (large, personal) snapshot itself.
const ARCHIVE_ROW = {
  id: true, userId: true, status: true, reason: true, fullName: true, email: true, phone: true,
  accountCreatedAt: true, archivedAt: true, purgeAfter: true, restoredAt: true, purgedAt: true,
  hadCard: true, walletCount: true, transactionCount: true, budgetCount: true,
};

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------
router.get(
  "/stats",
  requireAdminRole("admin_viewer"),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const firstMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const [byStatus, last30Days, openClosureRequests, recent, reasons, tenureRows, withCard, expiringIn7Days, retentionDays] = await Promise.all([
      prisma.accountArchive.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.accountArchive.count({ where: { archivedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
      prisma.cardClosureRequest.count({ where: { status: "pending" } }),
      prisma.accountArchive.findMany({ where: { archivedAt: { gte: firstMonth } }, select: { archivedAt: true } }),
      prisma.accountArchive.groupBy({ by: ["reason"], _count: { _all: true } }),
      prisma.accountArchive.findMany({ select: { accountCreatedAt: true, archivedAt: true } }),
      prisma.accountArchive.count({ where: { hadCard: true } }),
      prisma.accountArchive.count({ where: { status: "archived", purgeAfter: { not: null, lte: new Date(now.getTime() + 7 * DAY_MS) } } }),
      getRetentionDays(),
    ]);

    const count = (status) => byStatus.find((r) => r.status === status)?._count._all || 0;
    const totals = { archived: count("archived"), restored: count("restored"), purged: count("purged") };
    totals.all = totals.archived + totals.restored + totals.purged;

    // Twelve calendar months ending this one, zero-filled so a quiet month
    // still shows as a bar rather than a gap.
    const byMonth = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1);
      byMonth.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, count: 0 });
    }
    for (const r of recent) {
      const key = `${r.archivedAt.getFullYear()}-${String(r.archivedAt.getMonth() + 1).padStart(2, "0")}`;
      const bucket = byMonth.find((m) => m.month === key);
      if (bucket) bucket.count += 1;
    }

    const avgTenureDays = tenureRows.length
      ? Math.round((tenureRows.reduce((s, r) => s + (r.archivedAt - r.accountCreatedAt) / DAY_MS, 0) / tenureRows.length) * 10) / 10
      : null;

    res.json({
      totals,
      last30Days,
      openClosureRequests,
      byMonth,
      byReason: reasons.map((r) => ({ reason: r.reason || "not_given", count: r._count._all })).sort((a, b) => b.count - a.count),
      avgTenureDays,
      withCard,
      expiringIn7Days,
      retentionDays,
    });
  })
);

// ---------------------------------------------------------------------------
// Archived accounts
// ---------------------------------------------------------------------------
router.get(
  "/archives",
  requireAdminRole("admin_viewer"),
  asyncHandler(async (req, res) => {
    const q = pageQuery.extend({ search: z.string().trim().optional(), status: z.enum(["archived", "restored", "purged"]).optional() }).parse(req.query);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.search
        ? { OR: [{ fullName: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }] }
        : {}),
    };
    const [total, archives] = await Promise.all([
      prisma.accountArchive.count({ where }),
      prisma.accountArchive.findMany({ where, orderBy: { archivedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: ARCHIVE_ROW }),
    ]);
    const shaped =
      req.adminRole === "admin_viewer"
        ? archives.map((a) => ({ ...a, email: a.email ? maskEmail(a.email) : null, phone: a.phone ? maskPhone(a.phone) : null }))
        : archives;
    res.json({ archives: shaped, total, page: q.page, pageSize: q.pageSize });
  })
);

router.get(
  "/archives/:id",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const archive = await prisma.accountArchive.findUnique({ where: { id: req.params.id } });
    if (!archive) throw notFound("Archive not found");
    const { data, ...row } = archive;

    const profile = data?.profile
      ? Object.fromEntries(
          ["firstName", "middleName", "lastName", "email", "phone", "language", "preferredCurrency", "kycStatus", "createdAt", "lastLoginAt", "termsAcceptedAt", "termsVersion"].map((k) => [k, data.profile[k] ?? null])
        )
      : null;
    const summary = data
      ? {
          categories: data.categories.length,
          budgets: data.budgets.length,
          wallets: data.memberships.length,
          walletsRemoved: data.removedWallets.length,
          transactions: data.transactions.length,
          supportTickets: data.supportTickets.length,
          loggedInSharedWallets: data.loggedElsewhere,
        }
      : null;

    // The tombstone keeps its card and any closure requests — shown here so an
    // admin sees the whole picture of an account in one place.
    const [card, closureRequests] = await Promise.all([
      prisma.card.findUnique({ where: { userId: archive.userId }, select: { last4: true, frozen: true, balance: true } }),
      prisma.cardClosureRequest.findMany({ where: { userId: archive.userId }, orderBy: { requestedAt: "desc" }, take: 5 }),
    ]);

    await writeAudit(req.userId, "admin.archive_viewed", { ip: req.ip, targetUserId: archive.userId, archiveId: archive.id });
    res.json({
      archive: row,
      profile,
      summary,
      card: card ? { last4: card.last4, frozen: card.frozen, balance: Number(card.balance) } : null,
      closureRequests: closureRequests.map((r) => ({ ...r, balance: Number(r.balance) })),
    });
  })
);

router.get(
  "/archives/:id/transactions",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const q = pageQuery.extend({ search: z.string().trim().optional() }).parse(req.query);
    const archive = await prisma.accountArchive.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true, status: true, data: true } });
    if (!archive) throw notFound("Archive not found");
    if (!archive.data) throw badRequest(`This archive is ${archive.status}; its data is no longer held here.`);

    // Category names: the account's own categories are in the snapshot; the
    // shared default ones are live rows.
    const names = new Map(archive.data.categories.map((c) => [c.id, c.name]));
    const missing = [...new Set(archive.data.transactions.map((t) => t.categoryId))].filter((id) => !names.has(id));
    if (missing.length) {
      for (const c of await prisma.category.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) names.set(c.id, c.name);
    }

    const needle = (q.search || "").toLowerCase();
    const matching = archive.data.transactions
      .filter((t) => !needle || `${t.merchant} ${t.note || ""} ${names.get(t.categoryId) || ""}`.toLowerCase().includes(needle))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    const slice = matching.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);

    await writeAudit(req.userId, "admin.archive_data_viewed", { ip: req.ip, targetUserId: archive.userId, archiveId: archive.id, what: "transactions" });
    res.json({
      total: matching.length,
      page: q.page,
      pageSize: q.pageSize,
      // photoUrl is deliberately left out of the list — it can be megabytes per
      // row. It is in the export.
      transactions: slice.map((t) => ({
        id: t.id,
        date: t.date,
        merchant: t.merchant,
        amount: Number(t.amount),
        category: names.get(t.categoryId) || "—",
        note: t.note,
        source: t.source,
        originalCurrency: t.originalCurrency,
        hasPhoto: !!t.photoUrl,
      })),
    });
  })
);

// The "retrieve" half: the complete archived data as one JSON file. The
// password hash is never included — it exists in the archive only so a
// restore can put it back, not to be read out.
router.get(
  "/archives/:id/export",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const archive = await prisma.accountArchive.findUnique({ where: { id: req.params.id } });
    if (!archive) throw notFound("Archive not found");
    if (!archive.data) throw badRequest(`This archive is ${archive.status}; its data is no longer held here.`);

    const { data, ...row } = archive;
    const body = { archive: row, data: { ...data, profile: { ...data.profile, passwordHash: undefined } } };

    await writeAudit(req.userId, "admin.archive_exported", { ip: req.ip, targetUserId: archive.userId, archiveId: archive.id });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="mitapesa-archive-${archive.userId}.json"`);
    res.send(JSON.stringify(body, null, 2));
  })
);

// Restoring re-creates someone's personal data after they asked for it to be
// deleted, so a written reason is required and recorded, and the customer is
// emailed. Super admin only.
router.post(
  "/archives/:id/restore",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().min(3, "Say why this account is being restored").max(500) }).parse(req.body);
    res.json(await restoreArchive({ archiveId: req.params.id, adminUserId: req.userId, note, ip: req.ip }));
  })
);

// Permanent and irreversible — the same erase the retention job does when a
// window runs out, just done early. Super admin only.
router.post(
  "/archives/:id/purge",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    res.json(await purgeArchive({ archiveId: req.params.id, adminUserId: req.userId, ip: req.ip }));
  })
);

// ---------------------------------------------------------------------------
// Card closure requests
// ---------------------------------------------------------------------------

// Money still held across the customer's cards, asked of the card provider
// for the main card (the source of truth once the issuer is real).
async function currentFundsFor(userId) {
  let main = 0;
  const card = await prisma.card.findUnique({ where: { userId }, select: { id: true } });
  if (card) {
    try {
      main = Number((await getCardIssuingProvider().getBalance(card.id)).balance);
    } catch (err) {
      console.error("Closure queue: couldn't read card balance:", err.message); // eslint-disable-line no-console
    }
  }
  const owned = await prisma.virtualCard.findMany({ where: { ownerId: userId }, select: { balance: true } });
  return main + owned.reduce((s, c) => s + Number(c.balance), 0);
}

router.get(
  "/closure-requests",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(["pending", "closed", "rejected", "all"]).default("pending") }).parse(req.query);
    const requests = await prisma.cardClosureRequest.findMany({
      where: status === "all" ? {} : { status },
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(requests.map((r) => r.userId))] } },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    const enriched = [];
    for (const r of requests) {
      const u = byId.get(r.userId);
      enriched.push({
        ...r,
        balance: Number(r.balance),
        customerName: u ? `${u.firstName} ${u.lastName}` : "—",
        email: u?.email || null,
        phone: u?.phone || null,
        // Live figure only matters while the request is open.
        currentFunds: r.status === "pending" ? await currentFundsFor(r.userId) : null,
      });
    }
    res.json({ requests: enriched });
  })
);

router.post(
  "/closure-requests/:id/resolve",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { status, note } = z
      .object({ status: z.enum(["closed", "rejected"]), note: z.string().trim().max(500).optional() })
      .parse(req.body);
    const request = await prisma.cardClosureRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw notFound("Request not found");
    if (request.status !== "pending") throw badRequest(`This request is already ${request.status}.`);

    if (status === "closed") {
      // Never mark a card closed while it still holds money — the customer
      // would be told they can delete and the funds would still be there.
      const funds = await currentFundsFor(request.userId);
      if (funds > 0) {
        throw badRequest(`The customer's cards still hold TZS ${funds.toLocaleString("en-US")}. Settle the balance with the bank first, then mark this closed.`);
      }
    }

    const updated = await prisma.cardClosureRequest.update({
      where: { id: request.id },
      data: { status, note: note || null, resolvedAt: new Date(), resolvedByUserId: req.userId },
    });
    await writeAudit(req.userId, `admin.closure_request_${status}`, { ip: req.ip, targetUserId: request.userId, requestId: request.id, note: note || null });

    // Tell the customer — they're waiting on this to finish deleting.
    await notifyUser(request.userId, {
      type: "card_closure",
      title: status === "closed" ? "Card closure complete" : "Card closure request declined",
      message:
        status === "closed"
          ? "Your card has been closed and its balance settled. You can now go back and delete your account."
          : `We couldn't close your card${note ? `: ${note}` : "."} Please contact support.`,
    }).catch((err) => console.error("Closure notification failed:", err.message)); // eslint-disable-line no-console

    res.json({ request: { ...updated, balance: Number(updated.balance) } });
  })
);

module.exports = router;
