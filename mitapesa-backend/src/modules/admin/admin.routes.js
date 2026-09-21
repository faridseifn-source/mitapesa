const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { requireAdmin, requireAdminRole } = require("../../middleware/admin");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, badRequest } = require("../../lib/errors");
const { decryptField } = require("../../lib/crypto");
const { writeAudit } = require("../../lib/audit");
const { notifyUser } = require("../../lib/notify");
const { sendPushToUser } = require("../../lib/push");
const { publicUser } = require("../../lib/serialize");
const authService = require("../auth/auth.service");
const { getSetting, setSetting, DEFAULTS } = require("../../lib/settings");
const { computeStatement } = require("../../lib/statement");
const { statementToCsv, sendCsv } = require("../../lib/csv");
const { runReconciliation } = require("../../lib/reconciliation");

const router = Router();
router.use(requireAuth, requireAdmin);

// Every view of a customer's full NIDA record, every block/unblock, every
// settings change is audit-logged — including which admin did it and when.

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// Requirement: "some users might end up seeing very limited information."
// admin_viewer gets a redacted user shape — no full email/phone, no
// financial data. admin_support and admin_super get the full picture.
const maskEmail = (email) => email.replace(/^(.{2}).*(@.*)$/, "$1***$2");
const maskPhone = (phone) => `***${String(phone).slice(-4)}`;

function serializeUserForRole(user, adminRole) {
  const base = publicUser(user);
  if (adminRole === "admin_viewer") {
    return { id: base.id, firstName: base.firstName, lastName: base.lastName, email: maskEmail(base.email), phone: maskPhone(base.phone), kycStatus: base.kycStatus, createdAt: base.createdAt };
  }
  return base;
}

// GET /admin/users?search=&page=&pageSize=
router.get(
  "/users",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const search = (req.query.search || "").trim();
    const where = search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
          ],
        }
      : {};

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ users: users.map((u) => serializeUserForRole(u, req.adminRole)), total, page, pageSize });
  })
);

// GET /admin/users/:userId/overview — a single call for an admin detail
// screen. Viewer tier gets the redacted shape and no financial/KYC detail.
router.get(
  "/users/:userId/overview",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound("User not found");

    if (req.adminRole === "admin_viewer") {
      return res.json({ user: serializeUserForRole(user, req.adminRole), card: null, virtualCardCount: null, walletCount: null, kyc: null });
    }

    const [card, virtualCardCount, walletCount, kycProfile] = await Promise.all([
      prisma.card.findUnique({ where: { userId: user.id } }),
      prisma.virtualCard.count({ where: { OR: [{ ownerId: user.id }, { holderId: user.id }] } }),
      prisma.walletMember.count({ where: { userId: user.id } }),
      prisma.kycNidaProfile.findUnique({ where: { userId: user.id }, select: { syncStatus: true, syncedAt: true, sourceProvider: true } }),
    ]);

    res.json({
      user: serializeUserForRole(user, req.adminRole),
      card: card ? { balance: Number(card.balance), frozen: card.frozen, last4: card.last4, processorRef: card.processorRef } : null,
      virtualCardCount,
      walletCount,
      kyc: kycProfile,
    });
  })
);

router.get(
  "/users/:userId",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound("User not found");
    res.json({ user: serializeUserForRole(user, req.adminRole) });
  })
);

// GET /admin/users/:userId/kyc — support tier and above only; every view audited.
router.get(
  "/users/:userId/kyc",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const profile = await prisma.kycNidaProfile.findUnique({ where: { userId: req.params.userId } });
    if (!profile) throw notFound("No NIDA profile on file for this user");

    const decrypted = {
      firstName: decryptField(profile.firstNameEnc),
      middleName: decryptField(profile.middleNameEnc),
      lastName: decryptField(profile.lastNameEnc),
      sex: decryptField(profile.sexEnc),
      dateOfBirth: decryptField(profile.dateOfBirthEnc),
      maritalStatus: decryptField(profile.maritalStatusEnc),
      placeOfBirth: decryptField(profile.placeOfBirthEnc),
      citizenshipType: decryptField(profile.citizenshipTypeEnc),
      nidaPhone: decryptField(profile.nidaPhoneEnc),
      region: decryptField(profile.regionEnc),
      district: decryptField(profile.districtEnc),
      ward: decryptField(profile.wardEnc),
      villageOrStreet: decryptField(profile.villageOrStreetEnc),
      photoUrl: decryptField(profile.photoEnc),
      sourceProvider: profile.sourceProvider,
      syncStatus: profile.syncStatus,
      syncError: profile.syncError,
      syncedAt: profile.syncedAt,
      lastAttemptAt: profile.lastAttemptAt,
    };

    await writeAudit(req.userId, "admin.kyc.viewed", { ip: req.ip, targetUserId: req.params.userId });
    res.json({ profile: decrypted });
  })
);

// GET /admin/users/:userId/transactions?search=&limit= — support tier and
// above. Powers the "pick from this customer's transactions" step when
// logging a dispute on their behalf; also generally useful for support to
// see recent activity without pulling a full statement.
router.get(
  "/users/:userId/transactions",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const search = (req.query.search || "").trim();
    const memberships = await prisma.walletMember.findMany({ where: { userId: req.params.userId }, select: { walletId: true } });
    const walletIds = memberships.map((m) => m.walletId);
    if (!walletIds.length) return res.json({ transactions: [] });

    const transactions = await prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
        ...(search ? { merchant: { contains: search, mode: "insensitive" } } : {}),
      },
      orderBy: { date: "desc" },
      take: limit,
      include: { category: { select: { name: true } } },
    });
    res.json({
      transactions: transactions.map((tx) => ({
        id: tx.id,
        merchant: tx.merchant,
        amount: Number(tx.amount),
        date: tx.date,
        reference: tx.reference,
        category: tx.category?.name,
      })),
    });
  })
);

// GET /admin/users/:userId/statement?from=&to= — support tier and above.
router.get(
  "/users/:userId/statement",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const card = await prisma.card.findUnique({ where: { userId: req.params.userId } });
    if (!card) throw notFound("No card on file for this user");

    const now = new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : now;
    if (isNaN(from.getTime()) || isNaN(to.getTime())) throw badRequest("Invalid from/to date");

    const activitySinceFrom = await prisma.cardActivity.findMany({ where: { cardId: card.id, date: { gte: from } }, orderBy: { date: "asc" } });
    const statement = computeStatement({ currentBalance: Number(card.balance), activitySinceFrom, from, to });
    await writeAudit(req.userId, "admin.statement_pulled", { ip: req.ip, targetUserId: req.params.userId, from, to, format: req.query.format || "json" });

    if (req.query.format === "csv") {
      return sendCsv(res, `mitapesa-statement-${req.params.userId}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, statementToCsv(statement));
    }
    res.json(statement);
  })
);

// POST/DELETE block — super admin only. Blocking is immediate and locks the
// customer out of login entirely (distinct from the temporary brute-force
// lockout), so it's the most consequential single action in this portal.
router.post(
  "/users/:userId/block",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { reason } = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound("User not found");

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { blockedByAdmin: true, blockedReason: reason, blockedAt: new Date(), blockedByUserId: req.userId },
    });
    await writeAudit(req.userId, "admin.user.blocked", { ip: req.ip, targetUserId: user.id, reason });
    await notifyUser(user.id, { type: "account_blocked", title: "Account access restricted", message: "Your MitaPesa account has been temporarily blocked. Please contact support.", url: "/support" });
    res.json({ user: publicUser(updated) });
  })
);

router.post(
  "/users/:userId/unblock",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound("User not found");

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { blockedByAdmin: false, blockedReason: null, blockedAt: null, blockedByUserId: null },
    });
    await writeAudit(req.userId, "admin.user.unblocked", { ip: req.ip, targetUserId: user.id });
    await notifyUser(user.id, { type: "account_unblocked", title: "Account access restored", message: "Your MitaPesa account is active again.", url: "/" });
    res.json({ user: publicUser(updated) });
  })
);

// POST /admin/users/:userId/role — super admin only. Promotes a customer to
// an admin tier, changes tiers, or demotes an admin back to "customer".
// Refuses to demote/change the very last admin_super, so the portal can
// never lock every admin out of the highest tier.
router.post(
  "/users/:userId/role",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { role } = z.object({ role: z.enum(["customer", "admin_viewer", "admin_support", "admin_super"]) }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!user) throw notFound("User not found");

    if (user.role === "admin_super" && role !== "admin_super") {
      const superAdminCount = await prisma.user.count({ where: { role: "admin_super" } });
      if (superAdminCount <= 1) {
        throw badRequest("Can't remove the last super admin — promote someone else to admin_super first");
      }
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data: { role } });
    await writeAudit(req.userId, "admin.user.role_changed", { ip: req.ip, targetUserId: user.id, fromRole: user.role, toRole: role });
    res.json({ user: publicUser(updated) });
  })
);

/* --------------------------- staff admin accounts --------------------------- */
// A distinct, safer path from "promote a customer" (above) — this creates a
// brand-new account that was never a customer, so it never has a wallet or
// card attached, which is exactly what makes it safe to fully delete later.

router.get(
  "/staff",
  asyncHandler(async (req, res) => {
    const staff = await prisma.user.findMany({ where: { role: { startsWith: "admin_" } }, orderBy: { createdAt: "desc" } });
    res.json({ staff: staff.map(publicUser) });
  })
);

router.post(
  "/staff",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const input = z.object({
      firstName: z.string().min(1).max(60),
      lastName: z.string().min(1).max(60),
      email: z.string().email(),
      phone: z.string().min(8).max(15),
      role: z.enum(["admin_viewer", "admin_support", "admin_super"]),
    }).parse(req.body);

    const user = await authService.createStaffAdmin(input, req.ip);
    res.status(201).json({ user: publicUser(user) });
  })
);

router.delete(
  "/staff/:id",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) throw notFound("Staff account not found");
    if (!target.role.startsWith("admin_")) throw badRequest("This account isn't an admin account");
    if (target.id === req.userId) throw badRequest("You can't delete your own account");

    if (target.role === "admin_super") {
      const superAdminCount = await prisma.user.count({ where: { role: "admin_super" } });
      if (superAdminCount <= 1) throw badRequest("Can't delete the last super admin — promote someone else first");
    }

    // Safety check: only ever hard-delete an account that has no financial
    // history attached — a staff account created via POST /staff above
    // never has one, but an admin promoted from a real customer (via the
    // /role endpoint) does, and deleting that would cascade away real
    // transaction/card records. Demote those instead — the role endpoint
    // already supports setting role back to "customer".
    const card = await prisma.card.findUnique({ where: { userId: target.id } });
    if (card) throw badRequest("This admin has real customer financial history attached — demote to \"customer\" instead of deleting (use the role endpoint)");

    await prisma.user.delete({ where: { id: target.id } });
    await writeAudit(req.userId, "admin.staff.deleted", { ip: req.ip, targetUserId: target.id, targetEmail: target.email, targetRole: target.role });
    res.status(204).send();
  })
);

/* -------------------------------- tickets -------------------------------- */
// admin_viewer: read-only. admin_support and above: create/update/resolve.

const serializeTicket = (t) => ({ ...t, disputedAmount: t.disputedAmount === null || t.disputedAmount === undefined ? null : Number(t.disputedAmount) });

router.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const where = {
      ...(req.query.status ? { status: req.query.status } : {}),
      ...(req.query.userId ? { userId: req.query.userId } : {}),
    };
    const [total, tickets] = await Promise.all([
      prisma.supportTicket.count({ where }),
      prisma.supportTicket.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { firstName: true, lastName: true, phone: true } } } }),
    ]);
    res.json({ tickets: tickets.map(serializeTicket), total, page, pageSize });
  })
);

router.post(
  "/tickets",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { userId, category, subject, description, relatedTransactionId, disputedReference, disputedDate, disputedAmount, disputedMerchant } = z
      .object({
        userId: z.string().min(1),
        category: z.enum(["dispute", "inquiry", "complaint", "fraud"]),
        subject: z.string().min(3).max(150),
        description: z.string().min(3).max(2000),
        relatedTransactionId: z.string().optional(),
        disputedReference: z.string().max(60).optional(),
        disputedDate: z.string().optional(),
        disputedAmount: z.number().positive().optional(),
        disputedMerchant: z.string().max(150).optional(),
      })
      .parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");

    // Same integrity rule as the customer-facing route: when a real
    // transaction is cited, we snapshot ITS actual values rather than
    // trusting whatever was typed into the form — an admin fat-fingering an
    // amount while filling this out on a call shouldn't corrupt the record
    // of what the transaction actually was.
    let disputeFields = {
      disputedReference: disputedReference || null,
      disputedDate: disputedDate ? new Date(disputedDate) : null,
      disputedAmount: disputedAmount ?? null,
      disputedMerchant: disputedMerchant || null,
    };
    if (relatedTransactionId) {
      const transaction = await prisma.transaction.findUnique({ where: { id: relatedTransactionId } });
      if (!transaction) throw notFound("That transaction couldn't be found");
      const membership = await prisma.walletMember.findFirst({ where: { walletId: transaction.walletId, userId } });
      if (!membership) throw badRequest("That transaction doesn't belong to this customer");
      disputeFields = {
        disputedReference: transaction.reference || null,
        disputedDate: transaction.date,
        disputedAmount: Math.abs(Number(transaction.amount)),
        disputedMerchant: transaction.merchant,
      };
    } else if (disputeFields.disputedDate && isNaN(disputeFields.disputedDate.getTime())) {
      throw badRequest("Invalid disputed transaction date");
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId, category, subject, description, relatedTransactionId: relatedTransactionId || null,
        ...disputeFields,
        loggedByAdminId: req.userId,
      },
    });
    await writeAudit(req.userId, "admin.ticket.created", { ip: req.ip, targetUserId: userId, ticketId: ticket.id });
    res.status(201).json({ ticket: serializeTicket(ticket) });
  })
);

router.patch(
  "/tickets/:ticketId",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { status, resolutionNotes, assignedAdminId } = z
      .object({ status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(), resolutionNotes: z.string().max(2000).optional(), assignedAdminId: z.string().optional() })
      .parse(req.body);
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.ticketId } });
    if (!ticket) throw notFound("Ticket not found");

    const updated = await prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        ...(status ? { status } : {}),
        ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
        ...(assignedAdminId !== undefined ? { assignedAdminId } : {}),
        ...(status === "resolved" || status === "closed" ? { resolvedAt: new Date() } : {}),
      },
    });
    await writeAudit(req.userId, "admin.ticket.updated", { ip: req.ip, ticketId: ticket.id, status });
    if (status === "resolved" && ticket.status !== "resolved") {
      await notifyUser(ticket.userId, { type: "ticket_resolved", title: "Your request has been resolved", message: `"${ticket.subject}" has been resolved${resolutionNotes ? " — check the details in Help & support." : "."}`, url: "/support" });
    }
    res.json({ ticket: serializeTicket(updated) });
  })
);

/* ------------------------------- dashboard -------------------------------- */

// GET /admin/dashboard — summary counters for the portal's landing screen.
router.get(
  "/dashboard",
  asyncHandler(async (req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [totalUsers, activeUsers, newUsersThisMonth, kycVerified, kycPending, blockedUsers, openTickets, cardBalanceAgg] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { lastLoginAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.user.count({ where: { kycStatus: "VERIFIED" } }),
      prisma.user.count({ where: { kycStatus: { in: ["NONE", "PENDING"] } } }),
      prisma.user.count({ where: { blockedByAdmin: true } }),
      prisma.supportTicket.count({ where: { status: { in: ["open", "in_progress"] } } }),
      req.adminRole === "admin_viewer" ? null : prisma.card.aggregate({ _sum: { balance: true } }),
    ]);

    res.json({
      totalUsers,
      activeUsers30d: activeUsers,
      newUsersThisMonth,
      kycVerified,
      kycPending,
      blockedUsers,
      openTickets,
      totalCardBalance: cardBalanceAgg ? Number(cardBalanceAgg._sum.balance || 0) : null, // null (hidden) for viewer tier
    });
  })
);

// GET /admin/dashboard/trends?days=30 — day-by-day series for the
// dashboard's trend chart, instead of only point-in-time counts. Bucketed
// in application code rather than raw SQL, since the data volume here is
// small enough that this stays simple and DB-portable.
router.get(
  "/dashboard/trends",
  asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);

    const [users, payments, tickets] = await Promise.all([
      prisma.user.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
      req.adminRole === "admin_viewer" ? [] : prisma.qrPayment.findMany({ where: { createdAt: { gte: from }, status: "completed" }, select: { createdAt: true, amount: true } }),
      prisma.supportTicket.findMany({ where: { createdAt: { gte: from } }, select: { createdAt: true } }),
    ]);

    const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
    const buckets = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
      buckets[dayKey(d)] = { date: dayKey(d), newUsers: 0, completedPayments: 0, paymentVolume: 0, newTickets: 0 };
    }
    for (const u of users) { const k = dayKey(u.createdAt); if (buckets[k]) buckets[k].newUsers++; }
    for (const p of payments) { const k = dayKey(p.createdAt); if (buckets[k]) { buckets[k].completedPayments++; buckets[k].paymentVolume += Number(p.amount); } }
    for (const t of tickets) { const k = dayKey(t.createdAt); if (buckets[k]) buckets[k].newTickets++; }

    res.json({ days: Object.values(buckets) });
  })
);

// System settings — super admin only to change; any admin tier can view.
router.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const keys = Object.keys(DEFAULTS);
    const values = await Promise.all(keys.map((k) => getSetting(k)));
    res.json({ settings: Object.fromEntries(keys.map((k, i) => [k, values[i]])) });
  })
);

router.patch(
  "/settings/:key",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    if (!(key in DEFAULTS)) throw notFound("Unknown setting key");
    const { value } = z.object({ value: z.string().min(1) }).parse(req.body);
    await setSetting(key, value);
    await writeAudit(req.userId, "admin.setting_updated", { ip: req.ip, key, value });
    res.json({ key, value });
  })
);

// GET /admin/audit-logs?userId=&action=&page=&pageSize= — support tier and above.
router.get(
  "/audit-logs",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const where = {
      ...(req.query.userId ? { userId: req.query.userId } : {}),
      ...(req.query.action ? { action: { contains: req.query.action } } : {}),
    };
    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ logs: logs.map((l) => ({ ...l, amount: l.amount === null ? null : Number(l.amount) })), total, page, pageSize });
  })
);

/* --------------------------- QR payment reconciliation --------------------------- */

// POST /admin/reconciliation/run { date? } — daily reconciliation between
// the wallet ledger, simulated CBS, and simulated TIPS. Super admin only —
// this is a sensitive financial control, not a routine lookup.
router.post(
  "/reconciliation/run",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { date } = z.object({ date: z.string().optional() }).parse(req.body);
    const result = await runReconciliation(date);
    await writeAudit(req.userId, "admin.reconciliation.run", { ip: req.ip, ...result });
    res.json(result);
  })
);

// GET /admin/reconciliation/exceptions?status= — the investigation queue.
router.get(
  "/reconciliation/exceptions",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const where = req.query.status ? { status: req.query.status } : {};
    const [total, exceptions] = await Promise.all([
      prisma.reconciliationException.count({ where }),
      prisma.reconciliationException.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ exceptions, total, page, pageSize });
  })
);

router.patch(
  "/reconciliation/exceptions/:id",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { status, resolutionNotes } = z.object({ status: z.enum(["open", "investigating", "resolved"]).optional(), resolutionNotes: z.string().max(2000).optional() }).parse(req.body);
    const exception = await prisma.reconciliationException.findUnique({ where: { id: req.params.id } });
    if (!exception) throw notFound("Exception not found");
    const updated = await prisma.reconciliationException.update({
      where: { id: exception.id },
      data: {
        ...(status ? { status } : {}),
        ...(resolutionNotes !== undefined ? { resolutionNotes } : {}),
        ...(status === "resolved" ? { resolvedByUserId: req.userId, resolvedAt: new Date() } : {}),
      },
    });
    await writeAudit(req.userId, "admin.reconciliation.exception_updated", { ip: req.ip, exceptionId: exception.id, status });
    res.json({ exception: updated });
  })
);

/* --------------------------- broadcasts --------------------------- */

// POST /admin/broadcast — sends a Notification + push to EVERY customer at
// once. Super admin only — this is one of the most consequential single
// actions in the portal (reaches every user, can't be un-sent), same
// reasoning as blocking an account or changing a role.
router.post(
  "/broadcast",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { title, message, url } = z
      .object({ title: z.string().min(3).max(100), message: z.string().min(3).max(500), url: z.string().max(200).optional() })
      .parse(req.body);

    const users = await prisma.user.findMany({ where: { role: "customer" }, select: { id: true } });

    // Write every in-app Notification row in one batch, then send push
    // separately (push has its own per-device fan-out and failure handling
    // inside notifyUser — reusing it per-user keeps that logic in one place
    // rather than duplicating a batch-push path here).
    await prisma.notification.createMany({
      data: users.map((u) => ({ userId: u.id, type: "broadcast", title, message })),
    });
    await Promise.all(users.map((u) => sendPushToUser(u.id, { title, body: message, url: url || "/" })));

    const broadcast = await prisma.broadcast.create({
      data: { title, message, sentByUserId: req.userId, recipientCount: users.length },
    });
    await writeAudit(req.userId, "admin.broadcast.sent", { ip: req.ip, broadcastId: broadcast.id, recipientCount: users.length });

    res.status(201).json({ broadcast });
  })
);

router.get(
  "/broadcasts",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const [total, broadcasts] = await Promise.all([
      prisma.broadcast.count(),
      prisma.broadcast.findMany({ orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    res.json({ broadcasts, total, page, pageSize });
  })
);

module.exports = router;
