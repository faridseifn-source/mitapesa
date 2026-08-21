function genLast4() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

// Generates a plausible-looking 16-digit PAN (not a real card scheme/Luhn
// check — this is a mock issuer) and a 3-digit CVV, both encrypted before
// storage by the caller. Real card numbers should only ever come from a
// real processor once that integration exists.
//
// `binPrefix` mirrors how a real CMS (e.g. BPC SmartVista) ties card
// numbers to a configured "Product" — see UNDEFINED_BIN_FOR_PRODUCT in the
// SVAP issuing spec. Callers should fetch the current value via
// `getSetting("card_bin")` rather than hardcoding it, so it stays a real
// admin-configurable parameter instead of a constant buried in code.
function genCardCredentials(binPrefix = "428427") {
  const bin = String(binPrefix).replace(/\D/g, "").padEnd(6, "0").slice(0, 6);
  const last4 = genLast4();
  const middleLength = 16 - bin.length - last4.length; // fills out to exactly 16 digits
  const middle = String(Math.floor(Math.pow(10, middleLength - 1) + Math.random() * (9 * Math.pow(10, middleLength - 1))));
  const fullNumber = `${bin}${middle}${last4}`;
  const cvv = String(100 + Math.floor(Math.random() * 900));
  return { last4, fullNumber, cvv };
}

module.exports = { genLast4, genCardCredentials };
