const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const env = require("./env");

function signAccessToken(user, expiresInOverride) {
  return jwt.sign({ sub: user.id, email: user.email }, env.jwt.accessSecret, {
    expiresIn: expiresInOverride || env.jwt.accessExpiresIn,
  });
}

function signRefreshToken(user, expiresInOverride) {
  return jwt.sign({ sub: user.id }, env.jwt.refreshSecret, {
    expiresIn: expiresInOverride || env.jwt.refreshExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret);
}

// We store only a hash of the refresh token server-side, so a leaked DB
// doesn't hand out usable tokens.
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
};
