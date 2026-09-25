const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { requireAdmin, requireAdminRole } = require("../../middleware/admin");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, conflict } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");

const router = Router();
router.use(requireAuth, requireAdmin);

// Every field an admin can set, shared between create and update so the
// two schemas can't silently drift apart from each other.
const institutionFields = {
  acquirerId: z.string().length(5).regex(/^\d{5}$/, "Acquirer ID must be exactly 5 digits (2-digit category + 3-digit participant code)"),
  name: z.string().min(2).max(150),
  shortCode: z.string().max(20).optional().nullable(),
  swiftCode: z.string().max(11).optional().nullable(),
  institutionType: z.enum(["bank", "mno", "microfinance", "other"]).default("bank"),
  isActive: z.boolean().default(true),
  transfersEnabled: z.boolean().default(true),
  minTransferAmount: z.number().min(0).default(0),
  maxTransferAmount: z.number().positive().optional().nullable(),
  dailyTransferLimit: z.number().positive().optional().nullable(),
  feeType: z.enum(["none", "fixed", "percentage"]).default("none"),
  feeFixedAmount: z.number().min(0).default(0),
  feePercentage: z.number().min(0).max(100).default(0),
  feeCapAmount: z.number().positive().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
};

function serialize(inst) {
  return {
    ...inst,
    minTransferAmount: Number(inst.minTransferAmount),
    maxTransferAmount: inst.maxTransferAmount !== null ? Number(inst.maxTransferAmount) : null,
    dailyTransferLimit: inst.dailyTransferLimit !== null ? Number(inst.dailyTransferLimit) : null,
    feeFixedAmount: Number(inst.feeFixedAmount),
    feePercentage: Number(inst.feePercentage),
    feeCapAmount: inst.feeCapAmount !== null ? Number(inst.feeCapAmount) : null,
  };
}

// GET /admin/institutions?search=&active= — any admin tier can view.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = (req.query.search || "").trim();
    const where = {
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { acquirerId: { contains: search } }, { shortCode: { contains: search, mode: "insensitive" } }] } : {}),
      ...(req.query.active === "true" ? { isActive: true } : req.query.active === "false" ? { isActive: false } : {}),
    };
    const institutions = await prisma.financialInstitution.findMany({ where, orderBy: { name: "asc" } });
    res.json({ institutions: institutions.map(serialize) });
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const institution = await prisma.financialInstitution.findUnique({ where: { id: req.params.id } });
    if (!institution) throw notFound("Institution not found");
    res.json({ institution: serialize(institution) });
  })
);

// Creating/editing routing rules for real money movement — super admin only,
// same tier as blocking accounts or changing roles.
router.post(
  "/",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const input = z.object(institutionFields).parse(req.body);
    input.categoryCode = input.acquirerId.slice(0, 2);
    input.participantCode = input.acquirerId.slice(2);

    const existing = await prisma.financialInstitution.findUnique({ where: { acquirerId: input.acquirerId } });
    if (existing) throw conflict("An institution with this Acquirer ID already exists");

    const institution = await prisma.financialInstitution.create({ data: input });
    await writeAudit(req.userId, "admin.institution.created", { ip: req.ip, institutionId: institution.id, acquirerId: institution.acquirerId, name: institution.name });
    res.status(201).json({ institution: serialize(institution) });
  })
);

router.patch(
  "/:id",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const input = z.object(institutionFields).partial().parse(req.body);
    const existing = await prisma.financialInstitution.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Institution not found");

    if (input.acquirerId && input.acquirerId !== existing.acquirerId) {
      const clash = await prisma.financialInstitution.findUnique({ where: { acquirerId: input.acquirerId } });
      if (clash) throw conflict("An institution with this Acquirer ID already exists");
      input.categoryCode = input.acquirerId.slice(0, 2);
      input.participantCode = input.acquirerId.slice(2);
    }

    const institution = await prisma.financialInstitution.update({ where: { id: existing.id }, data: input });
    await writeAudit(req.userId, "admin.institution.updated", { ip: req.ip, institutionId: institution.id, changes: Object.keys(input) });
    res.json({ institution: serialize(institution) });
  })
);

router.delete(
  "/:id",
  requireAdminRole("admin_super"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.financialInstitution.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound("Institution not found");
    await prisma.financialInstitution.delete({ where: { id: existing.id } });
    await writeAudit(req.userId, "admin.institution.deleted", { ip: req.ip, institutionId: existing.id, acquirerId: existing.acquirerId, name: existing.name });
    res.status(204).send();
  })
);

module.exports = router;
