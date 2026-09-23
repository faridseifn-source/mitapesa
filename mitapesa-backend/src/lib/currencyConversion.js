const { getExchangeRateProvider } = require("../services/exchange-rate");

/**
 * Converts an amount from one currency into another, returning both the
 * converted amount and the original-currency fields for transparency.
 * Returns originals as null when no conversion was needed (source and
 * target already match) — that nullness is itself meaningful: it's how
 * the rest of the app tells "this was always in that currency" apart
 * from "this was converted from something else."
 */
async function convertCurrency({ amount, from, to }) {
  if (!from || from === to) {
    return { amount, originalAmount: null, originalCurrency: null, exchangeRate: null };
  }
  const rate = await getExchangeRateProvider().getRate(from, to);
  const converted = Math.round(amount * rate * 100) / 100;
  return { amount: converted, originalAmount: amount, originalCurrency: from, exchangeRate: rate };
}

/**
 * Every transaction is stored in TZS, always — regardless of the
 * customer's currently-selected running currency. TZS is the app's one
 * real anchor: it's what the actual wallet balance holds, and what every
 * real payment rail (TIPS/GePG/LUKU) settles in. Storing in TZS
 * unconditionally means changing a customer's display currency is
 * instant and retroactive for every past transaction — there's nothing
 * to rewrite, since the stored value never depended on the preference in
 * the first place. Display-time conversion (TZS -> whatever the customer
 * has currently selected) happens separately — see
 * getDisplayCurrencyRate below and the frontend's currency formatting.
 */
async function convertToTZS({ amount, currency }) {
  return convertCurrency({ amount, from: currency, to: "TZS" });
}

/**
 * The rate to convert a stored TZS amount into the customer's currently
 * selected display currency — e.g. rate=2600 for USD means divide a TZS
 * amount by 2600 to show it in USD. Returns 1 for TZS itself, so the
 * caller never needs a special case for "customer hasn't changed
 * anything."
 */
async function getDisplayCurrencyRate(preferredCurrency) {
  if (!preferredCurrency || preferredCurrency === "TZS") return 1;
  return getExchangeRateProvider().getRate(preferredCurrency, "TZS");
}

module.exports = { convertCurrency, convertToTZS, getDisplayCurrencyRate };
