const { Prisma } = require("@prisma/client");
const prisma = require("./prisma");
const { badRequest, conflict, notFound } = require("./errors");
const { writeAudit } = require("./audit");
const { getSetting } = require("./settings");
const { getEmailProvider } = require("../services/email");

/**
 * The archive behind "delete my account" (see lib/accountDeletion.js).
 *
 * Deleting an account removes the customer's personal data from the live
 * app straight away. What this module holds is the one remaining copy — a
 * single JSON snapshot per deleted account — kept for a window set by the
 * account_archive_retention_days setting so that an admin can look at it,
 * export it, or restore the account (a customer who changes their mind, a
 * dispute, a legal request) and then permanently erased.
 *
 * Why a time-limited archive and not a permanent one: Apple's rule is that
 * offering only to deactivate an account is insufficient — deletion has to
 * remove the personal data not legally required to be kept, and the app has
 * to tell people how long that takes. A bounded, disclosed window is how a
 * restorable archive and that rule coexist. Money records (card/QR ledgers,
 * KYC, fees, audit) are NOT in this archive; they are never deleted and stay
 * in their own tables — see RETAINED_FOR_COMPLIANCE in accountDeletion.js.
 */

const SNAPSHOT_VERSION = 1;
// Support tickets that are just conversation. Disputes and fraud reports are
// about money and are kept in place instead (see accountDeletion.js).
const GENERAL_TICKET_CATEGORIES = ["inquiry", "complaint"];
// What a deleted member's name on surviving shared-wallet entries becomes,
// and what restore looks for when putting their name back.
const FORMER_MEMBER = "Former member";

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// JSON-safe deep copy: Dates become ISO strings and Decimals become strings,
// which Prisma accepts back unchanged when the rows are re-created.
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Days to keep an archive, or null for "until an admin erases it by hand".
 * A missing or unreadable setting falls back to 90 rather than to forever —
 * the safe direction for personal data.
 */
async function getRetentionDays() {
  const n = parseInt(await getSetting("account_archive_retention_days"), 10);
  if (Number.isNaN(n)) return 90;
  return n > 0 ? n : null;
}

/**
 * Reads everything about this customer that deletion is about to remove.
 * Credentials that only mean something on a device — refresh tokens, push
 * tokens, passkeys — are deliberately not archived: restoring them would
 * mean trusting credentials that were revoked on purpose.
 */
async function collectSnapshot(user, memberships) {
  const userId = user.id;
  // A wallet nobody else belongs to goes away with the account; one that
  // other members still use stays, so its transactions are not archived.
  const removedWalletIds = memberships.filter((m) => m.wallet.members.every((x) => x.userId === userId)).map((m) => m.walletId);

  const [categories, subcategories, budgets, budgetLimitHistory, seenTips, supportTickets, removedWallets, transactions, loggedElsewhere] = await Promise.all([
    prisma.category.findMany({ where: { userId } }),
    prisma.subcategory.findMany({ where: { category: { userId } } }),
    prisma.budget.findMany({ where: { userId } }),
    prisma.budgetLimitHistory.findMany({ where: { userId } }),
    prisma.userSeenTip.findMany({ where: { userId } }),
    prisma.supportTicket.findMany({ where: { userId, category: { in: GENERAL_TICKET_CATEGORIES } } }),
    prisma.wallet.findMany({ where: { id: { in: removedWalletIds } } }),
    prisma.transaction.findMany({ where: { walletId: { in: removedWalletIds } } }),
    prisma.transaction.count({ where: { loggedByUserId: userId, walletId: { notIn: removedWalletIds } } }),
  ]);

  return plain({
    version: SNAPSHOT_VERSION,
    takenAt: new Date(),
    profile: user,
    categories,
    subcategories,
    budgets,
    budgetLimitHistory,
    seenTips,
    supportTickets,
    memberships: memberships.map((m) => ({
      id: m.id,
      walletId: m.walletId,
      userId: m.userId,
      role: m.role,
      walletType: m.wallet.type,
      walletName: m.wallet.name,
      removedWithAccount: removedWalletIds.includes(m.walletId),
    })),
    removedWallets,
    transactions,
    // Entries this person logged in wallets that carry on. Not copied (they
    // stay in place, renamed to "Former member"); counted so an admin can see.
    loggedElsewhere,
  });
}

/**
 * Admin restores a deleted account from its archive. Everything is re-created
 * in one transaction, so a failure part-way leaves the account exactly as it
 * was — still deleted, archive untouched.
 *
 * What is NOT brought back, on purpose: cards stay locked (a restored account
 * must not silently resume spending — the customer or an admin unfreezes
 * deliberately), terminated add-on cards stay terminated, and devices,
 * sessions and passkeys are gone (the customer signs in again and re-enrolls).
 */
async function restoreArchive({ archiveId, adminUserId, note, ip }) {
  const archive = await prisma.accountArchive.findUnique({ where: { id: archiveId } });
  if (!archive) throw notFound("Archive not found");
  if (archive.status !== "archived" || !archive.data) {
    throw badRequest(`This archive is ${archive.status}, so there is nothing left to restore.`);
  }
  const d = archive.data;
  const user = await prisma.user.findUnique({ where: { id: archive.userId } });
  if (!user || !user.deletedAt) throw badRequest("This account is not in a deleted state.");

  // The original email or phone may have been registered by someone since —
  // the deleted account released them on purpose.
  const clash = await prisma.user.findFirst({
    where: { id: { not: user.id }, OR: [{ email: d.profile.email }, { phone: d.profile.phone }] },
    select: { id: true },
  });
  if (clash) throw conflict("The original email or phone number now belongs to another account, so this account can't be restored as it was.");

  await prisma.$transaction(
    async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          firstName: d.profile.firstName,
          middleName: d.profile.middleName,
          lastName: d.profile.lastName,
          email: d.profile.email,
          phone: d.profile.phone,
          passwordHash: d.profile.passwordHash,
          avatarUrl: d.profile.avatarUrl,
          language: d.profile.language,
          preferredCurrency: d.profile.preferredCurrency,
          termsAcceptedIp: d.profile.termsAcceptedIp,
          failedLoginAttempts: 0,
          lockedUntil: null,
          deletedAt: null,
        },
      });

      // Order matters: categories before anything that references them.
      // skipDuplicates because a category still used by a surviving shared
      // wallet was never removed in the first place.
      await tx.category.createMany({ data: d.categories, skipDuplicates: true });
      await tx.subcategory.createMany({ data: d.subcategories, skipDuplicates: true });
      await tx.budget.createMany({ data: d.budgets, skipDuplicates: true });
      await tx.budgetLimitHistory.createMany({ data: d.budgetLimitHistory, skipDuplicates: true });
      await tx.wallet.createMany({ data: d.removedWallets, skipDuplicates: true });

      // Memberships only where the wallet still exists — a shared wallet the
      // other members have since deleted has nothing to rejoin.
      const existing = await tx.wallet.findMany({ where: { id: { in: d.memberships.map((m) => m.walletId) } }, select: { id: true } });
      const existingIds = new Set(existing.map((w) => w.id));
      await tx.walletMember.createMany({
        data: d.memberships.filter((m) => existingIds.has(m.walletId)).map((m) => ({ id: m.id, walletId: m.walletId, userId: m.userId, role: m.role })),
        skipDuplicates: true,
      });

      for (const batch of chunk(d.transactions, 500)) {
        await tx.transaction.createMany({ data: batch, skipDuplicates: true });
      }
      // Put the name back on entries in wallets that carried on. The app
      // stores just the first name here (see transactions.routes.js).
      await tx.transaction.updateMany({ where: { loggedByUserId: user.id, loggedByName: FORMER_MEMBER }, data: { loggedByName: d.profile.firstName } });

      await tx.userSeenTip.createMany({ data: d.seenTips, skipDuplicates: true });
      await tx.supportTicket.createMany({ data: d.supportTickets, skipDuplicates: true });

      // The data is live again; keeping a second copy would be a second place
      // to protect. The row stays, with only its non-personal figures.
      await tx.accountArchive.update({
        where: { id: archive.id },
        data: { status: "restored", restoredAt: new Date(), restoredByUserId: adminUserId, data: Prisma.DbNull, fullName: null, email: null, phone: null },
      });
    },
    { timeout: 60000 }
  );

  await writeAudit(adminUserId, "admin.account_restored", { ip, targetUserId: user.id, archiveId, note: note || null });

  // Always tell the owner. Best-effort: the restore has already happened.
  try {
    await getEmailProvider().sendAccountRestored(d.profile.email);
  } catch (err) {
    console.error("Account-restored notice email failed:", err.message); // eslint-disable-line no-console
  }

  return { restored: true, userId: user.id };
}

/**
 * Permanently erases an archive's personal data. Irreversible by design: the
 * snapshot and the name/email/phone beside it are removed; only the
 * non-personal figures (counts, dates, reason) remain, so the statistics
 * outlive the data. `adminUserId` is null when the retention job calls this.
 */
async function purgeArchive({ archiveId, adminUserId, ip }) {
  const archive = await prisma.accountArchive.findUnique({ where: { id: archiveId }, select: { id: true, status: true, userId: true } });
  if (!archive) throw notFound("Archive not found");
  if (archive.status === "purged") throw badRequest("This archive has already been permanently erased.");

  await prisma.accountArchive.update({
    where: { id: archiveId },
    data: { status: "purged", purgedAt: new Date(), purgedByUserId: adminUserId, data: Prisma.DbNull, fullName: null, email: null, phone: null },
  });
  await writeAudit(adminUserId, adminUserId ? "admin.archive_purged" : "system.archive_purged", { ip, targetUserId: archive.userId, archiveId });
  return { purged: true };
}

/** The retention job: erases every archive whose window has run out. */
async function purgeExpiredArchives() {
  const due = await prisma.accountArchive.findMany({ where: { status: "archived", purgeAfter: { lte: new Date() } }, select: { id: true } });
  let purged = 0;
  for (const { id } of due) {
    try {
      await purgeArchive({ archiveId: id, adminUserId: null });
      purged += 1;
    } catch (err) {
      console.error(`Retention purge failed for archive ${id}:`, err.message); // eslint-disable-line no-console
    }
  }
  return { checked: due.length, purged };
}

module.exports = { collectSnapshot, restoreArchive, purgeArchive, purgeExpiredArchives, getRetentionDays, GENERAL_TICKET_CATEGORIES, FORMER_MEMBER };
