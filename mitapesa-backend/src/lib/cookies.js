const env = require("./env");

const COOKIE_NAME = "mitapesa_refresh_token";
const ADMIN_COOKIE_NAME = "mitapesa_admin_refresh_token";

function setRefreshCookie(res, refreshToken) {
  res.cookie(COOKIE_NAME, refreshToken, {
    httpOnly: true, // JavaScript in the browser cannot read this — the key XSS mitigation
    secure: env.nodeEnv === "production", // requires HTTPS in production
    sameSite: env.nodeEnv === "production" ? "none" : "lax", // "none" needed once frontend/API are on different domains
    maxAge: env.jwt.refreshMaxAgeMs,
    path: "/auth",
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/auth" });
}

// Deliberately a different cookie name and path from the customer app's —
// keeps the two sessions from ever being confused with each other, even
// though in practice they'll also be on different domains (separate
// frontend deployments).
function setAdminRefreshCookie(res, refreshToken) {
  res.cookie(ADMIN_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: env.nodeEnv === "production" ? "none" : "lax",
    maxAge: env.jwt.adminRefreshMaxAgeMs,
    path: "/admin/auth",
  });
}

function clearAdminRefreshCookie(res) {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: "/admin/auth" });
}

module.exports = { COOKIE_NAME, setRefreshCookie, clearRefreshCookie, ADMIN_COOKIE_NAME, setAdminRefreshCookie, clearAdminRefreshCookie };
