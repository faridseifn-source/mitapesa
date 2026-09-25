const prisma = require("../../lib/prisma");
const { forbidden, notFound } = require("../../lib/errors");

async function assertWalletMember(userId, walletId) {
  const membership = await prisma.walletMember.findUnique({
    where: { walletId_userId: { walletId, userId } },
  });
  if (!membership) {
    const wallet = await prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) throw notFound("Wallet not found");
    throw forbidden("Not a member of this wallet");
  }
  return membership;
}

async function userWalletIds(userId) {
  const memberships = await prisma.walletMember.findMany({ where: { userId }, select: { walletId: true } });
  return memberships.map((m) => m.walletId);
}

module.exports = { assertWalletMember, userWalletIds };
