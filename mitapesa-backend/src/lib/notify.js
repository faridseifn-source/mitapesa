const prisma = require("./prisma");
const { sendPushToUser } = require("./push");

/**
 * The one place that should create an in-app Notification. Every call site
 * both writes the row (for the in-app notification list) and best-effort
 * sends a push, so the two channels can never drift out of sync with each
 * other — a caller that only wanted one and not the other would eventually
 * produce a confusing experience (e.g. a push arrives for something that
 * never shows up in the in-app list, or vice versa).
 */
async function notifyUser(userId, { type, title, message, url }) {
  const notification = await prisma.notification.create({ data: { userId, type, title, message } });
  await sendPushToUser(userId, { title, body: message, url });
  return notification;
}

module.exports = { notifyUser };
