const { Router } = require("express");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const notifications = await prisma.notification.findMany({ where: { userId: req.userId }, orderBy: { date: "desc" }, take: 100 });
    res.json({ notifications });
  })
);

router.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await prisma.notification.update({ where: { id: req.params.id }, data: { read: true } });
    res.json({ notification });
  })
);

router.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({ where: { userId: req.userId, read: false }, data: { read: true } });
    res.status(204).send();
  })
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.notification.deleteMany({ where: { id: req.params.id, userId: req.userId } });
    res.status(204).send();
  })
);

router.delete(
  "/",
  asyncHandler(async (req, res) => {
    await prisma.notification.deleteMany({ where: { userId: req.userId } });
    res.status(204).send();
  })
);

module.exports = router;
