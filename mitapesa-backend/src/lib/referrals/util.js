const crypto = require("crypto");

// Unambiguous alphabet — no 0/O, 1/I/L — because people read codes aloud and
// type them from a screenshot.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode(length = 7) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Salted hash: lets the fraud engine compare devices/IPs without storing
// either in a form anyone could read back.
function hashValue(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(`mitapesa-ref:${String(value)}`).digest("hex").slice(0, 32);
}

const isUniqueViolation = (err) => Boolean(err) && err.code === "P2002";

// Rows come from Prisma as Decimal; the API deals in plain numbers.
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

function addDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

module.exports = { generateCode, normalizeCode, hashValue, isUniqueViolation, num, addDays };
