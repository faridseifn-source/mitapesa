// Our stored phone is the national number with no leading zero and no
// country code (e.g. "712345678" — see auth.schema.js). BPC SmartVista, per
// the requested integration, expects the local mobile format WITH the
// leading zero and still no country code (e.g. "0712345678") as the wallet
// account identifier submitted on card/wallet generation requests.
function toLocalMobileFormat(phone) {
  const digits = String(phone).replace(/\D/g, "");
  return digits.startsWith("0") ? digits : `0${digits}`;
}

module.exports = { toLocalMobileFormat };
