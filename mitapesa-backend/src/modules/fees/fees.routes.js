const { Router } = require("express");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { requirePayModuleEnabled } = require("../../middleware/payModule");
const { notFound, badRequest } = require("../../lib/errors");
const { serializeBundle, serializeSubscription, purchaseBundleForUser, cancelSubscriptionForUser } = require("../../lib/bundleLifecycle");

const router = Router();
router.use(requireAuth);
router.use(asyncHandler(requirePayModuleEnabled));

// GET /fees/bundles — every bundle a customer could currently purchase.
// Shows price, validity, included services, and limits up front — the
// spec's "display terms before purchase" requirement — before any purchase
// action, not after.
router.get(
  "/bundles",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const bundles = await prisma.feeBundle.findMany({
      where: {
        isActive: true,
        OR: [{ startDate: null }, { startDate: { lte: now } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: now } }] }],
      },
      orderBy: { price: "asc" },
    });
    res.json({ bundles: bundles.map(serializeBundle) });
  })
);

// GET /fees/bundles/my — the customer's own subscriptions (active, expired,
// cancelled), most recent first.
router.get(
  "/bundles/my",
  asyncHandler(async (req, res) => {
    const subs = await prisma.customerBundleSubscription.findMany({
      where: { userId: req.userId },
      include: { bundle: true },
      orderBy: { purchasedAt: "desc" },
    });
    res.json({ subscriptions: subs.map(serializeSubscription) });
  })
);

router.post(
  "/bundles/:id/purchase",
  asyncHandler(async (req, res) => {
    const bundle = await prisma.feeBundle.findUnique({ where: { id: req.params.id } });
    if (!bundle) throw notFound("This bundle isn't available");
    const subscription = await purchaseBundleForUser(req.userId, bundle);
    res.status(201).json({ subscription: serializeSubscription(subscription) });
  })
);

// PATCH /fees/bundles/subscriptions/:id — toggle auto-renew on an active
// subscription, without needing to cancel and re-purchase.
router.patch(
  "/bundles/subscriptions/:id",
  asyncHandler(async (req, res) => {
    const sub = await prisma.customerBundleSubscription.findUnique({ where: { id: req.params.id } });
    if (!sub || sub.userId !== req.userId) throw notFound("Subscription not found");
    if (sub.status !== "ACTIVE") throw badRequest("This subscription isn't active");
    const updated = await prisma.customerBundleSubscription.update({ where: { id: sub.id }, data: { autoRenew: !!req.body.autoRenew }, include: { bundle: true } });
    res.json({ subscription: serializeSubscription(updated) });
  })
);

router.post(
  "/bundles/subscriptions/:id/cancel",
  asyncHandler(async (req, res) => {
    const { refundAmount } = await cancelSubscriptionForUser(req.userId, req.params.id);
    res.json({ success: true, refundAmount });
  })
);

module.exports = router;
