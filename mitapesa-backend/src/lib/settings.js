const prisma = require("./prisma");

const DEFAULTS = {
  household_max_members: "3",
  // CMS (Card Management System) configuration — non-secret values only.
  // Real credentials/URLs for a live CMS connection belong in environment
  // variables, never in this DB-backed settings table (an admin-portal
  // screen reading this table should never be able to leak a live secret).
  // BIN (Bank Identification Number) is genuinely a business parameter, not
  // a secret, and real CMS platforms (e.g. BPC SmartVista) configure it per
  // card "Product" — this is that same configuration point, simulated.
  card_bin: "428427", // 6-digit BIN prefix used when generating mock card numbers
  cms_provider_label: "mock", // human-readable label shown in an admin portal, e.g. "BPC SmartVista (sandbox)"
  // Our own partner bank's TIPS Acquirer ID (BOT TANQR Annex 3: 2-digit
  // category + 3-digit participant code, e.g. "01001" for a bank). A scanned
  // QR whose Acquirer ID matches this is an on-us payment; anything else
  // routes off-us through TIPS. Placeholder until the real bank relationship
  // assigns a real code.
  partner_bank_acquirer_id: "01999",
  // Simulated failure injection, as a percentage string ("0"-"100") — lets
  // the reversal/reconciliation logic be genuinely tested without waiting
  // for a real failure. Zero by default (every simulated posting succeeds).
  cbs_simulated_failure_rate: "0",
  tips_simulated_failure_rate: "0",
  // Whether the "Test payments" sample-QR shortcuts appear at all — real for
  // development/demo, should be turned off once real merchant QR codes are
  // in use so customers never see a "no real bank connected yet" hint.
  qr_test_samples_enabled: "true",
  // Amounts at or under this are treated as routine and skip the
  // confirmation/step-up-auth screen entirely. Above it (but still under
  // KYC_AMOUNT_THRESHOLD_TZS, which remains a hard regulatory floor that can
  // never be skipped) triggers password/biometric confirmation.
  // "Paste a QR payload" is a developer/tester convenience — no real
  // customer would ever have a raw TANQR string to type in. Off before the
  // live app ships; kept as its own toggle (distinct from
  // qr_test_samples_enabled) so an admin can turn either off independently.
  qr_manual_payload_paste_enabled: "true",
  qr_step_up_threshold: "20000",
  // Admin-configurable kill switch for biometric login (Requirement: make
  // this feature enable/disable-able by an admin). Gates BOTH new device
  // enrollment and login with an already-enrolled device — turning this
  // off mid-flight doesn't leave existing biometric logins working.
  biometric_login_enabled: "true",
  // Admin-configurable kill switch for push notifications. Off means new
  // subscriptions are refused AND sending becomes a silent no-op — the
  // underlying action (payment completing, dispute resolved, etc.) still
  // succeeds either way, it just doesn't also push a notification.
  push_notifications_enabled: "true",
  // Admin kill switch for receipt scanning specifically — when off, the
  // feature is unavailable to customers (directs them to manual entry)
  // rather than silently falling back to any kind of placeholder data.
  receipt_ocr_enabled: "true",
  // Admin kill switch for the customer-facing transaction/insights export
  // specifically — unrelated to the card statement export, which has its
  // own separate flow and isn't affected by this.
  pfm_export_enabled: "true",
  // Admin kill switch for the entire Pay module (QR, Lipa, GePG, LUKU,
  // card top-up/management — everything payment- and card-related) while
  // the partner bank connection needed to actually process real money is
  // still pending. Lets PFM launch on its own timeline, independent of
  // that integration. Off means: no card is issued at signup (see
  // auth.service.js), every card/payment API route refuses requests (see
  // middleware/payModule.js), and any customer who already signed up
  // while this was off gets their card provisioned lazily, the moment
  // they first need one after an admin switches this back on (see
  // cardHelpers.js myCard()) — no backfill migration needed to "turn it
  // on", by design.
  pay_module_enabled: "true",
  // Admin controls for the multi-currency PFM feature: whether customers
  // can change their running currency at all, and which currencies are
  // offered. A comma-separated list rather than a fixed array — an admin
  // can add/remove currencies without a code change or redeploy.
  // Defaults OFF deliberately: the amount formatter throughout the app
  // (fmt/fmtTZS) doesn't yet read this preference — it always labels
  // amounts "TZS" regardless. Turning this on before that display-layer
  // work is done would mean a customer's converted USD amounts show
  // correctly-converted numbers mislabeled as TZS, which is actively
  // misleading, not just incomplete. See docs/MULTI_CURRENCY.md.
  multi_currency_enabled: "false",
  available_currencies: "TZS,USD,KES,UGX,ZAR,EUR,GBP,RWF",
  // Which onboarding verification channel is active — a single value
  // rather than two independent toggles, so "SMS on" and "email on" can
  // never both be true (or both false) at once; switching one
  // automatically means the other is off, by construction rather than by
  // remembering to sync two settings. Defaults to email while SMS
  // delivery (Africa's Talking sender ID registration) is pending.
  verification_method: "email",
};

async function getSetting(key) {
  const row = await prisma.systemSetting.findUnique({ where: { key } });
  return row ? row.value : DEFAULTS[key];
}

async function getSettingNumber(key) {
  const val = await getSetting(key);
  return val === undefined ? undefined : Number(val);
}

async function setSetting(key, value) {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

module.exports = { getSetting, getSettingNumber, setSetting, DEFAULTS };
