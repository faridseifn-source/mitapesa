const { getSetting } = require("../lib/settings");
const { forbidden } = require("../lib/errors");

// Applied to every card/payment router (cards, virtual-cards, qr-payments,
// fees) - this is the actual enforcement point for the Pay module kill
// switch, not just a frontend UI hide. A determined client calling the API
// directly, or an older cached frontend build that doesn't know about the
// flag, still can't get through. The frontend's own "Coming soon" screen
// is just the friendly version of this same rule — this is what makes it
// safe to rely on rather than cosmetic.
async function requirePayModuleEnabled(req, res, next) {
  const enabled = (await getSetting("pay_module_enabled")) !== "false";
  if (!enabled) return next(forbidden("Pay isn't available yet — this will unlock once our banking partner connection is live."));
  next();
}

module.exports = { requirePayModuleEnabled };
