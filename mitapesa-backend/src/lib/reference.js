const crypto = require("crypto");

// Short, human-showable reference for a receipt — not a security token, just
// something a user can quote in a support conversation.
function generatePaymentReference() {
  return `PSM-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

module.exports = { generatePaymentReference };
