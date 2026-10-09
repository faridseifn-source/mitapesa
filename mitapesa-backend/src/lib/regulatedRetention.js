const crypto = require("crypto");
const prisma = require("./prisma");
const { badRequest, notFound } = require("./errors");
const { writeAudit } = require("./audit");
const { getSetting } = require("./settings");

/**
 * Regulated-records retention: what the business must keep, and keep findable,
 * after a customer who has had a prepaid card, an identity check or payments
 * deletes their account. See the RegulatedRetention model in schema.prisma for
 * the design; accountDeletion.js creates the register row at closure.
 *
 * Deliberate policy, from the business: the period is 10 years (an admin
 * setting, so a change in the law is a settings change), and when it ends
 * NOTHING is erased automatically — keeping the records longer protects the
 * business if law enforcement asks. A record past its period is only flagged;
 * a super admin decides whether to release it, and a legal hold stops that.
 */

// Same one-liner as modules/kyc/kyc.routes.js: it must stay identical so that a
// NIDA number typed into the admin search matches the stored hash.
const hashNida = (nida) => crypto.createHash("sha256").update(String(nida)).digest("hex");

/** Years to keep records after closure, or null for "no end date". Unreadable -> 10, the safe direction. */
async function getRetentionYears() {
  const n = parseInt(await getSetting("regulated_records_retention_years"), 10);
  if (Number.isNaN(n)) return 10;
  return n > 0 ? n : null;
}

function retainUntilFrom(closedAt, years) {
  if (!years) return null;
  const d = new Date(closedAt);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/**
 * The register entry for a customer being closed, or null if they never had a
 * regulated relationship (a PFM-only customer: nothing here is required by law,
 * so their data follows the ordinary archive-then-erase path instead).
 */
function buildRegisterEntry({ user, card, ownedVirtualCards, heldCards, kyc, paymentCount, years, closedAt }) {
  const hadCard = !!card || ownedVirtualCards.length > 0 || heldCards.length > 0;
  const hadKyc = !!kyc;
  const hadPayments = paymentCount > 0;
  if (!hadCard && !hadKyc && !hadPayments) return null;
  const last4s = [card?.last4, ...ownedVirtualCards.map((c) => c.last4), ...heldCards.map((c) => c.last4)].filter(Boolean);
  return {
    userId: user.id,
    fullName: [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" "),
    phone: user.phone,
    email: user.email,
    nidaNumberHash: kyc ? kyc.nidaNumberHash : null,
    cardLast4: last4s.length ? [...new Set(last4s)].join(",") : null,
    hadCard,
    hadKyc,
    hadPayments,
    accountCreatedAt: user.createdAt,
    closedAt,
    retainUntil: retainUntilFrom(closedAt, years),
  };
}

/** where / state helpers shared by the list, the statistics and the UI. */
function retentionState(row, now = new Date()) {
  if (row.status === "released") return "released";
  if (row.status === "reopened") return "reopened";
  if (row.legalHold) return "hold";
  if (row.retainUntil && new Date(row.retainUntil) <= now) return "ended";
  return "retained";
}

async function setLegalHold({ id, hold, reason, adminUserId, ip }) {
  const row = await prisma.regulatedRetention.findUnique({ where: { id }, select: { id: true, userId: true, status: true, legalHold: true } });
  if (!row) throw notFound("Record not found");
  if (row.status !== "retained") throw badRequest(`This record is ${row.status}, so a legal hold doesn't apply.`);
  if (hold && !reason) throw badRequest("A reason is required to place a legal hold.");
  await prisma.regulatedRetention.update({
    where: { id },
    data: hold
      ? { legalHold: true, holdReason: reason, holdSetAt: new Date(), holdSetByUserId: adminUserId }
      : { legalHold: false, holdReason: null, holdSetAt: null, holdSetByUserId: null },
  });
  await writeAudit(adminUserId, hold ? "admin.regulated_hold_placed" : "admin.regulated_hold_lifted", { ip, targetUserId: row.userId, retentionId: id, reason: reason || null });
  return { legalHold: hold };
}

/**
 * Releases a record whose retention period has ended: the person's identifying
 * details are erased (the register entry, the stored NIDA profile, the NIDA
 * hash, the cardholder name and add-on card labels). The financial ledgers
 * themselves — amounts, dates, references — are NOT touched: without the
 * identity attached they are ordinary accounting records. Never automatic.
 */
async function releaseRecords({ id, adminUserId, note, ip }) {
  const row = await prisma.regulatedRetention.findUnique({ where: { id } });
  if (!row) throw notFound("Record not found");
  if (row.status !== "retained") throw badRequest(`This record is already ${row.status}.`);
  if (row.legalHold) throw badRequest("This record is under a legal hold. Lift the hold first.");
  if (!row.retainUntil) throw badRequest("This record has no retention end date, so it can't be released. Set a retention period on the Settings page, then use Recalculate.");
  if (new Date(row.retainUntil) > new Date()) throw badRequest(`The retention period for this record runs until ${new Date(row.retainUntil).toISOString().slice(0, 10)}.`);

  await prisma.$transaction(
    async (tx) => {
      await tx.kycNidaProfile.deleteMany({ where: { userId: row.userId } });
      await tx.kycVerification.updateMany({ where: { userId: row.userId }, data: { nidaNumberHash: "released" } });
      await tx.card.updateMany({ where: { userId: row.userId }, data: { holderName: "Deleted user" } });
      await tx.virtualCard.updateMany({ where: { OR: [{ ownerId: row.userId }, { holderId: row.userId }] }, data: { label: null } });
      await tx.regulatedRetention.update({
        where: { id },
        data: { status: "released", releasedAt: new Date(), releasedByUserId: adminUserId, releaseNote: note, fullName: null, phone: null, email: null, nidaNumberHash: null, cardLast4: null },
      });
    },
    { timeout: 30000 }
  );
  await writeAudit(adminUserId, "admin.regulated_released", { ip, targetUserId: row.userId, retentionId: id, note });
  return { released: true };
}

/**
 * After the retention setting changes (say the law moves from 10 years to 7),
 * existing records keep the date they were given at closure until this is run.
 * Released records are left alone.
 */
async function recalculateEndDates({ adminUserId, ip }) {
  const years = await getRetentionYears();
  const rows = await prisma.regulatedRetention.findMany({ where: { status: "retained" }, select: { id: true, closedAt: true } });
  for (const r of rows) await prisma.regulatedRetention.update({ where: { id: r.id }, data: { retainUntil: retainUntilFrom(r.closedAt, years) } });
  await writeAudit(adminUserId, "admin.regulated_recalculated", { ip, years, records: rows.length });
  return { updated: rows.length, years };
}

module.exports = { hashNida, getRetentionYears, retainUntilFrom, buildRegisterEntry, retentionState, setLegalHold, releaseRecords, recalculateEndDates };
