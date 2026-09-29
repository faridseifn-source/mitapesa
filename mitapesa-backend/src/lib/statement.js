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

/**
 * The PFM counterpart to computeStatement() above — deliberately a
 * separate, simpler function rather than a variant of the same one.
 * Card activity has a real running balance (a card genuinely holds a
 * number of TZS); a PFM transaction is just a customer's own record of
 * spending, not money actually moving through an account — there's no
 * "opening balance" for a category of hand-entered notes. Mixing the two
 * into one running balance would misrepresent real card activity as
 * though a PFM entry had moved real money, so this only ever reports a
 * period total, never a balance.
 *
 * @param {Object} params
 * @param {Array<{ date: Date, amount: number|Decimal, merchant: string, category: string|null|undefined }>} params.transactions — already scoped to the customer and the period
 * @param {Date} params.from
 * @param {Date} params.to
 */
function computePfmStatement({ transactions, from, to }) {
  const entries = transactions
    .map((tx) => ({ date: tx.date, label: tx.merchant, type: tx.category || "Uncategorized", amount: Number(tx.amount) }))
    .sort((a, b) => a.date - b.date);

  const totalIncome = entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const totalSpent = entries.filter((e) => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);

  return {
    reference: `PFM-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
    from,
    to,
    totalIncome,
    totalSpent,
    entryCount: entries.length,
    entries,
    generatedAt: new Date(),
  };
}

module.exports = { computeStatement, computePfmStatement };
