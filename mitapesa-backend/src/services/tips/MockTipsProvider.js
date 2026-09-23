const crypto = require("crypto");
const prisma = require("../../lib/prisma");
const { TipsProvider } = require("./TipsProvider");
const { getSetting } = require("../../lib/settings");

function genRef() {
  return `TIPS-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

class MockTipsProvider extends TipsProvider {
  async _simulateLatency(ms = 400) {
    // TIPS is a real interbank rail, not a direct debit — a slightly longer
    // simulated latency than CBS reflects that this is genuinely a hop to
    // another institution and back, not a local posting.
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async routePayment({ reference, acquirerId, merchantId, amount, currency, paymentId }) {
    await this._simulateLatency();
    const failRate = Number(await getSetting("tips_simulated_failure_rate")) || 0;
    const roll = Math.random() * 100;
    const failed = failRate > 0 && roll < failRate;
    // A slice of the non-failure outcomes come back "pending" rather than
    // "completed" — TIPS's real timeout/pending-response scenario, which
    // the orchestration layer needs to actually be able to handle, not just
    // the success and failure paths.
    const pending = !failed && failRate > 0 && roll < failRate + 5;

    const status = failed ? "failed" : pending ? "pending" : "completed";
    const entry = await prisma.tipsLedgerEntry.create({
      data: { reference: genRef(), paymentId, acquirerId, merchantId, amount, status },
    });
    return {
      tipsRef: entry.reference,
      status,
      failureReason: failed ? "Simulated TIPS routing failure (tips_simulated_failure_rate)" : undefined,
    };
  }

  async checkStatus(tipsRef) {
    const entry = await prisma.tipsLedgerEntry.findUnique({ where: { reference: tipsRef } });
    if (!entry) throw new Error(`Unknown TIPS reference ${tipsRef}`);
    return { tipsRef: entry.reference, status: entry.status };
  }
}

module.exports = { MockTipsProvider };
