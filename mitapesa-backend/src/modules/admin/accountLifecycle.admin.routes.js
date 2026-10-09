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
const { decryptField } = require("../../lib/crypto");
const { computeStatement } = require("../../lib/statement");
const { combinedStatementToCsv, sendCsv } = require("../../lib/csv");
const { hashNida, getRetentionYears, retentionState, setLegalHold, releaseRecords, recalculateEndDates } = require("../../lib/regulatedRetention");

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
    const [byStatus, last30Days, openClosureRequests, recent, reasons, tenureRows, withCard, expiringIn7Days, retentionDays, regRetained, regEnded, regHold, regReleased, regYears] = await Promise.all([
      prisma.accountArchive.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.accountArchive.count({ where: { archivedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
      prisma.cardClosureRequest.count({ where: { status: "pending" } }),
      prisma.accountArchive.findMany({ where: { archivedAt: { gte: firstMonth } }, select: { archivedAt: true } }),
      prisma.accountArchive.groupBy({ by: ["reason"], _count: { _all: true } }),
      prisma.accountArchive.findMany({ select: { accountCreatedAt: true, archivedAt: true } }),
      prisma.accountArchive.count({ where: { hadCard: true } }),
      prisma.accountArchive.count({ where: { status: "archived", purgeAfter: { not: null, lte: new Date(now.getTime() + 7 * DAY_MS) } } }),
      getRetentionDays(),
      prisma.regulatedRetention.count({ where: { status: "retained", legalHold: false, OR: [{ retainUntil: null }, { retainUntil: { gt: now } }] } }),
      prisma.regulatedRetention.count({ where: { status: "retained", legalHold: false, retainUntil: { lte: now } } }),
      prisma.regulatedRetention.count({ where: { status: "retained", legalHold: true } }),
      prisma.regulatedRetention.count({ where: { status: "released" } }),
      getRetentionYears(),
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
      // Customers who had a card, identity check or payments: their records are
      // kept for the regulated period and listed on the Regulated records tab.
      regulated: { retained: regRetained, retentionEnded: regEnded, onHold: regHold, released: regReleased, retentionYears: regYears },
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


// ---------------------------------------------------------------------------
// Regulated records (Tanzanian AML record-keeping)
//
// Customers who had a prepaid card, an identity check or payments keep their
// identity and transaction records for the regulated period (an admin setting)
// after they close their account. This section is how those records are found
// and produced — to a regulator, to law enforcement, to the partner bank —
// long after the login account is anonymized. All of it is support tier and
// above, every view is audit-logged, and nothing here deletes anything except
// the explicit, super-admin-only release of an entry whose period has ended
// and that is not under a legal hold.
// ---------------------------------------------------------------------------
const STATE_WHERE = (now) => ({
  retained: { status: "retained", legalHold: false, OR: [{ retainUntil: null }, { retainUntil: { gt: now } }] },
  ended: { status: "retained", legalHold: false, retainUntil: { lte: now } },
  hold: { status: "retained", legalHold: true },
  released: { status: "released" },
  reopened: { status: "reopened" },
});

// The stored NIDA hash is only ever used to MATCH a number typed into the search
// box, server-side. It is a plain unsalted SHA-256 of a number with a predictable
// shape — weak enough that it must not be handed to anyone, admin or not.
const withState = (row) => {
  const { nidaNumberHash, ...rest } = row;
  return { ...rest, state: retentionState(row) };
};

router.get(
  "/regulated",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const q = pageQuery.extend({ search: z.string().trim().optional(), state: z.enum(["retained", "ended", "hold", "released", "reopened"]).optional() }).parse(req.query);
    const digits = (q.search || "").replace(/[\s-]/g, "");
    const and = [];
    if (q.state) and.push(STATE_WHERE(new Date())[q.state]);
    if (q.search) {
      and.push({
        OR: [
          { fullName: { contains: q.search, mode: "insensitive" } },
          { email: { contains: q.search, mode: "insensitive" } },
          { phone: { contains: q.search } },
          { cardLast4: { contains: q.search } },
          // A regulator will quote the 20-digit NIDA number; only its hash is stored.
          ...(/^\d{20}$/.test(digits) ? [{ nidaNumberHash: hashNida(digits) }] : []),
        ],
      });
    }
    const where = and.length ? { AND: and } : {};
    const [total, records] = await Promise.all([
      prisma.regulatedRetention.count({ where }),
      prisma.regulatedRetention.findMany({ where, orderBy: { closedAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    await writeAudit(req.userId, "admin.regulated_listed", { ip: req.ip, searched: !!q.search });
    res.json({ records: records.map(withState), total, page: q.page, pageSize: q.pageSize });
  })
);

// What the stored NIDA profile says, decrypted — the same details, to the same
// tier, as the existing GET /admin/users/:userId/kyc.
async function decryptedIdentity(userId) {
  const p = await prisma.kycNidaProfile.findUnique({ where: { userId } });
  if (!p) return null;
  return {
    firstName: decryptField(p.firstNameEnc), middleName: decryptField(p.middleNameEnc), lastName: decryptField(p.lastNameEnc),
    sex: decryptField(p.sexEnc), dateOfBirth: decryptField(p.dateOfBirthEnc), placeOfBirth: decryptField(p.placeOfBirthEnc),
    citizenshipType: decryptField(p.citizenshipTypeEnc), nidaPhone: decryptField(p.nidaPhoneEnc),
    region: decryptField(p.regionEnc), district: decryptField(p.districtEnc), ward: decryptField(p.wardEnc), villageOrStreet: decryptField(p.villageOrStreetEnc),
  };
}

// Card columns an admin may read — never the (already scrubbed) encrypted number or security code.
const CARD_PUBLIC = { id: true, last4: true, holderName: true, expiry: true, frozen: true, balance: true, processorRef: true };
const VCARD_PUBLIC = { id: true, last4: true, label: true, type: true, ownerId: true, holderId: true, terminated: true, frozen: true, balance: true, createdAt: true };

router.get(
  "/regulated/:id",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const record = await prisma.regulatedRetention.findUnique({ where: { id: req.params.id } });
    if (!record) throw notFound("Record not found");
    const userId = record.userId;
    const [tomb, card, virtualCards, kyc, payments, tickets, closureRequests, identity] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, deletedAt: true, termsAcceptedAt: true, termsVersion: true } }),
      prisma.card.findUnique({ where: { userId }, select: CARD_PUBLIC }),
      prisma.virtualCard.findMany({ where: { OR: [{ ownerId: userId }, { holderId: userId }] }, select: VCARD_PUBLIC }),
      prisma.kycVerification.findUnique({ where: { userId }, select: { status: true, method: true, attempts: true, verifiedAt: true, createdAt: true } }),
      prisma.qrPayment.findMany({ where: { userId }, select: { amount: true, status: true, createdAt: true } }),
      prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, category: true, subject: true, status: true, disputedAmount: true, disputedMerchant: true, createdAt: true } }),
      prisma.cardClosureRequest.findMany({ where: { userId }, orderBy: { requestedAt: "desc" } }),
      record.status === "released" ? null : decryptedIdentity(userId),
    ]);
    const completed = payments.filter((p) => p.status === "completed");
    await writeAudit(req.userId, "admin.regulated_viewed", { ip: req.ip, targetUserId: userId, retentionId: record.id });
    res.json({
      record: withState(record),
      account: tomb,
      card: card ? { ...card, balance: Number(card.balance) } : null,
      virtualCards: virtualCards.map((c) => ({ ...c, balance: Number(c.balance) })),
      kyc,
      identity,
      payments: {
        count: payments.length,
        completed: completed.length,
        totalCompleted: completed.reduce((sum, p) => sum + Number(p.amount), 0),
        firstAt: payments.length ? new Date(Math.min(...payments.map((p) => +new Date(p.createdAt)))) : null,
        lastAt: payments.length ? new Date(Math.max(...payments.map((p) => +new Date(p.createdAt)))) : null,
      },
      tickets: tickets.map((t) => ({ ...t, disputedAmount: t.disputedAmount === null ? null : Number(t.disputedAmount) })),
      closureRequests: closureRequests.map((r) => ({ ...r, balance: Number(r.balance) })),
    });
  })
);

router.get(
  "/regulated/:id/payments",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const q = pageQuery.extend({ from: z.string().optional(), to: z.string().optional() }).parse(req.query);
    const record = await prisma.regulatedRetention.findUnique({ where: { id: req.params.id }, select: { id: true, userId: true } });
    if (!record) throw notFound("Record not found");
    const range = {};
    if (q.from) range.gte = new Date(q.from);
    if (q.to) { const end = new Date(q.to); end.setHours(23, 59, 59, 999); range.lte = end; }
    const where = { userId: record.userId, ...(Object.keys(range).length ? { createdAt: range } : {}) };
    const [total, rows] = await Promise.all([
      prisma.qrPayment.count({ where }),
      prisma.qrPayment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { merchant: { select: { name: true, city: true } } } }),
    ]);
    await writeAudit(req.userId, "admin.regulated_data_viewed", { ip: req.ip, targetUserId: record.userId, retentionId: record.id, what: "payments" });
    res.json({
      total, page: q.page, pageSize: q.pageSize,
      payments: rows.map((p) => ({ id: p.id, reference: p.reference, date: p.createdAt, amount: Number(p.amount), feeAmount: Number(p.feeAmount || 0), status: p.status, merchant: p.merchant?.name || "—", city: p.merchant?.city || null })),
    });
  })
);

// A card statement for ANY period — the regulator's "everything between X and Y".
// Same calculation as the customer's own statement; CSV for filing.
router.get(
  "/regulated/:id/statement",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const record = await prisma.regulatedRetention.findUnique({ where: { id: req.params.id } });
    if (!record) throw notFound("Record not found");
    const card = await prisma.card.findUnique({ where: { userId: record.userId } });
    if (!card) throw notFound("No card on record for this customer");
    const from = req.query.from ? new Date(req.query.from) : new Date(record.accountCreatedAt);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw badRequest("Invalid from/to date");
    const toEnd = new Date(to); toEnd.setHours(23, 59, 59, 999);
    const activitySinceFrom = await prisma.cardActivity.findMany({ where: { cardId: card.id, date: { gte: from } }, orderBy: { date: "asc" } });
    const financial = computeStatement({ currentBalance: Number(card.balance), activitySinceFrom, from, to: toEnd });
    await writeAudit(req.userId, "admin.regulated_data_viewed", { ip: req.ip, targetUserId: record.userId, retentionId: record.id, what: "statement", format: req.query.format || "json" });
    if (req.query.format === "csv") {
      return sendCsv(res, `mitapesa-regulated-statement-${record.userId}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, combinedStatementToCsv({ source: "financial", from, to: toEnd, financial, pfm: null }));
    }
    res.json({ from, to: toEnd, financial });
  })
);

// The whole file on a customer as one JSON document: what to hand over when an
// authority asks. No encrypted card secrets, no password hash.
router.get(
  "/regulated/:id/export",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const record = await prisma.regulatedRetention.findUnique({ where: { id: req.params.id } });
    if (!record) throw notFound("Record not found");
    const userId = record.userId;
    const [tomb, card, virtualCards, payments, feeQuotes, tickets, purchases, kyc, audits, closureRequests] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, deletedAt: true, termsAcceptedAt: true, termsVersion: true, language: true, preferredCurrency: true } }),
      prisma.card.findUnique({ where: { userId }, select: CARD_PUBLIC }),
      prisma.virtualCard.findMany({ where: { OR: [{ ownerId: userId }, { holderId: userId }] }, select: VCARD_PUBLIC }),
      prisma.qrPayment.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.feeQuote.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.voiceCreditPurchase.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      prisma.kycVerification.findUnique({ where: { userId }, select: { status: true, method: true, attempts: true, verifiedAt: true, createdAt: true } }),
      prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { action: true, amount: true, metadata: true, ip: true, createdAt: true } }),
      prisma.cardClosureRequest.findMany({ where: { userId }, orderBy: { requestedAt: "asc" } }),
    ]);
    const cardActivity = card ? await prisma.cardActivity.findMany({ where: { cardId: card.id }, orderBy: { date: "asc" } }) : [];
    const vcIds = virtualCards.map((c) => c.id);
    const virtualCardActivity = vcIds.length ? await prisma.virtualCardActivity.findMany({ where: { cardId: { in: vcIds } }, orderBy: { createdAt: "asc" } }) : [];
    const identity = record.status === "released" ? null : await decryptedIdentity(userId);

    await writeAudit(req.userId, "admin.regulated_exported", { ip: req.ip, targetUserId: userId, retentionId: record.id });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="mitapesa-regulated-${userId}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date(), record: withState(record), account: tomb, identity, kyc, card, cardActivity, virtualCards, virtualCardActivity, qrPayments: payments, feeQuotes, supportTickets: tickets, creditPurchases: purchases, closureRequests, auditLog: audits }, null, 2));
  })
);

// Legal hold: while set, the record can't be released, however old it is.
router.post(
  "/regulated/:id/hold",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { hold, reason } = z.object({ hold: z.boolean(), reason: z.string().trim().max(500).optional() }).parse(req.body);
    res.json(await setLegalHold({ id: req.params.id, hold, reason, adminUserId: req.userId, ip: req.ip }));
  })
);

// Releasing erases the customer's identity details once the period has ended.
// Never automatic; the ledgers themselves are untouched.
router.post(
  "/regulated/:id/release",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().trim().min(3, "Say why this record is being released").max(500) }).parse(req.body);
    res.json(await releaseRecords({ id: req.params.id, adminUserId: req.userId, note, ip: req.ip }));
  })
);

// After the retention period setting changes, re-date the existing entries.
router.post(
  "/regulated-recalculate",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    z.object({ confirm: z.literal(true) }).parse(req.body);
    res.json(await recalculateEndDates({ adminUserId: req.userId, ip: req.ip }));
  })
);

module.exports = router;
