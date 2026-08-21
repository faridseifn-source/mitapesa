const crypto = require("crypto");

/**
 * Computes a period statement from a card's current balance and its full
 * activity history from `from` onward (ascending by date). This is a "pull
 * statement" read operation — a real CMS would likely expose this as its
 * own reporting endpoint, so it's deliberately not part of the
 * CardIssuingProvider's control-plane methods (issue/freeze/debit/etc).
 *
 * @param {Object} params
 * @param {number} params.currentBalance
 * @param {Array<{ date: Date, amount: number|null, label: string, type: string }>} params.activitySinceFrom — every entry with date >= from, ascending
 * @param {Date} params.from
 * @param {Date} params.to
 */
function computeStatement({ currentBalance, activitySinceFrom, from, to }) {
  const moneyEntries = activitySinceFrom.filter((a) => a.amount !== null && a.amount !== undefined);

  // Reverse out everything that happened since `from` to find the balance
  // as it stood at the start of the period.
  const deltaSinceFrom = moneyEntries.reduce((sum, a) => sum + Number(a.amount), 0);
  const openingBalance = currentBalance - deltaSinceFrom;

  const inRange = moneyEntries.filter((a) => a.date >= from && a.date <= to);
  const afterFromButBeforeToDelta = inRange.reduce((sum, a) => sum + Number(a.amount), 0);
  const closingBalance = openingBalance + afterFromButBeforeToDelta;

  let running = openingBalance;
  const entries = inRange.map((a) => {
    running += Number(a.amount);
    return { date: a.date, label: a.label, type: a.type, amount: Number(a.amount), balanceAfter: running };
  });

  const totalCredits = inRange.filter((a) => Number(a.amount) > 0).reduce((s, a) => s + Number(a.amount), 0);
  const totalDebits = inRange.filter((a) => Number(a.amount) < 0).reduce((s, a) => s + Math.abs(Number(a.amount)), 0);

  return {
    reference: `STMT-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    from,
    to,
    openingBalance,
    closingBalance,
    totalCredits,
    totalDebits,
    entryCount: entries.length,
    entries,
    generatedAt: new Date(),
  };
}

module.exports = { computeStatement };
