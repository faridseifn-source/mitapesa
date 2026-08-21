require("dotenv").config();

function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

module.exports = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  // Comma-separated list — the customer app and the admin portal are
  // separate frontend deployments on separate domains, both need to be
  // allowed here. e.g. "https://mitapesa.dugapay.com,https://mitapesa-admin.dugapay.com"
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173").split(",").map((s) => s.trim()).filter(Boolean),

  // WebAuthn (biometric login) — the RP ID must be the exact hostname the
  // frontend is served from (no scheme, no port, e.g. "mitapesa.dugapay.com"),
  // and origins are checked against the same allow-list as CORS. Both are
  // deployment-specific, so neither is hardcoded.
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || "MitaPesa",
    rpID: process.env.WEBAUTHN_RP_ID || "localhost",
  },

  // Web Push (RFC 8030) VAPID identity — a self-issued key pair that
  // identifies this server to push services (Apple/Google/Mozilla relays),
  // not a third-party credential. Must stay stable across deploys: rotating
  // it invalidates every existing subscription.
  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || "",
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || "",
    vapidSubject: process.env.VAPID_SUBJECT || "mailto:support@dugapay.com",
    // Firebase service account credentials (server-side, for sending native
    // push via FCM) - the full JSON key file's contents, as a single-line
    // string. Distinct from google-services.json, which is client-side and
    // ships inside the Android app itself, not a secret.
    firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  },

  jwt: {
    // Deliberately no fallback for these two - a JWT signing secret with
    // any predictable/guessable default would let anyone who's ever seen
    // this code forge a valid token for any account, including admin
    // accounts. The app should fail to start rather than run with a
    // known-insecure default. Generate real values with e.g.
    // `openssl rand -hex 32` and set them on Render before deploying.
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
    refreshMaxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days — keep in sync with refreshExpiresIn above
    // Admin sessions are deliberately much shorter-lived than customer
    // sessions — a stolen admin session cookie is far more damaging than a
    // stolen customer one, so it should have far less time to be useful.
    adminAccessExpiresIn: process.env.ADMIN_JWT_ACCESS_EXPIRES_IN || "15m",
    adminRefreshMaxAgeMs: Number(process.env.ADMIN_SESSION_HOURS || 8) * 60 * 60 * 1000, // 8 hours default
  },

  security: {
    maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
    loginLockoutMs: Number(process.env.LOGIN_LOCKOUT_MINUTES || 15) * 60 * 1000,
    maxKycAttempts: Number(process.env.MAX_KYC_ATTEMPTS || 5),
    maxPhoneOtpAttempts: Number(process.env.MAX_PHONE_OTP_ATTEMPTS || 5),
    encryptionKey: process.env.ENCRYPTION_KEY || "", // required for NIDA/KYC profile sync — see lib/crypto.js
  },

  providers: {
    kyc: process.env.KYC_PROVIDER || "mock",
    paymentsRail: process.env.PAYMENTS_RAIL_PROVIDER || "mock",
    cardFunding: process.env.CARD_FUNDING_PROVIDER || "mock",
    cardIssuing: process.env.CARD_ISSUING_PROVIDER || "mock",
    email: process.env.EMAIL_PROVIDER || "mock",
    sms: process.env.SMS_PROVIDER || "mock",
    cbs: process.env.CBS_PROVIDER || "mock",
    tips: process.env.TIPS_RAIL_PROVIDER || "mock",
    ocr: process.env.OCR_PROVIDER || "mock",
    exchangeRate: process.env.EXCHANGE_RATE_PROVIDER || "manual",
  },

  ocr: {
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    geminiModel: process.env.GEMINI_OCR_MODEL || "gemini-3.5-flash-lite",
  },

  exchangeRate: {
    apiKey: process.env.EXCHANGE_RATE_API_KEY || "",
  },

  email: {
    resendApiKey: process.env.RESEND_API_KEY || "",
    fromAddress: process.env.EMAIL_FROM_ADDRESS || "MitaPesa <onboarding@resend.dev>",
  },

  sms: {
    atApiKey: process.env.AFRICASTALKING_API_KEY || "",
    atUsername: process.env.AFRICASTALKING_USERNAME || "sandbox",
    atSenderId: process.env.AFRICASTALKING_SENDER_ID || "",
  },

  kycThresholdTZS: Number(process.env.KYC_AMOUNT_THRESHOLD_TZS || 50000),
};
