const crypto = require("crypto");
const prisma = require("../../lib/prisma");
const { CbsProvider } = require("./CbsProvider");
const { getSetting } = require("../../lib/settings");

function genRef(prefix) {
  return `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

class MockCbsProvider extends CbsProvider {
  async _simulateLatency(ms = 250) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async _maybeFail() {
    const rate = Number(await getSetting("cbs_simulated_failure_rate")) || 0;
    return rate > 0 && Math.random() * 100 < rate;
  }

  async _post({ paymentId, entryType, amount, accountRef, prefix }) {
    await this._simulateLatency();
    const reference = genRef(prefix);
    const failed = await this._maybeFail();
    const entry = await prisma.cbsLedgerEntry.create({
      data: { reference, paymentId, entryType, amount, accountRef, status: failed ? "failed" : "posted" },
    });
    return {
      cbsRef: entry.reference,
      status: failed ? "failed" : "posted",
      failureReason: failed ? "Simulated CBS posting failure (cbs_simulated_failure_rate)" : undefined,
    };
  }

  async debitSettlementAccount({ reference, amount, narrative, paymentId }) {
    return this._post({ paymentId, entryType: "debit_settlement", amount, accountRef: "SETTLEMENT-CONTROL-001", prefix: "CBS" });
  }

  async creditMerchantAccount({ reference, merchantAccountRef, amount, narrative, paymentId }) {
    return this._post({ paymentId, entryType: "credit_merchant", amount, accountRef: merchantAccountRef, prefix: "CBS" });
  }

  async debitToTipsTransitAccount({ reference, amount, narrative, paymentId }) {
    return this._post({ paymentId, entryType: "debit_tips_transit", amount, accountRef: "TIPS-TRANSIT-001", prefix: "CBS" });
  }

  async reverse(cbsRef, reason) {
    await this._simulateLatency();
    const original = await prisma.cbsLedgerEntry.findUnique({ where: { reference: cbsRef } });
    if (!original) throw new Error(`Cannot reverse unknown CBS reference ${cbsRef}`);
    await prisma.cbsLedgerEntry.update({ where: { id: original.id }, data: { status: "reversed" } });
    const reversalEntry = await prisma.cbsLedgerEntry.create({
      data: { reference: genRef("CBSRV"), paymentId: original.paymentId, entryType: "reversal", amount: original.amount, accountRef: original.accountRef, status: "posted" },
    });
    return { cbsRef: reversalEntry.reference, status: "posted" };
  }
}

module.exports = { MockCbsProvider };
