const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const env = require("../../lib/env");
const { asyncHandler } = require("../../middleware/errorHandler");
const { requireAuth } = require("../../middleware/auth");
const { publicUser } = require("../../lib/serialize");
const { unauthorized, badRequest, forbidden, locked } = require("../../lib/errors");
const { getSetting } = require("../../lib/settings");
const { getDisplayCurrencyRate } = require("../../lib/currencyConversion");
const { hashToken } = require("../../lib/jwt");
const { setRefreshCookie, clearRefreshCookie, COOKIE_NAME } = require("../../lib/cookies");
const { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } = require("./auth.schema");
const authService = require("./auth.service");
const { getSmsProvider } = require("../../services/sms");
const { getEmailProvider } = require("../../services/email");
const { writeAudit } = require("../../lib/audit");

const router = Router();

// Auth endpoints are the most brute-forceable surface in the app — keep them tightly limited.
// This is on top of the per-account lockout in auth.service (which survives a server restart;
// this limiter additionally slows down attempts spread across many different accounts/IPs).
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

// Tighter than authLimiter — an unlimited SMS-send endpoint is a direct
// money-drain vector once a real SMS provider is wired in (someone can
// script sending OTPs to arbitrary numbers at your expense).
const smsLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

const PHONE_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const EMAIL_OTP_TTL_MS = 30 * 60 * 1000; // 30 minutes — longer than SMS since checking email takes longer than reading a text that just arrived
const phoneSchema = z.object({ phone: z.string().min(8).max(9).regex(/^\d+$/, "Digits only, no country code") });

router.post(
  "/phone/send-otp",
  smsLimiter,
  asyncHandler(async (req, res) => {
    const { phone } = phoneSchema.parse(req.body);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await prisma.phoneVerification.create({
      data: { phone, codeHash: hashToken(code), expiresAt: new Date(Date.now() + PHONE_OTP_TTL_MS) },
    });
    try {
      await getSmsProvider().sendOtp(`+255${phone}`, code);
    } catch (err) {
      console.error("SMS provider failed to send OTP:", err.message); // eslint-disable-line no-console
      throw badRequest("We couldn't send a verification code right now. Please try again shortly.");
    }
    res.json({ sent: true, expiresInSec: Math.floor(PHONE_OTP_TTL_MS / 1000) });
  })
);

router.post(
  "/phone/verify-otp",
  smsLimiter,
  asyncHandler(async (req, res) => {
    const { phone, code } = z.object({ phone: z.string().min(8).max(9), code: z.string().length(6) }).parse(req.body);

    const record = await prisma.phoneVerification.findFirst({
      where: { phone, verified: false, usedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt < new Date()) throw badRequest("Code expired or not found. Request a new one.");
    if (record.attempts >= env.security.maxPhoneOtpAttempts) throw locked("Too many attempts. Request a new code.");

    if (record.codeHash !== hashToken(code)) {
      await prisma.phoneVerification.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      return res.json({ verified: false });
    }

    const verifyToken = crypto.randomBytes(24).toString("hex");
    await prisma.phoneVerification.update({ where: { id: record.id }, data: { verified: true, verifyToken } });
    await writeAudit(null, "auth.phone.verified", { ip: req.ip, phone });
    res.json({ verified: true, verifyToken });
  })
);

router.post(
  "/email/send-otp",
  smsLimiter,
  asyncHandler(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await prisma.emailVerification.create({
      data: { email, codeHash: hashToken(code), expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS) },
    });
    try {
      await getEmailProvider().sendVerificationCode(email, code);
    } catch (err) {
      console.error("Email provider failed to send verification code:", err.message); // eslint-disable-line no-console
      throw badRequest("We couldn't send a verification code right now. Please try again shortly.");
    }
    res.json({ sent: true, expiresInSec: Math.floor(EMAIL_OTP_TTL_MS / 1000) });
  })
);

router.post(
  "/email/verify-otp",
  smsLimiter,
  asyncHandler(async (req, res) => {
    const { email, code } = z.object({ email: z.string().email(), code: z.string().length(6) }).parse(req.body);

    const record = await prisma.emailVerification.findFirst({
      where: { email, verified: false, usedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt < new Date()) throw badRequest("Code expired or not found. Request a new one.");
    if (record.attempts >= env.security.maxPhoneOtpAttempts) throw locked("Too many attempts. Request a new code.");

    if (record.codeHash !== hashToken(code)) {
      await prisma.emailVerification.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      return res.json({ verified: false });
    }

    const verifyToken = crypto.randomBytes(24).toString("hex");
    await prisma.emailVerification.update({ where: { id: record.id }, data: { verified: true, verifyToken } });
    await writeAudit(null, "auth.email.verified", { ip: req.ip, email });
    res.json({ verified: true, verifyToken });
  })
);

router.post(
  "/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await authService.registerUser(input);
    const { accessToken, refreshToken } = await authService.issueTokenPair(user);
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user: publicUser(user), accessToken });
  })
);

router.post(
  "/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await authService.authenticate(email, password, req.ip);
    const { accessToken, refreshToken } = await authService.issueTokenPair(user);
    setRefreshCookie(res, refreshToken);
    res.json({ user: publicUser(user), accessToken });
  })
);

router.post(
  "/refresh",
  authLimiter,
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[COOKIE_NAME];
    if (!refreshToken) throw unauthorized("No refresh token cookie present");
    const { accessToken, refreshToken: newRefreshToken } = await authService.rotateRefreshToken(refreshToken);
    setRefreshCookie(res, newRefreshToken);
    res.json({ accessToken });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[COOKIE_NAME];
    if (refreshToken) await authService.revokeRefreshToken(refreshToken);
    clearRefreshCookie(res);
    res.status(204).send();
  })
);

router.post(
  "/forgot-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    await authService.requestPasswordReset(email, req.ip);
    // Same response whether or not the email exists — don't leak account existence.
    res.json({ message: "If that email has an account, a reset link has been sent." });
  })
);

router.post(
  "/reset-password",
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(token, newPassword, req.ip);
    res.json({ message: "Password updated. Please log in with your new password." });
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    let currencyRate = 1;
    try {
      currencyRate = await getDisplayCurrencyRate(user.preferredCurrency);
    } catch (err) {
      // A missing/failed rate shouldn't break loading the user's profile
      // at all — fall back to 1 (i.e. display as TZS) and let the
      // frontend show its own "rate unavailable" state where relevant,
      // rather than this endpoint failing outright.
      console.error("Couldn't fetch display currency rate:", err.message); // eslint-disable-line no-console
    }
    res.json({ user: publicUser(user), currencyRate });
  })
);

// PATCH /auth/me/currency { currency } — sets which currency the
// customer's PFM view (Insights, Budget, Ledger, receipt/manual entries)
// runs in. Does NOT touch their actual wallet balance, which stays TZS
// regardless — see the schema comment on User.preferredCurrency for why.
// Which currencies are offered, and whether this feature is available at
// all, are both admin-configured (Admin Portal -> Settings), not fixed
// here — see multi_currency_enabled / available_currencies.
router.patch(
  "/me/currency",
  requireAuth,
  asyncHandler(async (req, res) => {
    const enabled = (await getSetting("multi_currency_enabled")) !== "false";
    if (!enabled) throw forbidden("Changing your running currency is currently turned off.");

    const availableCurrencies = ((await getSetting("available_currencies")) || "TZS").split(",").map((c) => c.trim()).filter(Boolean);
    if (availableCurrencies.length === 0) availableCurrencies.push("TZS");
    const { currency } = z.object({ currency: z.enum(availableCurrencies) }).parse(req.body);

    let currencyRate = 1;
    try {
      currencyRate = await getDisplayCurrencyRate(currency);
    } catch (err) {
      throw badRequest(`${currency} isn't set up yet — ${err.message}`);
    }

    const user = await prisma.user.update({ where: { id: req.userId }, data: { preferredCurrency: currency } });
    await writeAudit(req.userId, "profile.currency_changed", { ip: req.ip, currency });
    res.json({ user: publicUser(user), currencyRate });
  })
);

// Step-up re-authentication (e.g. confirming an unusual-value QR payment) —
// requires an already-valid session, distinct from /login which establishes one.
router.post(
  "/verify-password",
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(1) }).parse(req.body);
    await authService.verifyPassword(req.userId, password, req.ip);
    res.json({ verified: true });
  })
);

module.exports = router;
