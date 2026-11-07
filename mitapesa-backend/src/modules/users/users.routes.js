const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { publicUser } = require("../../lib/serialize");
const { writeAudit } = require("../../lib/audit");
const { changePasswordSchema } = require("../auth/auth.schema");
const authService = require("../auth/auth.service");
const reminders = require("../../lib/reminders");
const { sendPushToUser } = require("../../lib/push");

const router = Router();
router.use(requireAuth);

// Letters (incl. accented/Swahili), spaces, hyphens, apostrophes — reasonable
// for real names while still rejecting stray symbols/digits from typos.
const nameField = z.string().trim().min(1).max(60).regex(/^[\p{L} '-]+$/u, "Only letters, spaces, hyphens and apostrophes are allowed");

const updateSchema = z.object({
  firstName: nameField.optional(),
  middleName: nameField.optional().nullable(),
  lastName: nameField.optional(),
  language: z.enum(["en", "sw"]).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

const NAME_FIELDS = ["firstName", "middleName", "lastName"];

router.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const patch = updateSchema.parse(req.body);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const user = await prisma.user.update({ where: { id: req.userId }, data: patch });

    // Requirement 1: every name correction is audit-logged with the before/after
    // values so there's a record of what was changed and when — this is
    // specifically for typo corrections post-onboarding, so it's worth
    // keeping a trail even though it's self-service.
    const changedNameFields = NAME_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== before[f]);
    if (changedNameFields.length) {
      await writeAudit(req.userId, "user.name_corrected", {
        ip: req.ip,
        changes: Object.fromEntries(changedNameFields.map((f) => [f, { from: before[f], to: patch[f] }])),
      });
    }

    res.json({ user: publicUser(user) });
  })
);

// ---- Daily expense reminder -------------------------------------------
const reminderSchema = z.object({
  enabled: z.boolean().optional(),
  time: z.string().regex(reminders.TIME_RE, "Use HH:MM, e.g. 20:00").optional(),
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(), // 0 = Sunday … 6 = Saturday; empty = every day
});

router.get(
  "/me/reminder",
  asyncHandler(async (req, res) => {
    res.json({ reminder: await reminders.getReminder(req.userId) });
  })
);

router.put(
  "/me/reminder",
  asyncHandler(async (req, res) => {
    const patch = reminderSchema.parse(req.body);
    const reminder = await reminders.saveReminder(req.userId, patch);
    await writeAudit(req.userId, "user.reminder_updated", { ip: req.ip, enabled: reminder.enabled, time: reminder.time });
    res.json({ reminder });
  })
);

// Lets the customer (and you, when testing a new phone) confirm that
// notifications actually reach this device. One per 30 seconds per customer.
const lastTestAt = new Map();
router.post(
  "/me/reminder/test",
  asyncHandler(async (req, res) => {
    const now = Date.now();
    if (now - (lastTestAt.get(req.userId) || 0) < 30000) return res.status(429).json({ error: "Please wait a few seconds before sending another test." });
    lastTestAt.set(req.userId, now);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const { title, body } = reminders.reminderText(user, 0);
    const { hasPushDevice } = await reminders.getReminder(req.userId);
    if (hasPushDevice) await sendPushToUser(req.userId, { title, body, url: "/" });
    res.json({ sent: hasPushDevice, hasPushDevice });
  })
);

router.post(
  "/me/password",
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.userId, currentPassword, newPassword, req.ip);
    // All sessions (including this one's refresh token) were just revoked —
    // the client should treat this as a forced logout and send the user to log back in.
    res.json({ message: "Password changed. Please log in again." });
  })
);

module.exports = router;
