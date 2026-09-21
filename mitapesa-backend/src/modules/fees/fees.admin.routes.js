const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { requireAdmin, requireAdminRole } = require("../../middleware/admin");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, badRequest, conflict } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");
const { validateTiers } = require("../../lib/feeEngine");
const { processBundleRenewals } = require("../../lib/bundleLifecycle");
const { csvRow, sendCsv } = require("../../lib/csv");

const router = Router();
router.use(requireAuth, requireAdmin);

const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const serializeDecimalFields = (obj, fields) => {
  const out = { ...obj };
  for (const f of fields) if (out[f] !== null && out[f] !== undefined) out[f] = Number(out[f]);
  return out;
};

/* ------------------------------ transaction types ------------------------------ */

router.get(
  "/transaction-types",
  asyncHandler(async (req, res) => {
    const types = await prisma.feeTransactionType.findMany({ orderBy: { code: "asc" } });
    res.json({ transactionTypes: types });
  })
);

router.post(
  "/transaction-types",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const input = z.object({
      code: z.string().min(2).max(60).regex(/^[A-Z0-9_]+$/, "Code must be UPPER_SNAKE_CASE"),
      nameEn: z.string().min(2).max(100),
      nameSw: z.string().min(2).max(100),
      descriptionEn: z.string().max(500).optional().nullable(),
      descriptionSw: z.string().max(500).optional().nullable(),
      isMonetizable: z.boolean().default(true),
    }).parse(req.body);

    const existing = await prisma.feeTransactionType.findUnique({ where: { code: input.code } });
    if (existing) throw conflict("A transaction type with this code already exists");

    const type = await prisma.feeTransactionType.create({ data: input });
    await writeAudit(req.userId, "admin.fee.transaction_type.created", { ip: req.ip, code: type.code });
    res.status(201).json({ transactionType: type });
  })
);

router.patch(
  "/transaction-types/:id",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const input = z.object({
      nameEn: z.string().min(2).max(100).optional(),
      nameSw: z.string().min(2).max(100).optional(),
      descriptionEn: z.string().max(500).optional().nullable(),
      descriptionSw: z.string().max(500).optional().nullable(),
      isActive: z.boolean().optional(),
      isMonetizable: z.boolean().optional(),
    }).parse(req.body);
    const existing = await prisma.feeTransactionType.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Transaction type not found");
    const type = await prisma.feeTransactionType.update({ where: { id: existing.id }, data: input });
    await writeAudit(req.userId, "admin.fee.transaction_type.updated", { ip: req.ip, code: type.code, changes: Object.keys(input) });
    res.json({ transactionType: type });
  })
);

/* ------------------------------ fee rules ------------------------------ */

const tierSchema = z.object({
  minAmount: z.number().min(0),
  maxAmount: z.number().positive().optional().nullable(),
  feeModel: z.enum(["fixed", "percentage"]),
  fixedAmount: z.number().min(0).optional().nullable(),
  percentage: z.number().min(0).max(100).optional().nullable(),
});

const ruleSchema = z.object({
  name: z.string().min(2).max(150),
  transactionTypeId: z.string().min(1),
  feeModel: z.enum(["fixed", "percentage", "tiered", "fixed_plus_percentage", "zero", "display_only"]),
  fixedAmount: z.number().min(0).optional().nullable(),
  percentage: z.number().min(0).max(100).optional().nullable(),
  minFee: z.number().min(0).optional().nullable(),
  maxFee: z.number().positive().optional().nullable(),
  minAmount: z.number().min(0).optional().nullable(),
  maxAmount: z.number().positive().optional().nullable(),
  channel: z.string().max(30).optional().nullable(),
  onUsOffUs: z.enum(["ON_US", "OFF_US"]).optional().nullable(),
  customerSegment: z.string().max(30).optional().nullable(),
  accountType: z.enum(["PERSONAL", "SHARED"]).optional().nullable(),
  merchantCategory: z.string().max(10).optional().nullable(),
  currency: z.string().default("TZS"),
  country: z.string().default("TZ"),
  customerId: z.string().optional().nullable(),
  feePayer: z.enum(["CUSTOMER", "MERCHANT", "PARTNER", "MITAPESA"]).default("CUSTOMER"),
  taxTreatment: z.enum(["NONE", "VAT_INCLUSIVE", "VAT_EXCLUSIVE"]).default("NONE"),
  vatRate: z.number().min(0).max(100).default(0),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional().nullable(),
  campaignName: z.string().max(100).optional().nullable(),
  priority: z.number().int().default(100),
  descriptionEn: z.string().max(500).optional().nullable(),
  descriptionSw: z.string().max(500).optional().nullable(),
  tiers: z.array(tierSchema).optional(),
});

function serializeRule(rule) {
  const s = serializeDecimalFields(rule, ["fixedAmount", "percentage", "minFee", "maxFee", "minAmount", "maxAmount", "vatRate"]);
  if (rule.tiers) s.tiers = rule.tiers.map((t) => serializeDecimalFields(t, ["minAmount", "maxAmount", "fixedAmount", "percentage"]));
  return s;
}

router.get(
  "/rules",
  asyncHandler(async (req, res) => {
    const where = {
      ...(req.query.transactionTypeId ? { transactionTypeId: req.query.transactionTypeId } : {}),
      ...(req.query.status ? { status: req.query.status } : {}),
    };
    const rules = await prisma.feeRule.findMany({ where, include: { tiers: { orderBy: { sortOrder: "asc" } }, transactionType: true }, orderBy: { createdAt: "desc" } });
    res.json({ rules: rules.map(serializeRule) });
  })
);

router.get(
  "/rules/:id",
  asyncHandler(async (req, res) => {
    const rule = await prisma.feeRule.findUnique({ where: { id: req.params.id }, include: { tiers: { orderBy: { sortOrder: "asc" } }, transactionType: true, approval: true } });
    if (!rule) throw notFound("Rule not found");
    res.json({ rule: serializeRule(rule) });
  })
);

// Creating a rule always starts as DRAFT — it must go through the
// maker-checker flow below (/rules/:id/submit then /rules/:id/approve)
// before it can ever reach ACTIVE and actually price a transaction.
router.post(
  "/rules",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const input = ruleSchema.parse(req.body);
    if (input.feeModel === "tiered") {
      if (!input.tiers || !input.tiers.length) throw badRequest("A tiered fee rule needs at least one tier");
      validateTiers(input.tiers);
    }
    const { tiers, ...ruleFields } = input;
    const rule = await prisma.feeRule.create({
      data: {
        ...ruleFields,
        effectiveFrom: new Date(ruleFields.effectiveFrom),
        effectiveTo: ruleFields.effectiveTo ? new Date(ruleFields.effectiveTo) : null,
        status: "DRAFT",
        createdByUserId: req.userId,
        tiers: input.feeModel === "tiered" ? { create: tiers.map((t, i) => ({ ...t, sortOrder: i })) } : undefined,
      },
      include: { tiers: true },
    });
    await writeAudit(req.userId, "admin.fee.rule.created", { ip: req.ip, ruleId: rule.id, name: rule.name });
    res.status(201).json({ rule: serializeRule(rule) });
  })
);

router.patch(
  "/rules/:id",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.feeRule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Rule not found");
    if (existing.status === "ACTIVE") throw badRequest("An active rule can't be edited directly — clone it into a new version instead");

    const input = ruleSchema.partial().parse(req.body);
    if (input.tiers) validateTiers(input.tiers);
    const { tiers, ...ruleFields } = input;
    if (ruleFields.effectiveFrom) ruleFields.effectiveFrom = new Date(ruleFields.effectiveFrom);
    if (ruleFields.effectiveTo) ruleFields.effectiveTo = new Date(ruleFields.effectiveTo);

    const rule = await prisma.$transaction(async (tx) => {
      if (tiers) {
        await tx.feeTier.deleteMany({ where: { feeRuleId: existing.id } });
        await tx.feeTier.createMany({ data: tiers.map((t, i) => ({ ...t, feeRuleId: existing.id, sortOrder: i })) });
      }
      return tx.feeRule.update({ where: { id: existing.id }, data: ruleFields, include: { tiers: true } });
    });
    await writeAudit(req.userId, "admin.fee.rule.updated", { ip: req.ip, ruleId: rule.id, changes: Object.keys(input) });
    res.json({ rule: serializeRule(rule) });
  })
);

// Clones an ACTIVE (or any) rule into a new DRAFT version, for editing
// without touching the live rule — the spec's "clone" and "roll back to a
// previous approved configuration" both go through this same path.
router.post(
  "/rules/:id/clone",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.feeRule.findUnique({ where: { id: req.params.id }, include: { tiers: true } });
    if (!existing) throw notFound("Rule not found");
    const { id, createdAt, updatedAt, tiers, ...rest } = existing;
    const clone = await prisma.feeRule.create({
      data: {
        ...rest,
        parentRuleId: existing.parentRuleId || existing.id,
        version: existing.version + 1,
        status: "DRAFT",
        createdByUserId: req.userId,
        tiers: tiers.length ? { create: tiers.map(({ id: _tid, feeRuleId, ...t }, i) => ({ ...t, sortOrder: i })) } : undefined,
      },
      include: { tiers: true },
    });
    await writeAudit(req.userId, "admin.fee.rule.cloned", { ip: req.ip, fromRuleId: existing.id, newRuleId: clone.id });
    res.status(201).json({ rule: serializeRule(clone) });
  })
);

// Submits a DRAFT rule for approval — the maker step.
router.post(
  "/rules/:id/submit",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const { changeNote } = z.object({ changeNote: z.string().max(500).optional() }).parse(req.body);
    const rule = await prisma.feeRule.findUnique({ where: { id: req.params.id }, include: { tiers: true } });
    if (!rule) throw notFound("Rule not found");
    if (rule.status !== "DRAFT") throw badRequest("Only a draft rule can be submitted for approval");

    let previousSnapshot = null;
    if (rule.parentRuleId) {
      const parent = await prisma.feeRule.findFirst({ where: { OR: [{ id: rule.parentRuleId }, { parentRuleId: rule.parentRuleId }], status: "ACTIVE" } });
      if (parent) previousSnapshot = serializeRule(parent);
    }

    await prisma.$transaction([
      prisma.feeRule.update({ where: { id: rule.id }, data: { status: "PENDING_APPROVAL" } }),
      prisma.feeApprovalRequest.upsert({
        where: { feeRuleId: rule.id },
        update: { status: "PENDING", requestedByUserId: req.userId, changeNote, previousSnapshot, newSnapshot: serializeRule(rule), reviewedByUserId: null, reviewNote: null, reviewedAt: null },
        create: { feeRuleId: rule.id, requestedByUserId: req.userId, changeNote, previousSnapshot, newSnapshot: serializeRule(rule) },
      }),
    ]);
    await writeAudit(req.userId, "admin.fee.rule.submitted", { ip: req.ip, ruleId: rule.id });
    res.json({ success: true });
  })
);

// Approve/reject — the checker step. Must be a DIFFERENT admin than whoever
// requested it (maker-checker, not maker-approves-self), super admin only
// given this is what actually turns pricing changes live.
router.post(
  "/rules/:id/approve",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const { approve, reviewNote } = z.object({ approve: z.boolean(), reviewNote: z.string().max(500).optional() }).parse(req.body);
    const approval = await prisma.feeApprovalRequest.findUnique({ where: { feeRuleId: req.params.id }, include: { feeRule: true } });
    if (!approval) throw notFound("No pending approval for this rule");
    if (approval.status !== "PENDING") throw badRequest("This approval has already been reviewed");
    if (approval.requestedByUserId === req.userId) throw badRequest("The requester can't approve their own change — ask another super admin");

    if (approve) {
      // Deactivate any prior ACTIVE version of the same logical rule, so
      // there's never more than one active version at a time.
      if (approval.feeRule.parentRuleId) {
        await prisma.feeRule.updateMany({
          where: { OR: [{ id: approval.feeRule.parentRuleId }, { parentRuleId: approval.feeRule.parentRuleId }], status: "ACTIVE" },
          data: { status: "ARCHIVED" },
        });
      }
      await prisma.feeRule.update({ where: { id: req.params.id }, data: { status: "ACTIVE" } });
    } else {
      await prisma.feeRule.update({ where: { id: req.params.id }, data: { status: "REJECTED" } });
    }
    await prisma.feeApprovalRequest.update({ where: { id: approval.id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedByUserId: req.userId, reviewNote, reviewedAt: new Date() } });
    await writeAudit(req.userId, approve ? "admin.fee.rule.approved" : "admin.fee.rule.rejected", { ip: req.ip, ruleId: req.params.id });
    res.json({ success: true });
  })
);

router.post(
  "/rules/:id/deactivate",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const rule = await prisma.feeRule.findUnique({ where: { id: req.params.id } });
    if (!rule) throw notFound("Rule not found");
    if (rule.status !== "ACTIVE") throw badRequest("Only an active rule can be deactivated");
    await prisma.feeRule.update({ where: { id: rule.id }, data: { status: "INACTIVE" } });
    await writeAudit(req.userId, "admin.fee.rule.deactivated", { ip: req.ip, ruleId: rule.id });
    res.json({ success: true });
  })
);

router.get(
  "/approvals",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const where = req.query.status ? { status: req.query.status } : { status: "PENDING" };
    const approvals = await prisma.feeApprovalRequest.findMany({ where, include: { feeRule: { include: { transactionType: true } } }, orderBy: { createdAt: "desc" } });
    res.json({ approvals });
  })
);

/* ------------------------------ bundles ------------------------------ */

const bundleSchema = z.object({
  nameEn: z.string().min(2).max(100),
  nameSw: z.string().min(2).max(100),
  descriptionEn: z.string().max(500).optional().nullable(),
  descriptionSw: z.string().max(500).optional().nullable(),
  validity: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  price: z.number().min(0),
  taxTreatment: z.enum(["NONE", "VAT_INCLUSIVE", "VAT_EXCLUSIVE"]).default("NONE"),
  vatRate: z.number().min(0).max(100).default(0),
  includedTransactionTypeIds: z.array(z.string()).min(1),
  includedTransactionCount: z.number().int().positive().optional().nullable(),
  customerSegment: z.string().max(30).optional().nullable(),
  maxTransactionValue: z.number().positive().optional().nullable(),
  fairUsageLimit: z.number().int().positive().optional().nullable(),
  autoRenewDefault: z.boolean().default(false),
  gracePeriodDays: z.number().int().min(0).default(0),
  rolloverUnused: z.boolean().default(false),
  cancellable: z.boolean().default(true),
  refundable: z.boolean().default(false),
  isActive: z.boolean().default(true),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

function serializeBundle(b) {
  return serializeDecimalFields(b, ["price", "maxTransactionValue", "vatRate"]);
}

router.get(
  "/bundles",
  asyncHandler(async (req, res) => {
    const bundles = await prisma.feeBundle.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ bundles: bundles.map(serializeBundle) });
  })
);

router.post(
  "/bundles",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const input = bundleSchema.parse(req.body);
    const bundle = await prisma.feeBundle.create({
      data: { ...input, startDate: input.startDate ? new Date(input.startDate) : null, endDate: input.endDate ? new Date(input.endDate) : null },
    });
    await writeAudit(req.userId, "admin.fee.bundle.created", { ip: req.ip, bundleId: bundle.id, name: bundle.nameEn });
    res.status(201).json({ bundle: serializeBundle(bundle) });
  })
);

router.patch(
  "/bundles/:id",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.feeBundle.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Bundle not found");
    const input = bundleSchema.partial().parse(req.body);
    if (input.startDate) input.startDate = new Date(input.startDate);
    if (input.endDate) input.endDate = new Date(input.endDate);
    const bundle = await prisma.feeBundle.update({ where: { id: existing.id }, data: input });
    await writeAudit(req.userId, "admin.fee.bundle.updated", { ip: req.ip, bundleId: bundle.id, changes: Object.keys(input) });
    res.json({ bundle: serializeBundle(bundle) });
  })
);

router.delete(
  "/bundles/:id",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.feeBundle.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Bundle not found");
    await prisma.feeBundle.update({ where: { id: existing.id }, data: { isActive: false } }); // soft-delete — existing subscriptions must keep working
    await writeAudit(req.userId, "admin.fee.bundle.deactivated", { ip: req.ip, bundleId: existing.id });
    res.status(204).send();
  })
);

/* ------------------------------ exemptions ------------------------------ */

router.get(
  "/exemptions",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const where = req.query.userId ? { userId: req.query.userId } : {};
    const exemptions = await prisma.feeExemption.findMany({ where, orderBy: { createdAt: "desc" } });
    const userIds = [...new Set(exemptions.map((e) => e.userId))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } });
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    res.json({ exemptions: exemptions.map((e) => ({ ...e, customer: userById[e.userId] || null })) });
  })
);

router.post(
  "/exemptions",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const input = z.object({
      userId: z.string().min(1),
      transactionTypeId: z.string().optional().nullable(),
      reason: z.string().min(3).max(300),
      endDate: z.string().optional().nullable(),
    }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!user) throw notFound("Customer not found");
    const exemption = await prisma.feeExemption.create({
      data: { ...input, endDate: input.endDate ? new Date(input.endDate) : null, approvedByUserId: req.userId },
    });
    await writeAudit(req.userId, "admin.fee.exemption.created", { ip: req.ip, exemptionId: exemption.id, targetUserId: input.userId, reason: input.reason });
    res.status(201).json({ exemption });
  })
);

router.post(
  "/exemptions/:id/revoke",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.feeExemption.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Exemption not found");
    await prisma.feeExemption.update({ where: { id: existing.id }, data: { isActive: false } });
    await writeAudit(req.userId, "admin.fee.exemption.revoked", { ip: req.ip, exemptionId: existing.id });
    res.status(204).send();
  })
);

/* ------------------------------ reporting ------------------------------ */

// GET /admin/fees/report?from=&to= — revenue by transaction type, waived
// fees, partner fees disclosed, refunds. A first cut at Section 13 — date-
// range filtering only; CSV export and the fuller breakdowns (by payment
// rail, on-us vs off-us specifically) are natural next additions.
router.get(
  "/report",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : new Date();

    const records = await prisma.feeCollectionRecord.findMany({ where: { createdAt: { gte: from, lte: to } } });
    const byType = {};
    let totalMitaPesaFee = 0, totalPartnerFee = 0, totalTax = 0, totalReversed = 0, totalWaived = 0;
    for (const r of records) {
      byType[r.transactionTypeCode] = byType[r.transactionTypeCode] || { transactionTypeCode: r.transactionTypeCode, count: 0, mitaPesaFee: 0, partnerFee: 0, tax: 0, reversed: 0 };
      byType[r.transactionTypeCode].count++;
      byType[r.transactionTypeCode].mitaPesaFee += Number(r.mitaPesaFeeCollected);
      byType[r.transactionTypeCode].partnerFee += Number(r.partnerFeeDisclosed);
      byType[r.transactionTypeCode].tax += Number(r.taxCollected);
      byType[r.transactionTypeCode].reversed += Number(r.reversedAmount);
      totalMitaPesaFee += Number(r.mitaPesaFeeCollected);
      totalPartnerFee += Number(r.partnerFeeDisclosed);
      totalTax += Number(r.taxCollected);
      totalReversed += Number(r.reversedAmount);
      if (r.status === "WAIVED") totalWaived += Number(r.mitaPesaFeeCollected);
    }
    const bundleSales = await prisma.customerBundleSubscription.aggregate({ where: { purchasedAt: { gte: from, lte: to } }, _sum: { pricePaid: true }, _count: true });

    if (req.query.format === "csv") {
      let out = csvRow(["MitaPesa Fee Revenue Report"]);
      out += csvRow(["Period", `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`]);
      out += csvRow(["MitaPesa fee revenue", totalMitaPesaFee]);
      out += csvRow(["Partner fees disclosed", totalPartnerFee]);
      out += csvRow(["Tax collected", totalTax]);
      out += csvRow(["Reversed", totalReversed]);
      out += csvRow(["Waived", totalWaived]);
      out += csvRow(["Bundle sales revenue", Number(bundleSales._sum.pricePaid || 0)]);
      out += csvRow(["Bundle sales count", bundleSales._count]);
      out += csvRow([]);
      out += csvRow(["Transaction type", "Count", "MitaPesa fee", "Partner fee", "Tax", "Reversed"]);
      for (const t of Object.values(byType)) out += csvRow([t.transactionTypeCode, t.count, t.mitaPesaFee, t.partnerFee, t.tax, t.reversed]);
      return sendCsv(res, `mitapesa-fee-revenue-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, out);
    }

    res.json({
      from, to,
      totalMitaPesaFee, totalPartnerFee, totalTax, totalReversed, totalWaived,
      byTransactionType: Object.values(byType),
      bundleSalesRevenue: Number(bundleSales._sum.pricePaid || 0),
      bundleSalesCount: bundleSales._count,
    });
  })
);

// GET /admin/fees/report/detail?from=&to=&format=csv — every individual
// fee collection record in the period, with full context on why each fee
// was charged (which rule/bundle/exemption applied) and how it can be
// traced back to the underlying transaction. Built for a reconciliation
// officer or analyst to manually validate entries one by one — the
// aggregate /report above is for a dashboard glance, this is for an audit.
router.get(
  "/report/detail",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const from = req.query.from ? new Date(req.query.from) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = req.query.to ? new Date(req.query.to) : new Date();

    const records = await prisma.feeCollectionRecord.findMany({ where: { createdAt: { gte: from, lte: to } }, orderBy: { createdAt: "asc" } });

    const emptyMessage = "No fee collection records found for this period.";
    if (!records.length) {
      if (req.query.format === "csv") return sendCsv(res, `mitapesa-fee-transactions-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, csvRow([emptyMessage]));
      return res.json({ records: [], message: emptyMessage });
    }

    // Batch-fetch everything referenced, rather than one query per record —
    // this report is meant to run over a full month or more at once.
    const userIds = [...new Set(records.map((r) => r.userId))];
    const quoteIds = [...new Set(records.map((r) => r.quoteId))];
    const [users, quotes] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } }),
      prisma.feeQuote.findMany({ where: { id: { in: quoteIds } } }),
    ]);
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const quoteById = Object.fromEntries(quotes.map((q) => [q.id, q]));

    const ruleIds = [...new Set(quotes.map((q) => q.feeRuleId).filter(Boolean))];
    const bundleSubIds = [...new Set(quotes.map((q) => q.bundleSubscriptionId).filter(Boolean))];
    const exemptionIds = [...new Set(quotes.map((q) => q.exemptionId).filter(Boolean))];
    const [rules, bundleSubs, exemptions] = await Promise.all([
      prisma.feeRule.findMany({ where: { id: { in: ruleIds } } }),
      prisma.customerBundleSubscription.findMany({ where: { id: { in: bundleSubIds } }, include: { bundle: true } }),
      prisma.feeExemption.findMany({ where: { id: { in: exemptionIds } } }),
    ]);
    const ruleById = Object.fromEntries(rules.map((r) => [r.id, r]));
    const bundleSubById = Object.fromEntries(bundleSubs.map((s) => [s.id, s]));
    const exemptionById = Object.fromEntries(exemptions.map((e) => [e.id, e]));

    const rows = records.map((r) => {
      const user = userById[r.userId];
      const quote = quoteById[r.quoteId];
      const rule = quote?.feeRuleId ? ruleById[quote.feeRuleId] : null;
      const bundleSub = quote?.bundleSubscriptionId ? bundleSubById[quote.bundleSubscriptionId] : null;
      const exemption = quote?.exemptionId ? exemptionById[quote.exemptionId] : null;

      // The pricing basis explains WHY this row was charged what it was —
      // exactly the context a reconciliation officer needs to validate an
      // entry without having to separately look up the rule/bundle/exemption.
      let pricingBasis = "No rule matched (defaulted to free)";
      let pricingBasisDetail = "";
      if (exemption) { pricingBasis = "Customer exemption"; pricingBasisDetail = exemption.reason; }
      else if (bundleSub) { pricingBasis = "Bundle coverage"; pricingBasisDetail = bundleSub.bundle?.nameEn || bundleSub.bundleId; }
      else if (rule) { pricingBasis = "Standard fee rule"; pricingBasisDetail = `${rule.name} (v${rule.version}, ${rule.feeModel})`; }

      return {
        id: r.id,
        collectedAt: r.createdAt,
        customerName: user ? `${user.firstName} ${user.lastName}` : "Unknown customer",
        customerEmail: user?.email || "",
        customerPhone: user?.phone || "",
        customerId: r.userId,
        transactionTypeCode: r.transactionTypeCode,
        transactionReference: r.transactionRef,
        transactionAmount: quote ? Number(quote.amount) : null,
        pricingBasis,
        pricingBasisDetail,
        mitaPesaFeeCollected: Number(r.mitaPesaFeeCollected),
        partnerFeeDisclosed: Number(r.partnerFeeDisclosed),
        taxCollected: Number(r.taxCollected),
        totalFeeCollected: Number(r.mitaPesaFeeCollected) + Number(r.partnerFeeDisclosed) + Number(r.taxCollected),
        status: r.status,
        reversedAmount: Number(r.reversedAmount),
        netMitaPesaFeeRetained: Number(r.mitaPesaFeeCollected) - Number(r.reversedAmount),
        disclosureShownToCustomer: quote?.disclosureEn || "",
      };
    });

    if (req.query.format === "csv") {
      let out = csvRow(["MitaPesa Fee Transaction Detail — Reconciliation Export"]);
      out += csvRow(["Period", `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`]);
      out += csvRow(["Generated", new Date().toISOString()]);
      out += csvRow(["Total records", rows.length]);
      out += csvRow([]);
      out += csvRow([
        "Record ID",
        "Date & Time Collected (UTC)",
        "Customer Name",
        "Customer Email",
        "Customer Phone",
        "Customer ID",
        "Transaction Type",
        "Transaction Reference (links to the underlying payment)",
        "Original Transaction Amount TZS (excludes fees)",
        "Pricing Basis (why this fee applies)",
        "Pricing Basis Detail (rule / bundle / exemption name)",
        "MitaPesa Fee Collected TZS",
        "Partner or Bank Fee Disclosed TZS (not collected by MitaPesa — see FEE_ENGINE.md)",
        "Tax Collected TZS",
        "Total Fee Collected TZS (MitaPesa + Partner + Tax)",
        "Status (COLLECTED / WAIVED / REVERSED / PARTIALLY_REVERSED)",
        "Amount Reversed TZS (against MitaPesa fee only)",
        "Net MitaPesa Fee Retained TZS (after any reversal)",
        "Disclosure Shown To Customer At Payment Time",
      ]);
      for (const row of rows) {
        out += csvRow([
          row.id, new Date(row.collectedAt).toISOString(), row.customerName, row.customerEmail, row.customerPhone, row.customerId,
          row.transactionTypeCode, row.transactionReference, row.transactionAmount, row.pricingBasis, row.pricingBasisDetail,
          row.mitaPesaFeeCollected, row.partnerFeeDisclosed, row.taxCollected, row.totalFeeCollected,
          row.status, row.reversedAmount, row.netMitaPesaFeeRetained, row.disclosureShownToCustomer,
        ]);
      }
      return sendCsv(res, `mitapesa-fee-transactions-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`, out);
    }

    res.json({ records: rows });
  })
);

/* ------------------------------ bundle renewals ------------------------------ */

// POST /admin/fees/bundles/process-renewals — runs the same auto-renewal
// job the in-process scheduler runs periodically (see index.js). Exists so
// this can be tested/triggered immediately rather than waiting on the
// interval — real money moves here (renewal charges), so super admin only.
router.post(
  "/bundles/process-renewals",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const result = await processBundleRenewals();
    await writeAudit(req.userId, "admin.fee.bundle.renewals_run", { ip: req.ip, ...result });
    res.json(result);
  })
);

module.exports = router;
