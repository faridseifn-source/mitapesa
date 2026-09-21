const { Router } = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const env = require("../../lib/env");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { badRequest, locked } = require("../../lib/errors");
const { getKycProvider } = require("../../services/kyc");
const { writeAudit } = require("../../lib/audit");
const { encryptField } = require("../../lib/crypto");

const router = Router();
router.use(requireAuth);

// KYC endpoints guard identity verification — same brute-force concern as auth.
const kycLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
router.use(kycLimiter);

const hashNida = (nida) => crypto.createHash("sha256").update(nida).digest("hex");

// GET /kyc/status
router.get(
  "/status",
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    res.json({ status: user.kycStatus });
  })
);

// POST /kyc/lookup { nidaNumber }
router.post(
  "/lookup",
  asyncHandler(async (req, res) => {
    const { nidaNumber } = z.object({ nidaNumber: z.string().min(8) }).parse(req.body);
    const provider = getKycProvider();
    const record = await provider.lookupIdentity(nidaNumber);

    // Starting a fresh lookup resets the attempt counter — this is the only way
    // to escape a lockout, and it costs going through identity lookup again.
    await prisma.kycVerification.upsert({
      where: { userId: req.userId },
      update: { nidaNumberHash: hashNida(nidaNumber), sessionRef: record.refId, status: "PENDING", method: null, attempts: 0, verifiedAt: null },
      create: { userId: req.userId, nidaNumberHash: hashNida(nidaNumber), sessionRef: record.refId, status: "PENDING" },
    });
    await writeAudit(req.userId, "kyc.lookup", { ip: req.ip });

    // Never leak the sessionRef's internal reuse — client just needs to know a session is active.
    res.json({ maskedName: record.maskedName, maskedPhone: record.maskedPhone });
  })
);

async function getActiveSession(userId) {
  const kyc = await prisma.kycVerification.findUnique({ where: { userId } });
  if (!kyc || !kyc.sessionRef || kyc.status === "VERIFIED") throw badRequest("No active KYC session — call /kyc/lookup first");
  if (kyc.attempts >= env.security.maxKycAttempts) {
    throw locked("Too many failed verification attempts. Start a new lookup to try again.");
  }
  return kyc;
}

// Requirement 2 (automatic NIDA data sync): called right after a KYC
// verification succeeds. Retrieves the full record from the provider,
// encrypts every field, and upserts it into KycNidaProfile. Never allowed
// to fail the verification response itself — sync failures are recorded
// (syncStatus/syncError/lastAttemptAt) for later retry/troubleshooting
// rather than surfaced to the customer, since verification already succeeded.
async function syncNidaProfile(userId, refId) {
  const provider = getKycProvider();
  try {
    const profile = await provider.getFullProfile(refId);
    const encrypted = {
      firstNameEnc: encryptField(profile.firstName),
      middleNameEnc: encryptField(profile.middleName),
      lastNameEnc: encryptField(profile.lastName),
      sexEnc: encryptField(profile.sex),
      dateOfBirthEnc: encryptField(profile.dateOfBirth),
      maritalStatusEnc: encryptField(profile.maritalStatus),
      placeOfBirthEnc: encryptField(profile.placeOfBirth),
      citizenshipTypeEnc: encryptField(profile.citizenshipType),
      nidaPhoneEnc: encryptField(profile.nidaPhone),
      regionEnc: encryptField(profile.region),
      districtEnc: encryptField(profile.district),
      wardEnc: encryptField(profile.ward),
      villageOrStreetEnc: encryptField(profile.villageOrStreet),
      photoEnc: encryptField(profile.photoUrl),
    };
    await prisma.kycNidaProfile.upsert({
      where: { userId },
      update: { ...encrypted, sourceProvider: env.providers.kyc, sourceRef: profile.sourceRef, syncStatus: "synced", syncError: null, syncedAt: new Date(), lastAttemptAt: new Date() },
      create: { userId, ...encrypted, sourceProvider: env.providers.kyc, sourceRef: profile.sourceRef, syncStatus: "synced", syncedAt: new Date(), lastAttemptAt: new Date() },
    });
    // Audit records which fields were synced and when — never the values themselves.
    await writeAudit(userId, "kyc.nida_profile.synced", { fields: Object.keys(profile), source: env.providers.kyc });
  } catch (err) {
    await prisma.kycNidaProfile.upsert({
      where: { userId },
      update: { syncStatus: "failed", syncError: err.message, lastAttemptAt: new Date() },
      create: { userId, sourceProvider: env.providers.kyc, syncStatus: "failed", syncError: err.message, lastAttemptAt: new Date() },
    });
    await writeAudit(userId, "kyc.nida_profile.sync_failed", { error: err.message, source: env.providers.kyc });
    console.error(`NIDA profile sync failed for user ${userId}:`, err); // eslint-disable-line no-console
  }
}

// POST /kyc/otp/send
router.post(
  "/otp/send",
  asyncHandler(async (req, res) => {
    const kyc = await getActiveSession(req.userId);
    const provider = getKycProvider();
    const result = await provider.sendOtp(kyc.sessionRef);
    res.json(result);
  })
);

// POST /kyc/otp/verify { code }
router.post(
  "/otp/verify",
  asyncHandler(async (req, res) => {
    const { code } = z.object({ code: z.string().length(6) }).parse(req.body);
    const kyc = await getActiveSession(req.userId);
    const provider = getKycProvider();
    const ok = await provider.verifyOtp(kyc.sessionRef, code);

    if (ok) {
      await prisma.$transaction([
        prisma.kycVerification.update({ where: { id: kyc.id }, data: { status: "VERIFIED", method: "otp", verifiedAt: new Date() } }),
        prisma.user.update({ where: { id: req.userId }, data: { kycStatus: "VERIFIED" } }),
      ]);
      await writeAudit(req.userId, "kyc.otp.verified", { ip: req.ip });
      await syncNidaProfile(req.userId, kyc.sessionRef);
    } else {
      const attempts = kyc.attempts + 1;
      await prisma.kycVerification.update({ where: { id: kyc.id }, data: { attempts } });
      await writeAudit(req.userId, "kyc.otp.failed", { ip: req.ip, attempts });
    }
    res.json({ verified: ok });
  })
);

// GET /kyc/kbv/questions — fallback when the user can't access the registered number
router.get(
  "/kbv/questions",
  asyncHandler(async (req, res) => {
    const kyc = await getActiveSession(req.userId);
    const provider = getKycProvider();
    const questions = await provider.getKbvQuestions(kyc.sessionRef);
    res.json({ questions });
  })
);

// POST /kyc/kbv/verify { answers: { [questionId]: option } }
router.post(
  "/kbv/verify",
  asyncHandler(async (req, res) => {
    const { answers } = z.object({ answers: z.record(z.string()) }).parse(req.body);
    const kyc = await getActiveSession(req.userId);
    const provider = getKycProvider();
    const { passed, correctCount } = await provider.verifyKbv(kyc.sessionRef, answers);

    if (passed) {
      await prisma.$transaction([
        prisma.kycVerification.update({ where: { id: kyc.id }, data: { status: "VERIFIED", method: "kbv", verifiedAt: new Date() } }),
        prisma.user.update({ where: { id: req.userId }, data: { kycStatus: "VERIFIED" } }),
      ]);
      await writeAudit(req.userId, "kyc.kbv.verified", { ip: req.ip, correctCount });
      await syncNidaProfile(req.userId, kyc.sessionRef);
    } else {
      const attempts = kyc.attempts + 1;
      await prisma.kycVerification.update({ where: { id: kyc.id }, data: { status: "FAILED", attempts } });
      await writeAudit(req.userId, "kyc.kbv.failed", { ip: req.ip, attempts, correctCount });
    }
    res.json({ verified: passed, correctCount });
  })
);

module.exports = router;
