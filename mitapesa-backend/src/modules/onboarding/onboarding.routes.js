const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");

const router = Router();
router.use(requireAuth);

// GET /onboarding/tips — every active tip, both languages, with a
// per-tip "seen" flag for this specific customer. Returns both textEn
// and textSw rather than picking one server-side, so the client can
// switch its display language without a second request, and so a
// welcome-tour tip (tourStep set) and an ordinary per-screen banner tip
// (tourStep null) are both present in one response — the client filters
// by key or by tourStep for whichever it needs at that moment.
router.get(
  "/tips",
  asyncHandler(async (req, res) => {
    const [tips, seen] = await Promise.all([
      prisma.onboardingTip.findMany({ where: { active: true }, orderBy: { tourStep: "asc" } }),
      prisma.userSeenTip.findMany({ where: { userId: req.userId }, select: { tipKey: true } }),
    ]);
    const seenKeys = new Set(seen.map((s) => s.tipKey));
    res.json({
      tips: tips.map((t) => ({
        key: t.key,
        textEn: t.textEn,
        textSw: t.textSw,
        tourStep: t.tourStep,
        seen: seenKeys.has(t.key),
      })),
    });
  })
);

// POST /onboarding/tips/:key/seen — marks one tip as seen/dismissed for
// this customer, permanently (no "un-dismiss"). Idempotent: dismissing
// an already-seen tip again is a harmless no-op, not an error — the
// client doesn't need to track locally whether it already sent this.
router.post(
  "/tips/:key/seen",
  asyncHandler(async (req, res) => {
    const { key } = z.object({ key: z.string().min(1).max(100) }).parse(req.params);
    await prisma.userSeenTip.upsert({
      where: { userId_tipKey: { userId: req.userId, tipKey: key } },
      update: {},
      create: { userId: req.userId, tipKey: key },
    });
    res.json({ ok: true });
  })
);

module.exports = router;
