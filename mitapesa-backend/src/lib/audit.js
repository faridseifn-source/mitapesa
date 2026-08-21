const prisma = require("./prisma");

/**
 * Fire-and-forget audit write. Never throws into the caller's request flow —
 * a logging failure should never block or fail the underlying operation,
 * but it's still logged to stderr so it doesn't disappear silently.
 */
async function writeAudit(userId, action, { amount, ip, ...metadata } = {}) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, amount: amount ?? null, ip: ip ?? null, metadata },
    });
  } catch (err) {
    console.error(`Failed to write audit log [${action}]`, err); // eslint-disable-line no-console
  }
}

module.exports = { writeAudit };
