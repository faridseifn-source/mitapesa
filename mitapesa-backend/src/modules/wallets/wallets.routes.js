const { Router } = require("express");
const { z } = require("zod");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, forbidden, conflict, badRequest } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");
const { getSettingNumber } = require("../../lib/settings");
const { getCardIssuingProvider } = require("../../services/card-issuing");
const { notifyUser } = require("../../lib/notify");

const router = Router();
router.use(requireAuth);

// GET /wallets — all wallets this user belongs to (personal + shared).
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const memberships = await prisma.walletMember.findMany({
      where: { userId: req.userId },
      include: { wallet: { include: { members: { include: { user: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } } } } } },
    });
    res.json({ wallets: memberships.map((m) => m.wallet) });
  })
);

// POST /wallets — create a shared wallet, creator becomes owner.
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1) }).parse(req.body);
    const wallet = await prisma.wallet.create({
      data: { type: "SHARED", name, members: { create: { userId: req.userId, role: "owner" } } },
      include: { members: true },
    });
    res.status(201).json({ wallet });
  })
);

router.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { id: req.params.id }, include: { members: true } });
    if (!wallet) throw notFound("Wallet not found");
    const requester = wallet.members.find((m) => m.userId === req.userId);
    if (!requester || requester.role !== "owner") throw forbidden("Only the wallet owner can remove members");

    await prisma.walletMember.deleteMany({ where: { walletId: wallet.id, userId: req.params.userId } });
    await writeAudit(req.userId, "wallet.member_removed", { ip: req.ip, walletId: wallet.id, removedUserId: req.params.userId });
    res.status(204).send();
  })
);

/* ------------------------- wallet invitations -------------------------- */
// Consent-based: inviting someone no longer silently creates a WalletMember
// row. It creates a WalletInvite the invitee must explicitly accept.

// POST /wallets/:id/invite { phone, createAddOnCard?, addOnCardLabel? } — owner only, invites a registered user by phone.
router.post(
  "/:id/invite",
  asyncHandler(async (req, res) => {
    const { phone, createAddOnCard, addOnCardLabel } = z
      .object({ phone: z.string().min(8).max(9), createAddOnCard: z.boolean().optional(), addOnCardLabel: z.string().max(40).optional() })
      .parse(req.body);
    const wallet = await prisma.wallet.findUnique({ where: { id: req.params.id }, include: { members: true } });
    if (!wallet) throw notFound("Wallet not found");
    if (wallet.type !== "SHARED") throw badRequest("Only shared wallets accept invitations");
    const requester = wallet.members.find((m) => m.userId === req.userId);
    if (!requester || requester.role !== "owner") throw forbidden("Only the wallet owner can invite members");

    const invitee = await prisma.user.findUnique({ where: { phone } });
    if (!invitee) throw notFound("No MitaPesa account found with that phone number");
    if (invitee.id === req.userId) throw badRequest("You can't invite yourself");
    if (wallet.members.some((m) => m.userId === invitee.id)) throw conflict("That person is already a member of this wallet");

    const existingPending = await prisma.walletInvite.findFirst({ where: { walletId: wallet.id, invitedUserId: invitee.id, status: "pending" } });
    if (existingPending) throw conflict("An invitation is already pending for that person");

    // Requirement 1: cap total household size (accepted members + pending
    // invites, excluding the owner) at a configurable limit — a DB-backed
    // setting so it can change later via the Administrator Portal without a
    // redeploy, rather than being hardcoded.
    const maxMembers = (await getSettingNumber("household_max_members")) ?? 3;
    const acceptedCount = wallet.members.filter((m) => m.role !== "owner").length;
    const pendingCount = await prisma.walletInvite.count({ where: { walletId: wallet.id, status: "pending" } });
    if (acceptedCount + pendingCount >= maxMembers) {
      throw badRequest(`This household wallet already has ${maxMembers} member${maxMembers === 1 ? "" : "s"} (including pending invites) — the maximum allowed.`);
    }

    const invite = await prisma.walletInvite.create({
      data: {
        walletId: wallet.id,
        invitedUserId: invitee.id,
        invitedByUserId: req.userId,
        createAddOnCard: !!createAddOnCard,
        addOnCardLabel: addOnCardLabel || null,
      },
    });

    const inviter = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    await notifyUser(invitee.id, {
      type: "wallet_invite",
      title: "Wallet invitation",
      message: `${inviter.firstName} invited you to join "${wallet.name || "their household wallet"}"`,
      url: "/wallets",
    });
    await writeAudit(req.userId, "wallet.invite_sent", { ip: req.ip, walletId: wallet.id, invitedUserId: invitee.id });

    res.status(201).json({ invite });
  })
);

// GET /wallets/invites — pending invites addressed to me.
router.get(
  "/invites",
  asyncHandler(async (req, res) => {
    const invites = await prisma.walletInvite.findMany({
      where: { invitedUserId: req.userId, status: "pending" },
      include: { wallet: true, invitedByUser: { select: { id: true, firstName: true, lastName: true, avatarUrl: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({ invites });
  })
);

// GET /wallets/:id/invites — invites I've sent for a wallet I own (to show pending status).
router.get(
  "/:id/invites",
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { id: req.params.id }, include: { members: true } });
    if (!wallet) throw notFound("Wallet not found");
    const requester = wallet.members.find((m) => m.userId === req.userId);
    if (!requester || requester.role !== "owner") throw forbidden("Only the wallet owner can view its invitations");

    const invites = await prisma.walletInvite.findMany({
      where: { walletId: wallet.id, status: "pending" },
      include: { invitedUser: { select: { id: true, firstName: true, lastName: true, avatarUrl: true, phone: true } } },
      orderBy: { createdAt: "desc" },
    });
    const maxMembers = (await getSettingNumber("household_max_members")) ?? 3;
    const acceptedCount = wallet.members.filter((m) => m.role !== "owner").length;
    res.json({ invites, maxMembers, acceptedCount, pendingCount: invites.length });
  })
);

// POST /wallets/invites/:inviteId/accept
router.post(
  "/invites/:inviteId/accept",
  asyncHandler(async (req, res) => {
    const invite = await prisma.walletInvite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite) throw notFound("Invitation not found");
    if (invite.invitedUserId !== req.userId) throw forbidden("This invitation isn't addressed to you");
    if (invite.status !== "pending") throw conflict("This invitation is no longer pending");

    await prisma.$transaction([
      prisma.walletMember.create({ data: { walletId: invite.walletId, userId: req.userId, role: "member" } }),
      prisma.walletInvite.update({ where: { id: invite.id }, data: { status: "accepted", respondedAt: new Date() } }),
    ]);

    // Card issuance is a separate call to the CMS provider (a real CMS call
    // is an external API request, which genuinely cannot live inside our DB
    // transaction above) — so membership always succeeds even if this fails;
    // a failure here is logged rather than silently lost.
    let addOnCardIssued = false;
    if (invite.createAddOnCard) {
      try {
        await getCardIssuingProvider().issueVirtualCard({
          walletId: invite.walletId, ownerId: invite.invitedByUserId, holderId: req.userId, type: "parent_linked", label: invite.addOnCardLabel,
        });
        addOnCardIssued = true;
      } catch (err) {
        console.error(`Failed to issue add-on card for accepted invite ${invite.id}:`, err); // eslint-disable-line no-console
        await writeAudit(req.userId, "wallet.addon_card_issuance_failed", { ip: req.ip, walletId: invite.walletId, error: err.message });
      }
    }

    await writeAudit(req.userId, "wallet.invite_accepted", { ip: req.ip, walletId: invite.walletId, addOnCardIssued });
    await notifyUser(invite.invitedByUserId, { type: "wallet_invite_accepted", title: "Invitation accepted", message: "Your wallet invitation was accepted.", url: "/wallets" });
    if (addOnCardIssued) {
      await notifyUser(req.userId, { type: "virtual_card_issued", title: "New add-on card", message: "A shared add-on card is now available to you.", url: "/pay" });
    }

    res.status(204).send();
  })
);

// POST /wallets/invites/:inviteId/decline
router.post(
  "/invites/:inviteId/decline",
  asyncHandler(async (req, res) => {
    const invite = await prisma.walletInvite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite) throw notFound("Invitation not found");
    if (invite.invitedUserId !== req.userId) throw forbidden("This invitation isn't addressed to you");
    if (invite.status !== "pending") throw conflict("This invitation is no longer pending");

    await prisma.walletInvite.update({ where: { id: invite.id }, data: { status: "declined", respondedAt: new Date() } });
    await writeAudit(req.userId, "wallet.invite_declined", { ip: req.ip, walletId: invite.walletId });
    res.status(204).send();
  })
);

// DELETE /wallets/:id/invites/:inviteId — owner revokes a still-pending invite.
router.delete(
  "/:id/invites/:inviteId",
  asyncHandler(async (req, res) => {
    const wallet = await prisma.wallet.findUnique({ where: { id: req.params.id }, include: { members: true } });
    if (!wallet) throw notFound("Wallet not found");
    const requester = wallet.members.find((m) => m.userId === req.userId);
    if (!requester || requester.role !== "owner") throw forbidden("Only the wallet owner can revoke invitations");

    const invite = await prisma.walletInvite.findUnique({ where: { id: req.params.inviteId } });
    if (!invite || invite.walletId !== wallet.id) throw notFound("Invitation not found");
    if (invite.status !== "pending") throw conflict("This invitation is no longer pending");

    await prisma.walletInvite.update({ where: { id: invite.id }, data: { status: "revoked", respondedAt: new Date() } });
    await writeAudit(req.userId, "wallet.invite_revoked", { ip: req.ip, walletId: wallet.id });
    res.status(204).send();
  })
);

module.exports = router;
