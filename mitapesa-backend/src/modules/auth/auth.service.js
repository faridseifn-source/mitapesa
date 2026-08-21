const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("../../lib/prisma");
const env = require("../../lib/env");
const { signAccessToken, signRefreshToken, hashToken, verifyRefreshToken } = require("../../lib/jwt");
const { conflict, unauthorized, locked, badRequest, forbidden } = require("../../lib/errors");
const { getCardIssuingProvider } = require("../../services/card-issuing");
const { getEmailProvider } = require("../../services/email");
const { writeAudit } = require("../../lib/audit");
const { isAdminRole } = require("../../lib/adminRoles");
const { getSetting } = require("../../lib/settings");

async function registerUser({ firstName, lastName, email, phone, password, phoneVerifyToken, emailVerifyToken }) {
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) throw conflict("An account with this email or phone already exists");

  let phoneRecord = null;
  let emailRecord = null;
  if (phoneVerifyToken) {
    phoneRecord = await prisma.phoneVerification.findFirst({
      where: { phone, verifyToken: phoneVerifyToken, verified: true, usedAt: null },
    });
    if (!phoneRecord) throw badRequest("Phone number not verified. Please verify your number again.");
  } else if (emailVerifyToken) {
    emailRecord = await prisma.emailVerification.findFirst({
      where: { email, verifyToken: emailVerifyToken, verified: true, usedAt: null },
    });
    if (!emailRecord) throw badRequest("Email not verified. Please verify your email again.");
  } else {
    // Should be unreachable given registerSchema's refine, but the
    // service layer shouldn't rely solely on the route layer's
    // validation holding — an unverified account is a real problem if
    // this were ever called from anywhere else.
    throw badRequest("Phone or email verification is required.");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { firstName, lastName, email, phone, passwordHash },
    });

    // Every user gets a personal wallet on signup.
    await tx.wallet.create({
      data: {
        type: "PERSONAL",
        members: { create: { userId: created.id, role: "owner" } },
      },
    });

    if (phoneRecord) await tx.phoneVerification.update({ where: { id: phoneRecord.id }, data: { usedAt: new Date() } });
    if (emailRecord) await tx.emailVerification.update({ where: { id: emailRecord.id }, data: { usedAt: new Date() } });

    return created;
  });

  // Issue the prepaid card via the card-issuing provider (mock today) —
  // unless the Pay module is currently off (banking partner connection
  // still pending), in which case no card is created at all. It gets
  // provisioned lazily the first time this customer actually needs one,
  // once an admin switches the module back on — see settings.js's
  // pay_module_enabled comment and cardHelpers.js's myCard().
  const payModuleEnabled = (await getSetting("pay_module_enabled")) !== "false";
  if (payModuleEnabled) {
    const cardIssuing = getCardIssuingProvider();
    await cardIssuing.issueCard({ userId: user.id, holderName: `${firstName} ${lastName}`.toUpperCase() });
  }

  return user;
}

// Creates a genuine staff admin account — deliberately NOT registerUser: no
// wallet, no card, none of the customer-onboarding side effects. This is
// what makes it safe to fully delete a staff account later (no financial
// data ever gets attached to it in the first place), unlike promoting an
// existing customer to an admin role, which keeps their real account intact.
const STAFF_SETUP_TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours — longer than a normal password reset, since a new hire may not check email right away
async function createStaffAdmin({ firstName, lastName, email, phone, role }, ip) {
  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing) throw conflict("An account with this email or phone already exists");

  // No usable password is set at creation — only the emailed setup link can
  // ever establish one, so the account can't be logged into before that.
  const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  const user = await prisma.user.create({ data: { firstName, lastName, email, phone, passwordHash: randomPasswordHash, role } });

  const code = generateResetCode();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(normalizeCode(code)), expiresAt: new Date(Date.now() + STAFF_SETUP_TOKEN_TTL_MS) },
  });
  await writeAudit(user.id, "admin.staff.created", { ip, role });
  await getEmailProvider().sendPasswordReset(email, code); // reuses the existing "set your password" flow/screen — same UI, this is just the first-time case

  return user;
}

async function authenticate(email, password, ip) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw unauthorized("Invalid email or password");

  if (user.blockedByAdmin) {
    await writeAudit(user.id, "auth.login.blocked_account", { ip });
    throw forbidden("This account has been blocked. Contact support for assistance.");
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw locked(`Too many failed attempts. Try again in ${minutesLeft} minute(s).`);
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const lockingNow = attempts >= env.security.maxLoginAttempts;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: lockingNow ? new Date(Date.now() + env.security.loginLockoutMs) : null,
      },
    });
    await writeAudit(user.id, lockingNow ? "auth.login.locked" : "auth.login.failed", { ip, attempts });
    if (lockingNow) throw locked(`Too many failed attempts. Try again in ${Math.ceil(env.security.loginLockoutMs / 60000)} minute(s).`);
    throw unauthorized("Invalid email or password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await writeAudit(user.id, "auth.login.success", { ip });
  return user;
}

async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.jwt.refreshMaxAgeMs),
    },
  });

  return { accessToken, refreshToken };
}

// Same mechanism as issueTokenPair, deliberately much shorter-lived — see
// the comment on env.jwt.adminAccessExpiresIn for why.
async function issueAdminTokenPair(user) {
  const expiresInSec = Math.floor(env.jwt.adminRefreshMaxAgeMs / 1000);
  const accessToken = signAccessToken(user, env.jwt.adminAccessExpiresIn);
  const refreshToken = signRefreshToken(user, expiresInSec);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + env.jwt.adminRefreshMaxAgeMs),
    },
  });

  return { accessToken, refreshToken };
}

async function rotateRefreshToken(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized("Invalid or expired refresh token");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { userId: payload.sub, tokenHash, revoked: false },
  });
  if (!stored || stored.expiresAt < new Date()) throw unauthorized("Refresh token no longer valid");

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
  return issueTokenPair(user);
}

// Same rotation logic, but re-issues via issueAdminTokenPair so a refreshed
// admin session stays short-lived instead of silently upgrading to the
// 30-day customer token lifetime.
async function rotateAdminRefreshToken(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized("Invalid or expired admin session");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findFirst({
    where: { userId: payload.sub, tokenHash, revoked: false },
  });
  if (!stored || stored.expiresAt < new Date()) throw unauthorized("Admin session no longer valid");

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
  if (!isAdminRole(user.role)) throw unauthorized("Admin session no longer valid");
  return issueAdminTokenPair(user);
}

async function revokeRefreshToken(refreshToken) {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revoked: true } });
}

// Used whenever a password changes — every other device's session should
// end, since a stolen refresh token would otherwise survive a password reset.
async function revokeAllRefreshTokens(userId) {
  await prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } });
}

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Formatted like "A1B2-C3D4-E5F6" — short enough to type or paste from an
// email by hand, while still carrying enough entropy (12 chars from a
// 36-symbol alphabet = ~62 bits) to be safe given the 30-min expiry,
// single-use enforcement, and rate limiting already in place.
function generateResetCode() {
  const raw = crypto.randomBytes(6).toString("hex").toUpperCase(); // 12 hex chars
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}
const normalizeCode = (code) => code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

async function requestPasswordReset(email, ip) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Deliberately don't reveal whether the email exists — same response either way.
  if (!user) return;

  const code = generateResetCode();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(normalizeCode(code)), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  await writeAudit(user.id, "auth.password_reset.requested", { ip });
  await getEmailProvider().sendPasswordReset(email, code);
}

async function resetPassword(token, newPassword, ip) {
  const tokenHash = hashToken(normalizeCode(token));
  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash, usedAt: null } });
  if (!record || record.expiresAt < new Date()) throw badRequest("This reset code is invalid or has expired.");

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);
  await revokeAllRefreshTokens(record.userId);
  await writeAudit(record.userId, "auth.password_reset.completed", { ip });
}

async function changePassword(userId, currentPassword, newPassword, ip) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    await writeAudit(userId, "auth.password_change.failed", { ip });
    throw unauthorized("Current password is incorrect");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await revokeAllRefreshTokens(userId);
  await writeAudit(userId, "auth.password_change.success", { ip });
}

// Re-verifies the CURRENT session's own password — used for step-up
// confirmation (e.g. an unusual-value QR payment), not for logging in.
// Deliberately lighter than authenticate(): the session is already
// established via a valid access token, so this only needs to confirm
// "is this really you," not run the full login/lockout machinery again.
async function verifyPassword(userId, password, ip) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await bcrypt.compare(password, user.passwordHash);
  await writeAudit(userId, ok ? "auth.stepup_verify.success" : "auth.stepup_verify.failed", { ip });
  if (!ok) throw unauthorized("Incorrect password");
  return true;
}

module.exports = {
  registerUser,
  createStaffAdmin,
  authenticate,
  issueTokenPair,
  issueAdminTokenPair,
  rotateRefreshToken,
  rotateAdminRefreshToken,
  revokeRefreshToken,
  requestPasswordReset,
  resetPassword,
  changePassword,
  verifyPassword,
};
