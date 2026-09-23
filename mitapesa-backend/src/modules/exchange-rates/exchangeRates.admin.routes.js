const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { requireAdmin, requireAdminRole } = require("../../middleware/admin");
const { asyncHandler } = require("../../middleware/errorHandler");
const { writeAudit } = require("../../lib/audit");

const router = Router();
router.use(requireAuth, requireAdmin);

function serialize(r) {
  return { id: r.id, currency: r.currency, rateToTZS: Number(r.rateToTZS), updatedAt: r.updatedAt, updatedByUserId: r.updatedByUserId };
}

// GET /admin/exchange-rates — every manually-configured rate, most
// recently updated first. Viewer tier can see these (read-only,
// informational — matches other admin_viewer read access elsewhere).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const rates = await prisma.manualExchangeRate.findMany({ orderBy: { updatedAt: "desc" } });
    res.json({ rates: rates.map(serialize) });
  })
);

// PUT /admin/exchange-rates/:currency { rateToTZS } — creates or updates
// the rate for a currency. Real money conversions (receipt scans, manual
// foreign-currency entries, and every customer's display conversion) can
// depend on this, so it's support-tier-and-above only, not viewer.
router.put(
  "/:currency",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const currency = req.params.currency.toUpperCase();
    const { rateToTZS } = z.object({ rateToTZS: z.number().positive() }).parse(req.body);

    const rate = await prisma.manualExchangeRate.upsert({
      where: { currency },
      create: { currency, rateToTZS, updatedByUserId: req.userId },
      update: { rateToTZS, updatedByUserId: req.userId },
    });

    await writeAudit(req.userId, "admin.exchange_rate.updated", { ip: req.ip, currency, rateToTZS });
    res.json({ rate: serialize(rate) });
  })
);

// DELETE /admin/exchange-rates/:currency
router.delete(
  "/:currency",
  requireAdminRole("admin_support"),
  asyncHandler(async (req, res) => {
    const currency = req.params.currency.toUpperCase();
    await prisma.manualExchangeRate.deleteMany({ where: { currency } });
    await writeAudit(req.userId, "admin.exchange_rate.deleted", { ip: req.ip, currency });
    res.json({ success: true });
  })
);

module.exports = router;
