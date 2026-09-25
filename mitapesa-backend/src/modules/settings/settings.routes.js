const { Router } = require("express");
const { asyncHandler } = require("../../middleware/errorHandler");
const { getSetting } = require("../../lib/settings");

const router = Router();

// Deliberately unauthenticated — the login screen needs to know whether
// biometric login is enabled BEFORE any session exists, and every key on
// this whitelist is a plain feature toggle, not sensitive data. Never add
// a key here without checking it's genuinely safe to expose with no auth
// at all (nothing about BIN, CMS provider internals, or admin-only config).
const PUBLIC_KEYS = ["qr_test_samples_enabled", "qr_manual_payload_paste_enabled", "qr_step_up_threshold", "biometric_login_enabled", "push_notifications_enabled", "receipt_ocr_enabled", "pfm_export_enabled", "pay_module_enabled", "multi_currency_enabled", "available_currencies", "verification_method", "household_max_members"];

router.get(
  "/public",
  asyncHandler(async (req, res) => {
    const values = await Promise.all(PUBLIC_KEYS.map((k) => getSetting(k)));
    res.json({ settings: Object.fromEntries(PUBLIC_KEYS.map((k, i) => [k, values[i]])) });
  })
);

module.exports = router;
