// Damm algorithm — a single check-digit scheme that detects all single-digit
// errors and all adjacent-transposition errors, used by TANQR Annex 3 §2 for
// the "Alias Merchant ID" scheme (feature-phone-friendly manual entry:
// AAA-CCCC-S = 3-digit Acquirer Code + 4-digit Merchant Code + 1 checksum
// digit). This exact table is the standard published Damm quasigroup.
const DAMM_TABLE = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

function dammCheckDigit(digits) {
  let interim = 0;
  for (const ch of digits) interim = DAMM_TABLE[interim][Number(ch)];
  return interim;
}

// True if the last digit of `digitsWithCheck` is a valid Damm check digit
// for everything before it.
function dammValidate(digitsWithCheck) {
  let interim = 0;
  for (const ch of digitsWithCheck) interim = DAMM_TABLE[interim][Number(ch)];
  return interim === 0;
}

module.exports = { dammCheckDigit, dammValidate };
