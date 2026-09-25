const { verifyAccessToken } = require("../lib/jwt");
const { unauthorized } = require("../lib/errors");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return next(unauthorized("Missing access token"));

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    next();
  } catch (err) {
    next(unauthorized("Invalid or expired access token"));
  }
}

module.exports = { requireAuth };
