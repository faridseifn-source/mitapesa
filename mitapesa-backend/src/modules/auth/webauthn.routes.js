const { Router } = require("express");
const { z } = require("zod");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const { isoUint8Array } = require("@simplewebauthn/server/helpers");
const prisma = require("../../lib/prisma");
const env = require("../../lib/env");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { unauthorized, badRequest, notFound, forbidden } = require("../../lib/errors");
const { getSetting } = require("../../lib/settings");
const { writeAudit } = require("../../lib/audit");
const authService = require("./auth.service");
const { setRefreshCookie } = require("../../lib/cookies");
const { publicUser } = require("../../lib/serialize");

const router = Router();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function assertBiometricEnabled() {
  const enabled = (await getSetting("biometric_login_enabled")) !== "false";
  if (!enabled) throw forbidden("Biometric login is currently turned off for this app");
}

// Credential IDs move between two shapes depending on library version/call
// site (base64url string vs raw bytes) — normalize to a base64url string
// for storage and comparison, since that's DB/JSON friendly either way.
function toBase64Url(value) {
  if (typeof value === "string") return value;
  return Buffer.from(value).toString("base64url");
}

/* ------------------------- registration (enroll a device) ------------------------- */
// Requires an existing session — this enrolls a NEW authenticator for an
// already-logged-in user (e.g. right after a normal password login, from a
// "Set up Face ID" prompt), not a way to create an account.

router.post(
  "/register/options",
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertBiometricEnabled();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    const existing = await prisma.webAuthnCredential.findMany({ where: { userId: user.id } });

    const options = await generateRegistrationOptions({
      rpName: env.webauthn.rpName,
      rpID: env.webauthn.rpID,
      userID: isoUint8Array.fromUTF8String(user.id),
      userName: user.email,
      userDisplayName: `${user.firstName} ${user.lastName}`,
      attestationType: "none",
      excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
    });

    await prisma.webAuthnChallenge.deleteMany({ where: { userId: user.id, type: "registration" } });
    await prisma.webAuthnChallenge.create({ data: { userId: user.id, challenge: options.challenge, type: "registration", expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } });

    res.json(options);
  })
);

router.post(
  "/register/verify",
  requireAuth,
  asyncHandler(async (req, res) => {
    await assertBiometricEnabled();
    const { response, deviceLabel } = z.object({ response: z.any(), deviceLabel: z.string().max(60).optional() }).parse(req.body);

    const challengeRow = await prisma.webAuthnChallenge.findFirst({ where: { userId: req.userId, type: "registration" }, orderBy: { createdAt: "desc" } });
    if (!challengeRow || challengeRow.expiresAt < new Date()) throw badRequest("This registration attempt expired — please try again");

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: env.corsOrigins,
        expectedRPID: env.webauthn.rpID,
      });
    } catch (err) {
      throw badRequest("Couldn't verify that device — please try again");
    }
    if (!verification.verified || !verification.registrationInfo) throw badRequest("Couldn't verify that device");

    const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
    await prisma.webAuthnCredential.create({
      data: {
        userId: req.userId,
        credentialId: toBase64Url(credentialID),
        publicKey: toBase64Url(credentialPublicKey),
        counter: BigInt(counter || 0),
        deviceLabel: deviceLabel || "New device",
        transports: response?.response?.transports ? JSON.stringify(response.response.transports) : null,
      },
    });
    await prisma.webAuthnChallenge.delete({ where: { id: challengeRow.id } });
    await writeAudit(req.userId, "webauthn.registered", { ip: req.ip, deviceLabel });

    res.json({ success: true });
  })
);

router.get(
  "/credentials",
  requireAuth,
  asyncHandler(async (req, res) => {
    const creds = await prisma.webAuthnCredential.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
    res.json({ credentials: creds.map((c) => ({ id: c.id, deviceLabel: c.deviceLabel, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt })) });
  })
);

router.delete(
  "/credentials/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const cred = await prisma.webAuthnCredential.findUnique({ where: { id: req.params.id } });
    if (!cred || cred.userId !== req.userId) throw notFound("Device not found");
    await prisma.webAuthnCredential.delete({ where: { id: cred.id } });
    await writeAudit(req.userId, "webauthn.removed", { ip: req.ip, deviceLabel: cred.deviceLabel });
    res.status(204).send();
  })
);

/* --------------------------- authentication (login) --------------------------- */

router.post(
  "/login/options",
  asyncHandler(async (req, res) => {
    await assertBiometricEnabled();
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    const creds = user ? await prisma.webAuthnCredential.findMany({ where: { userId: user.id } }) : [];
    if (!user || !creds.length) throw notFound("No biometric device is set up for that account yet");
    if (user.blockedByAdmin) throw forbidden("This account has been blocked. Contact support for assistance.");

    const options = await generateAuthenticationOptions({
      rpID: env.webauthn.rpID,
      allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      userVerification: "required",
    });

    await prisma.webAuthnChallenge.deleteMany({ where: { userId: user.id, type: "authentication" } });
    await prisma.webAuthnChallenge.create({ data: { userId: user.id, challenge: options.challenge, type: "authentication", expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } });

    res.json({ options, userId: user.id });
  })
);

router.post(
  "/login/verify",
  asyncHandler(async (req, res) => {
    await assertBiometricEnabled();
    const { userId, response } = z.object({ userId: z.string().min(1), response: z.any() }).parse(req.body);

    const challengeRow = await prisma.webAuthnChallenge.findFirst({ where: { userId, type: "authentication" }, orderBy: { createdAt: "desc" } });
    if (!challengeRow || challengeRow.expiresAt < new Date()) throw unauthorized("This login attempt expired — please try again");

    const credentialId = toBase64Url(response?.id || response?.rawId);
    const cred = await prisma.webAuthnCredential.findUnique({ where: { credentialId } });
    if (!cred || cred.userId !== userId) throw unauthorized("Unrecognized device — try logging in with your password instead");

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized("Account not found");
    if (user.blockedByAdmin) throw forbidden("This account has been blocked. Contact support for assistance.");

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: env.corsOrigins,
        expectedRPID: env.webauthn.rpID,
        authenticator: {
          credentialID: cred.credentialId,
          credentialPublicKey: Buffer.from(cred.publicKey, "base64url"),
          counter: Number(cred.counter),
        },
      });
    } catch (err) {
      throw unauthorized("Couldn't verify — please try again or use your password");
    }
    if (!verification.verified) throw unauthorized("Couldn't verify — please try again or use your password");

    await prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: { counter: BigInt(verification.authenticationInfo?.newCounter ?? 0), lastUsedAt: new Date() },
    });
    await prisma.webAuthnChallenge.delete({ where: { id: challengeRow.id } });
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });

    const { accessToken, refreshToken } = await authService.issueTokenPair(user);
    setRefreshCookie(res, refreshToken);
    await writeAudit(user.id, "auth.login.success", { ip: req.ip, method: "webauthn" });

    res.json({ accessToken, user: publicUser(user) });
  })
);

module.exports = router;
