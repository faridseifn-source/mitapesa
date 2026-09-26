const { Router } = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { asyncHandler } = require("../../middleware/errorHandler");
const { requireAuth } = require("../../middleware/auth");
const { unauthorized, badRequest, locked, forbidden } = require("../../lib/errors");
const { hashToken } = require("../../lib/jwt");
const { setAdminRefreshCookie, clearAdminRefreshCookie, ADMIN_COOKIE_NAME } = require("../../lib/cookies");
const { publicUser } = require("../../lib/serialize");
const { isAdminRole } = require("../../lib/adminRoles");
const authService = require("../auth/auth.service");
const { getEmailProvider } = require("../../services/email");
const { writeAudit } = require("../../lib/audit");

const router = Router();

// Deliberately tighter than the customer auth limiter — this is the
// highest-value target in the whole system to brute-force.
const adminAuthLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const genCode = () => String(Math.floor(100000 + Math.random() * 900000));

// POST /admin/auth/login { email, password } — step 1 of 2. Never issues
// tokens directly, even on correct credentials — every admin login requires
// the second factor below. Deliberately reuses the SAME authenticate() the
// customer app uses, so brute-force lockout and admin-block checks apply
// identically; the only new thing here is the role check and the OTP step.
router.post(
  "/login",
  adminAuthLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
    const user = await authService.authenticate(email, password, req.ip);

    if (!isAdminRole(user.role)) {
      // Same generic message as a wrong password — never confirm whether an
      // email belongs to a non-admin account.
      await writeAudit(user.id, "admin.login.rejected_non_admin", { ip: req.ip });
      throw unauthorized("Invalid email or password");
    }

    const code = genCode();
    const challenge = await prisma.adminLoginChallenge.create({
      data: { userId: user.id, codeHash: hashToken(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });

    try {
      await getEmailProvider().sendAdminLoginCode(user.email, code);
    } catch (err) {
      console.error("Failed to send admin login code:", err); // eslint-disable-line no-console
      throw badRequest("Couldn't send the login code. Please try again shortly.");
    }

    await writeAudit(user.id, "admin.login.code_sent", { ip: req.ip });
    res.json({ challengeId: challenge.id, expiresInSec: Math.floor(CODE_TTL_MS / 1000) });
  })
);

// POST /admin/auth/verify { challengeId, code } — step 2. Only this step
// ever issues tokens.
router.post(
  "/verify",
  adminAuthLimiter,
  asyncHandler(async (req, res) => {
    const { challengeId, code } = z.object({ challengeId: z.string().min(1), code: z.string().length(6) }).parse(req.body);
    const challenge = await prisma.adminLoginChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.usedAt) throw unauthorized("This login code is no longer valid — please sign in again");
    if (challenge.expiresAt < new Date()) throw unauthorized("This code has expired — please sign in again");
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) throw locked("Too many attempts — please sign in again");

    if (challenge.codeHash !== hashToken(code)) {
      await prisma.adminLoginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      await writeAudit(challenge.userId, "admin.login.code_failed", { ip: req.ip });
      throw unauthorized("Incorrect code");
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: challenge.userId } });
    if (!isAdminRole(user.role) || user.blockedByAdmin) throw forbidden("Admin access no longer available for this account");

    await prisma.adminLoginChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
    const { accessToken, refreshToken } = await authService.issueAdminTokenPair(user);
    setAdminRefreshCookie(res, refreshToken);
    await writeAudit(user.id, "admin.login.success", { ip: req.ip });

    res.json({ accessToken, user: publicUser(user) });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[ADMIN_COOKIE_NAME];
    if (!refreshToken) throw unauthorized("No admin session");
    const { accessToken, refreshToken: newRefreshToken } = await authService.rotateAdminRefreshToken(refreshToken);
    setAdminRefreshCookie(res, newRefreshToken);
    res.json({ accessToken });
  })
);

router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[ADMIN_COOKIE_NAME];
    if (refreshToken) await authService.revokeRefreshToken(refreshToken);
    clearAdminRefreshCookie(res);
    res.status(204).send();
  })
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (!isAdminRole(user.role)) throw forbidden("Admin access required");
    res.json({ user: publicUser(user) });
  })
);

module.exports = router;
