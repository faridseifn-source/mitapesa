const prisma = require("./prisma");
const { badRequest } = require("./errors");

/**
 * Every route that moves money must call this first. Returns the stored
 * response if this exact (user, key) pair was already processed — the
 * caller should send that straight back and do nothing else. Returns null
 * if this is a new request and the caller should proceed normally, then
 * call saveIdempotentResponse() once it has a result.
 */
async function checkIdempotencyKey(req) {
  const key = req.headers["idempotency-key"];
  if (!key || typeof key !== "string") {
    throw badRequest("Idempotency-Key header is required for this operation");
  }
  const existing = await prisma.idempotencyKey.findUnique({
    where: { userId_key: { userId: req.userId, key } },
  });
  return existing || null;
}

async function saveIdempotentResponse(req, statusCode, responseBody) {
  const key = req.headers["idempotency-key"];
  if (!key) return;
  // A race between two identical concurrent requests could both pass the
  // check above; the unique constraint means only one insert wins, which
  // is exactly the behavior we want — swallow the duplicate-key error.
  await prisma.idempotencyKey.create({ data: { userId: req.userId, key, statusCode, responseBody } }).catch(() => {});
}

module.exports = { checkIdempotencyKey, saveIdempotentResponse };
