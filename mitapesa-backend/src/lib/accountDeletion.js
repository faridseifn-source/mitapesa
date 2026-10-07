const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const prisma = require("./prisma");
const { badRequest, forbidden, unauthorized } = require("./errors");
const { writeAudit } = require("./audit");
const { isAdminRole } = require("./adminRoles");
const { getEmailProvider } = require("../services/email");
const { getCardIssuingProvider } = require("../services/card-issuing");
const { collectSnapshot, getRetentionDays, GENERAL_TICKET_CATEGORIES, FORMER_MEMBER } = require("./accountArchive");

/**
 * A customer deleting their own account from inside the app (App Store
 * Guideline 5.1.1(v) requires this, and requires it to be real deletion,
 * not just deactivation).
 *
 * This is deliberately NOT `prisma.user.delete()`. Nearly every table in
 * this schema cascades from User, so a plain delete would silently erase
 * records that must outlive the account — card ledgers, QR payments, KYC,
 * AI-credit purchases (which feed the Fee Revenue report) and AI usage
 * logs (which feed the monthly spend ceiling) — while leaving behind the
 * one thing that should go: a personal wallet's transactions, which hang
 * off Wallet and not User, so they would simply be orphaned.
 *
 * What happens instead:
 *   1. MONEY FIRST. If any card the customer owns holds money, nothing is
 *      deleted. The card is locked, a closure request goes to the card
 *      issuer, and an admin sees it in the card-closure queue. Deletion is
 *      paused, not refused — once the funds are settled and the card is
 *      closed the customer simply deletes again.
 *   2. Otherwise the customer's personal data is copied into ONE archive
 *      snapshot (lib/accountArchive.js) and removed from the live app. An
 *      admin can view, export or restore it for the window set by
 *      account_archive_retention_days; then it is permanently erased.
 *   3. The User row stays as an anonymized tombstone — name, email, phone,
 *      password and avatar scrubbed — so retained financial and compliance
 *      records still have something to point at, and the original email and
 *      phone become free to register again.
 *   4. RETAINED_FOR_COMPLIANCE is what is NOT archived and NOT deleted: it
 *      stays in its own tables, untouched, indefinitely.
 *
 * KNOWN LIMIT: the card-issuing contract can freeze a card and raise a
 * closure request, but cannot confirm closure — that is a process with the
 * partner bank, recorded by an admin on the closure request.
 */
const RETAINED_FOR_COMPLIANCE = [
  "Card, virtual card and card-activity ledgers",
  "QR payment records",
  "Identity verification (KYC) records",
  "AI credit purchase records and AI usage/cost logs",
  "Fee quotes and the security audit log",
  "Dispute and fraud support tickets",
  "Proof of consent to the Terms (timestamp and version only — IP address is removed)",
];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Funds are held, so the deletion is paused: lock the money, raise the
 * closure request, and queue it for an admin. Safe to call repeatedly — a
 * customer who taps delete twice still has one open request.
 */
async function requestCardClosure({ userId, card, ownedVirtualCards, totalFunds, issuer, ip }) {
  let reference = null;
  if (card) {
    try {
      if (!card.frozen) await issuer.setFrozen(card.id, true);
      reference = (await issuer.requestClosure(card.id, { reason: "account_deletion" })).reference;
    } catch (err) {
      console.error("Account deletion: couldn't lock the card or raise the closure request:", err.message); // eslint-disable-line no-console
      throw badRequest("We couldn't send your card closure request just now. Please try again in a moment.");
    }
  }

  // Lock add-on cards that hold money, so the balance can't change while the
  // bank closes things. (Terminated ones are already locked.)
  for (const c of ownedVirtualCards.filter((c) => !c.terminated && !c.frozen && Number(c.balance) > 0)) {
    await prisma.$transaction([
      prisma.virtualCard.update({ where: { id: c.id }, data: { frozen: true } }),
      prisma.virtualCardActivity.create({ data: { cardId: c.id, type: "frozen", label: "Card frozen — account closure requested", performedByUserId: userId } }),
    ]);
  }

  const existing = await prisma.cardClosureRequest.findFirst({ where: { userId, status: "pending" } });
  const request = existing
    ? await prisma.cardClosureRequest.update({ where: { id: existing.id }, data: { balance: totalFunds, cardId: card ? card.id : null, providerReference: reference || existing.providerReference } })
    : await prisma.cardClosureRequest.create({ data: { userId, cardId: card ? card.id : null, balance: totalFunds, providerReference: reference } });

  await writeAudit(userId, "account.delete.closure_requested", { ip, requestId: request.id, balance: totalFunds });
  return { deleted: false, closureRequested: true, balance: totalFunds, requestId: request.id };
}

async function deleteOwnAccount({ userId, password, reason, ip }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw unauthorized("Account not found");

  // Staff have their own removal path in the admin portal, which also
  // protects against deleting the last super admin — not something to
  // bypass through the customer app.
  if (isAdminRole(user.role)) {
    throw forbidden("Staff accounts can't be deleted from the app. Ask a super admin to remove this account.");
  }

  // Irreversible for the customer, so the session alone isn't enough — a
  // borrowed or stolen unlocked phone shouldn't be able to wipe an account.
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  await writeAudit(userId, passwordOk ? "account.delete.password_ok" : "account.delete.password_failed", { ip });
  if (!passwordOk) throw unauthorized("Incorrect password");

  // ---- 1. Money. Funds pause the deletion; they never disappear into it.
  const issuer = getCardIssuingProvider();
  const card = await prisma.card.findUnique({ where: { userId } });
  // Ask the card provider, not our own Card.balance: once the issuer is real
  // it is the source of truth and our row is only a cache.
  const mainBalance = card ? Number((await issuer.getBalance(card.id)).balance) : 0;
  // Terminating an add-on card doesn't return its balance (and transfer-to-main
  // refuses a terminated card), so money on one counts whatever its state.
  const ownedVirtualCards = await prisma.virtualCard.findMany({ where: { ownerId: userId } });
  const virtualFunds = ownedVirtualCards.reduce((sum, c) => sum + Number(c.balance), 0);
  const totalFunds = mainBalance + virtualFunds;
  if (totalFunds > 0) {
    return requestCardClosure({ userId, card, ownedVirtualCards, totalFunds, issuer, ip });
  }

  const memberships = await prisma.walletMember.findMany({
    where: { userId },
    include: { wallet: { include: { members: { select: { userId: true } } } } },
  });
  const ownedSharedWithOthers = memberships.find((m) => m.wallet.type === "SHARED" && m.role === "owner" && m.wallet.members.length > 1);
  if (ownedSharedWithOthers) {
    throw badRequest(`You own the shared wallet "${ownedSharedWithOthers.wallet.name || "Shared wallet"}" with other members. Remove the other members first, then try again.`);
  }

  // ---- 2. Take the archive snapshot BEFORE anything is changed.
  const retentionDays = await getRetentionDays();
  const snapshot = await collectSnapshot(user, memberships);
  const removedWalletIds = new Set(memberships.filter((m) => m.wallet.members.every((x) => x.userId === userId)).map((m) => m.walletId));

  const originalEmail = user.email;
  const originalPhone = user.phone;
  const unusablePasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  // ---- 3. Secure the main card BEFORE anything is deleted. An external call
  // can't be part of the database transaction below, so it goes first: if it
  // fails, nothing has been touched and the customer can simply retry; if
  // the database work fails afterwards, the freeze is undone below.
  let froze = false;
  if (card && !card.frozen) {
    try {
      await issuer.setFrozen(card.id, true);
      froze = true;
    } catch (err) {
      console.error("Account deletion: couldn't freeze the card, nothing was deleted:", err.message); // eslint-disable-line no-console
      throw badRequest("We couldn't safely lock your card just now, so nothing has been deleted. Please try again in a moment.");
    }
  }

  let archiveId;
  try {
    await prisma.$transaction(
      async (tx) => {
        // The archive goes in first, inside the same transaction as the
        // deletions: if it can't be written, nothing is deleted.
        const archive = await tx.accountArchive.create({
          data: {
            userId,
            reason: reason || null,
            fullName: [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" "),
            email: originalEmail,
            phone: originalPhone,
            accountCreatedAt: user.createdAt,
            purgeAfter: retentionDays ? new Date(Date.now() + retentionDays * DAY_MS) : null,
            hadCard: !!card,
            walletCount: memberships.length,
            transactionCount: snapshot.transactions.length,
            budgetCount: snapshot.budgets.length,
            data: snapshot,
          },
        });
        archiveId = archive.id;

        for (const m of memberships) {
          if (removedWalletIds.has(m.walletId)) {
            // Nobody else has this wallet — it goes with the account.
            await tx.transaction.deleteMany({ where: { walletId: m.walletId } });
            await tx.walletInvite.deleteMany({ where: { walletId: m.walletId } });
            // Wallet cascades to virtual cards, which are financial records
            // — so a wallet that has any is emptied but not removed.
            const virtualCards = await tx.virtualCard.count({ where: { walletId: m.walletId } });
            if (virtualCards === 0) await tx.wallet.delete({ where: { id: m.walletId } });
            else await tx.walletMember.delete({ where: { id: m.id } });
          } else {
            // Other people still use this wallet: it stays, minus this member.
            await tx.walletMember.delete({ where: { id: m.id } });
          }
        }

        // Add-on cards. Owned ones are known to be at zero (step 1), so
        // terminating strands nothing. Cards merely HELD by this person but
        // owned by someone else are only frozen: the money is the owner's, and
        // a frozen card can still be managed — and its balance moved back — by
        // them, whereas a terminated one can't.
        for (const c of ownedVirtualCards.filter((c) => !c.terminated)) {
          await tx.virtualCard.update({ where: { id: c.id }, data: { terminated: true, frozen: true } });
          await tx.virtualCardActivity.create({ data: { cardId: c.id, type: "terminated", label: "Card terminated — account deleted", performedByUserId: userId } });
        }
        const heldCards = await tx.virtualCard.findMany({ where: { holderId: userId, ownerId: { not: userId }, terminated: false, frozen: false } });
        for (const c of heldCards) {
          await tx.virtualCard.update({ where: { id: c.id }, data: { frozen: true } });
          await tx.virtualCardActivity.create({ data: { cardId: c.id, type: "frozen", label: "Card frozen — holder deleted their account", performedByUserId: userId } });
        }

        // Anything this person logged that remains (in a shared wallet that
        // carries on, including ones they left earlier) stores their name as
        // plain text on each row — replace it. Restore puts it back.
        await tx.transaction.updateMany({ where: { loggedByUserId: userId }, data: { loggedByName: FORMER_MEMBER } });

        await tx.walletInvite.deleteMany({ where: { OR: [{ invitedUserId: userId }, { invitedByUserId: userId }] } });
        await tx.budget.deleteMany({ where: { userId } });
        await tx.budgetLimitHistory.deleteMany({ where: { userId } });
        // A category still used by a surviving shared-wallet transaction can't
        // be deleted (Transaction.category is RESTRICT), so only unused ones go.
        await tx.category.deleteMany({ where: { userId, transactions: { none: {} } } });
        await tx.userSeenTip.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.pushSubscription.deleteMany({ where: { userId } });
        await tx.pushDeviceToken.deleteMany({ where: { userId } });
        await tx.webAuthnCredential.deleteMany({ where: { userId } });
        await tx.refreshToken.deleteMany({ where: { userId } });
        await tx.passwordResetToken.deleteMany({ where: { userId } });
        await tx.emailVerification.deleteMany({ where: { email: originalEmail } });
        await tx.phoneVerification.deleteMany({ where: { phone: originalPhone } });
        await tx.supportTicket.deleteMany({ where: { userId, category: { in: GENERAL_TICKET_CATEGORIES } } });

        // A closure request raised earlier is moot now — the funds cleared.
        await tx.cardClosureRequest.updateMany({
          where: { userId, status: "pending" },
          data: { status: "closed", resolvedAt: new Date(), note: "Closed automatically: the balance reached zero and the customer then deleted their account." },
        });

        await tx.user.update({
          where: { id: userId },
          data: {
            firstName: "Deleted",
            middleName: null,
            lastName: "user",
            // Unique, unroutable placeholders: satisfy the unique constraints
            // without keeping anything identifying, and free the real email
            // and phone for a future signup.
            email: `deleted-${userId}@deleted.invalid`,
            phone: `deleted-${userId}`,
            passwordHash: unusablePasswordHash,
            avatarUrl: null,
            termsAcceptedIp: null,
            lockedUntil: null,
            deletedAt: new Date(),
          },
        });
      },
      { timeout: 60000 }
    );
  } catch (err) {
    // The account still exists, so don't leave its card locked.
    if (froze) await issuer.setFrozen(card.id, false).catch(() => {});
    throw err;
  }

  await writeAudit(userId, "account.deleted", { ip, archiveId, reason: reason || null });

  // Best-effort and after the fact: the account is already gone, so a mail
  // failure must not turn a completed deletion into an error screen.
  try {
    await getEmailProvider().sendAccountDeleted(originalEmail);
  } catch (err) {
    console.error("Account-deleted confirmation email failed:", err.message); // eslint-disable-line no-console
  }

  return { deleted: true, archiveId };
}

module.exports = { deleteOwnAccount, RETAINED_FOR_COMPLIANCE };
