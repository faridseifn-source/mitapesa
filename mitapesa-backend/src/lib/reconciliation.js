const prisma = require("../lib/prisma");

function dayRange(dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  const from = new Date(date); from.setUTCHours(0, 0, 0, 0);
  const to = new Date(date); to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

/**
 * Compares the wallet ledger (Transaction rows sourced from QR payments),
 * the simulated CBS settlement postings, and the simulated TIPS routing
 * entries for a given day. Every QR payment that completed should have a
 * matching CBS settlement debit and, for off-us payments, a matching TIPS
 * entry — anything missing or mismatched is written to
 * ReconciliationException for the investigation queue.
 */
async function runReconciliation(dateStr) {
  const { from, to } = dayRange(dateStr);

  const payments = await prisma.qrPayment.findMany({
    where: { createdAt: { gte: from, lte: to } },
    include: { merchant: true },
  });

  const exceptions = [];

  for (const payment of payments) {
    const cbsEntries = await prisma.cbsLedgerEntry.findMany({ where: { paymentId: payment.id } });
    const tipsEntry = payment.isOnUs ? null : await prisma.tipsLedgerEntry.findFirst({ where: { paymentId: payment.id } });

    if (payment.status === "completed") {
      const settlementEntry = cbsEntries.find((e) => e.entryType === "debit_settlement" && e.status === "posted");
      if (!settlementEntry) {
        exceptions.push({ paymentId: payment.id, reference: payment.reference, reason: "Completed payment has no matching CBS settlement debit", detail: { cbsEntries: cbsEntries.length } });
      } else if (Number(settlementEntry.amount) !== Number(payment.amount)) {
        exceptions.push({ paymentId: payment.id, reference: payment.reference, reason: "CBS settlement amount doesn't match wallet ledger amount", detail: { walletAmount: Number(payment.amount), cbsAmount: Number(settlementEntry.amount) } });
      }
      if (payment.isOnUs) {
        const creditEntry = cbsEntries.find((e) => e.entryType === "credit_merchant" && e.status === "posted");
        if (!creditEntry) {
          exceptions.push({ paymentId: payment.id, reference: payment.reference, reason: "On-us payment completed but merchant was never credited in CBS", detail: {} });
        }
      } else {
        if (!tipsEntry || tipsEntry.status !== "completed") {
          exceptions.push({ paymentId: payment.id, reference: payment.reference, reason: "Off-us payment completed but TIPS entry is missing or not completed", detail: { tipsStatus: tipsEntry?.status || "missing" } });
        }
      }
      const transaction = payment.transactionId ? await prisma.transaction.findUnique({ where: { id: payment.transactionId } }) : null;
      if (!transaction) {
        exceptions.push({ paymentId: payment.id, reference: payment.reference, reason: "Completed payment has no corresponding wallet ledger Transaction", detail: {} });
      }
    }

    if (payment.status === "reversed") {
      const reversalEntries = cbsEntries.filter((e) => e.entryType === "reversal");
      if (reversalEntries.length === 0 && cbsEntries.some((e) => e.status === "posted")) {
        exceptions.push({ paymentId: payment.id, reference: payment.reference, reason: "Payment reversed on our side but no CBS reversal entry found", detail: {} });
      }
    }

    if (payment.status === "processing" && payment.stage !== "awaiting_acquirer_response") {
      const ageMs = Date.now() - new Date(payment.updatedAt).getTime();
      if (ageMs > 10 * 60 * 1000) {
        exceptions.push({ paymentId: payment.id, reference: payment.reference, reason: "Payment stuck in processing for over 10 minutes — needs manual investigation", detail: { stage: payment.stage, ageMinutes: Math.round(ageMs / 60000) } });
      }
    }
  }

  // De-duplicate against exceptions already raised for the same
  // payment+reason so re-running reconciliation doesn't spam the queue.
  const created = [];
  for (const exc of exceptions) {
    const already = await prisma.reconciliationException.findFirst({ where: { paymentId: exc.paymentId, reason: exc.reason, status: { not: "resolved" } } });
    if (already) continue;
    created.push(await prisma.reconciliationException.create({ data: exc }));
  }

  const walletTotal = payments.filter((p) => p.status === "completed").reduce((s, p) => s + Number(p.amount), 0);
  const cbsSettlementTotal = (await prisma.cbsLedgerEntry.aggregate({
    where: { createdAt: { gte: from, lte: to }, entryType: "debit_settlement", status: "posted" },
    _sum: { amount: true },
  }))._sum.amount || 0;
  const tipsTotal = (await prisma.tipsLedgerEntry.aggregate({
    where: { createdAt: { gte: from, lte: to }, status: "completed" },
    _sum: { amount: true },
  }))._sum.amount || 0;

  return {
    date: from.toISOString().slice(0, 10),
    paymentsChecked: payments.length,
    walletTotal,
    cbsSettlementTotal: Number(cbsSettlementTotal),
    tipsTotal: Number(tipsTotal),
    balanced: Math.abs(walletTotal - Number(cbsSettlementTotal)) < 0.01,
    newExceptions: created.length,
    totalExceptions: exceptions.length,
  };
}

module.exports = { runReconciliation };
