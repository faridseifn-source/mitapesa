const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const env = require("../../lib/env");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { forbidden } = require("../../lib/errors");
const { getSetting } = require("../../lib/settings");
const { sendPushToUser } = require("../../lib/push");
const { writeAudit } = require("../../lib/audit");

const router = Router();

// GET /push/vapid-public-key — deliberately unauthenticated; a VAPID public
// key is, by design, safe to hand to anyone (it's how the browser's push
// subscription proves which server is allowed to send to it — the actual
// secret is the private key, which never leaves the server).
router.get(
  "/vapid-public-key",
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("push_notifications_enabled")) !== "false";
    res.json({ publicKey: env.push.vapidPublicKey || null, enabled: enabled && !!env.push.vapidPublicKey });
  })
);

router.use(requireAuth);

router.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("push_notifications_enabled")) !== "false";
    if (!enabled) throw forbidden("Push notifications are currently turned off for this app");

    const { endpoint, keys } = z
      .object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }) })
      .parse(req.body);

    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { userId: req.userId, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.get("user-agent") || null },
      create: { userId: req.userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: req.get("user-agent") || null },
    });
    await writeAudit(req.userId, "push.subscribed", { ip: req.ip });
    res.status(204).send();
  })
);

router.post(
  "/unsubscribe",
  asyncHandler(async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: req.userId } });
    await writeAudit(req.userId, "push.unsubscribed", { ip: req.ip });
    res.status(204).send();
  })
);

// POST /push/register-device — the native-app counterpart to /subscribe,
// for the FCM token a Capacitor app gets from PushNotifications.register()
// rather than a browser's endpoint/keys pair. A token is unique per
// upsert (same reasoning as web push's endpoint) so re-registering after
// a token refresh just updates the existing row instead of duplicating it.
router.post(
  "/register-device",
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("push_notifications_enabled")) !== "false";
    if (!enabled) throw forbidden("Push notifications are currently turned off for this app");

    const { token, platform } = z.object({ token: z.string().min(1), platform: z.enum(["android", "ios"]) }).parse(req.body);

    await prisma.pushDeviceToken.upsert({
      where: { token },
      update: { userId: req.userId, platform },
      create: { userId: req.userId, token, platform },
    });
    await writeAudit(req.userId, "push.device_registered", { ip: req.ip, platform });
    res.status(204).send();
  })
);

router.post(
  "/unregister-device",
  asyncHandler(async (req, res) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
    await prisma.pushDeviceToken.deleteMany({ where: { token, userId: req.userId } });
    await writeAudit(req.userId, "push.device_unregistered", { ip: req.ip });
    res.status(204).send();
  })
);

// POST /push/test — lets a customer confirm push actually works on their
// device right after enabling it, from the same settings screen.
router.post(
  "/test",
  asyncHandler(async (req, res) => {
    await sendPushToUser(req.userId, { title: "MitaPesa", body: "This is a test notification — if you can see this, push notifications are working.", url: "/" });
    res.json({ sent: true });
  })
);

module.exports = router;
