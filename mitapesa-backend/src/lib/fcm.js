const admin = require("firebase-admin");
const env = require("./env");

let app = null;
let initAttempted = false;

/**
 * Lazily initializes the Firebase Admin app from the service account JSON
 * env var. Returns null (rather than throwing) if not configured, so
 * callers can skip native push quietly the same way sendPushToUser already
 * skips web push when VAPID keys aren't set - a missing credential should
 * never crash a request that's just trying to notify a user.
 */
function getApp() {
  if (initAttempted) return app;
  initAttempted = true;
  if (!env.push.firebaseServiceAccountJson) return null;
  try {
    const serviceAccount = JSON.parse(env.push.firebaseServiceAccountJson);
    app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (err) {
    console.error("Failed to initialize Firebase Admin - check FIREBASE_SERVICE_ACCOUNT_JSON", err); // eslint-disable-line no-console
    app = null;
  }
  return app;
}

/**
 * Sends a single FCM push to one device token. Returns "ok", "invalid"
 * (token no longer registered - caller should delete it), or "error"
 * (transient failure - caller should leave the token alone and not retry
 * here, matching the same best-effort philosophy as sendPushToUser).
 */
async function sendFcmToToken(token, { title, body, url }) {
  const firebaseApp = getApp();
  if (!firebaseApp) return "not_configured";
  try {
    await admin.messaging(firebaseApp).send({
      token,
      notification: { title, body },
      data: { url: url || "/" },
    });
    return "ok";
  } catch (err) {
    if (err?.code === "messaging/registration-token-not-registered" || err?.code === "messaging/invalid-registration-token") {
      return "invalid";
    }
    console.error("FCM send failed", err); // eslint-disable-line no-console
    return "error";
  }
}

module.exports = { sendFcmToToken };
