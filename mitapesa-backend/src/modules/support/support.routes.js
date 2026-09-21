const { Router } = require("express");
const { z } = require("zod");
const rateLimit = require("express-rate-limit");
const prisma = require("../../lib/prisma");
const { requireAuth } = require("../../middleware/auth");
const { asyncHandler } = require("../../middleware/errorHandler");
const { notFound, forbidden, badRequest } = require("../../lib/errors");
const { writeAudit } = require("../../lib/audit");

const router = Router();
router.use(requireAuth);

const serializeTicket = (t) => ({ ...t, disputedAmount: t.disputedAmount === null ? null : Number(t.disputedAmount) });

// A customer filing many tickets in a burst is more likely spam/abuse than
// genuine need — keep this generous but not unlimited.
const ticketLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

const manualDisputeSchema = z.object({
  disputedReference: z.string().max(60).optional(),
  disputedDate: z.string().optional(), // ISO date string from a date input
  disputedAmount: z.number().positive().optional(),
  disputedMerchant: z.string().max(150).optional(),
});

// POST /support/tickets — a customer raises a request or dispute themselves.
//
// Two ways to identify the transaction a dispute concerns:
//  - relatedTransactionId: picked from the in-app transaction list. We look
//    it up and snapshot its real reference/date/amount/merchant ourselves —
//    never trust client-supplied values for a transaction we can verify,
//    since that would let someone cite a real transaction ID while claiming
//    a different disputed amount.
//  - No relatedTransactionId, but disputedReference/disputedDate/disputedAmount
//    provided instead: a transaction the customer can't select in-app (e.g.
//    from an exported/printed statement, or older than what's shown), typed
//    in directly.
router.post(
  "/tickets",
  ticketLimiter,
  asyncHandler(async (req, res) => {
    const { category, subject, description, relatedTransactionId, ...manual } = z
      .object({
        category: z.enum(["dispute", "inquiry", "complaint", "fraud"]),
        subject: z.string().min(3).max(150),
        description: z.string().min(3).max(2000),
        relatedTransactionId: z.string().optional(),
      })
      .merge(manualDisputeSchema)
      .parse(req.body);

    let disputeFields = {
      disputedReference: manual.disputedReference || null,
      disputedDate: manual.disputedDate ? new Date(manual.disputedDate) : null,
      disputedAmount: manual.disputedAmount ?? null,
      disputedMerchant: manual.disputedMerchant || null,
    };

    if (relatedTransactionId) {
      const transaction = await prisma.transaction.findUnique({ where: { id: relatedTransactionId } });
      if (!transaction) throw notFound("That transaction couldn't be found");
      const membership = await prisma.walletMember.findFirst({ where: { walletId: transaction.walletId, userId: req.userId } });
      if (!membership) throw forbidden("You don't have access to that transaction");

      // Server-verified snapshot — overrides anything the client sent for these fields.
      disputeFields = {
        disputedReference: transaction.reference || null,
        disputedDate: transaction.date,
        disputedAmount: Math.abs(Number(transaction.amount)),
        disputedMerchant: transaction.merchant,
      };
    } else if (disputeFields.disputedDate && isNaN(disputeFields.disputedDate.getTime())) {
      throw badRequest("Invalid disputed transaction date");
    }

    const ticket = await prisma.supportTicket.create({
      data: { userId: req.userId, category, subject, description, relatedTransactionId: relatedTransactionId || null, ...disputeFields },
    });
    await writeAudit(req.userId, "support.ticket.created", { ip: req.ip, ticketId: ticket.id, category, hasTransaction: !!relatedTransactionId || !!disputeFields.disputedReference });
    res.status(201).json({ ticket: serializeTicket(ticket) });
  })
);

// GET /support/tickets — the customer's own tickets only.
router.get(
  "/tickets",
  asyncHandler(async (req, res) => {
    const tickets = await prisma.supportTicket.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } });
    res.json({ tickets: tickets.map(serializeTicket) });
  })
);

router.get(
  "/tickets/:ticketId",
  asyncHandler(async (req, res) => {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.ticketId } });
    if (!ticket || ticket.userId !== req.userId) throw notFound("Ticket not found");
    res.json({ ticket: serializeTicket(ticket) });
  })
);

module.exports = router;
