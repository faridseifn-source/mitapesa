const prisma = require("../../lib/prisma");
const { notFound, badRequest, forbidden } = require("../../lib/errors");
const { getCardIssuingProvider } = require("../../services/card-issuing");
const { getSetting } = require("../../lib/settings");

// Every router that calls this already applies requirePayModuleEnabled
// (cards, virtual-cards, qr-payments, fees) - but re-checking the setting
// here directly, rather than trusting every caller to have applied the
// right middleware, means this stays correct even if a future route
// forgets to.
async function myCard(userId) {
  let card = await prisma.card.findUnique({ where: { userId } });
  if (!card) {
    const payModuleEnabled = (await getSetting("pay_module_enabled")) !== "false";
    if (!payModuleEnabled) {
      throw forbidden("Pay isn't available yet — this will unlock once our banking partner connection is live.");
    }
    // Lazily provisions the card the first time a customer who signed up
    // while the module was off actually needs one, now that an admin has
    // switched it back on — see settings.js's pay_module_enabled comment
    // for the full rationale. No backfill migration needed by design.
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound("User not found");
    await getCardIssuingProvider().issueCard({ userId, holderName: `${user.firstName} ${user.lastName}`.toUpperCase() });
    card = await prisma.card.findUnique({ where: { userId } });
  }
  if (!card) throw notFound("No card provisioned for this user");
  return card;
}

// Wraps the provider's debit() so "not enough money" comes back as a clear
// 400 the client can show, instead of an uncaught error turning into a
// generic 500. `client` optionally lets the caller run this inside an
// interactive prisma transaction (see MockCardProvider for why this matters).
async function debitCard(cardId, details, client) {
  try {
    return await getCardIssuingProvider().debit(cardId, details, client);
  } catch (err) {
    if (err.code === "INSUFFICIENT_FUNDS") throw badRequest("Insufficient card balance. Please top up your card first.");
    throw err;
  }
}

module.exports = { myCard, debitCard };
