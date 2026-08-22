const { ExchangeRateProvider } = require("./ExchangeRateProvider");
const prisma = require("../../lib/prisma");

/**
 * Admin-editable rates, always relative to TZS — this is the sensible
 * default provider precisely because it needs no external API key or
 * network access to work at all. An admin enters rates directly (Admin
 * Portal -> Exchange Rates), and the whole multi-currency feature works
 * immediately, with no signup step anywhere. Switching to a live rate API
 * later (EXCHANGE_RATE_PROVIDER=exchangerate_api) needs no code or
 * schema change — this and that provider share the same interface.
 */
class ManualExchangeRateProvider extends ExchangeRateProvider {
  async getRate(from, to) {
    if (from === to) return 1;

    const currencies = [...new Set([from, to].filter((c) => c !== "TZS"))];
    const rows = await prisma.manualExchangeRate.findMany({ where: { currency: { in: currencies } } });
    const rateToTZS = Object.fromEntries(rows.map((r) => [r.currency, Number(r.rateToTZS)]));
    rateToTZS.TZS = 1;

    if (rateToTZS[from] === undefined) throw new Error(`No manual exchange rate configured for ${from} — set one in the Admin Portal.`);
    if (rateToTZS[to] === undefined) throw new Error(`No manual exchange rate configured for ${to} — set one in the Admin Portal.`);

    // Both rates are "1 unit of X = N TZS" — converting from -> to means
    // going through TZS as the common anchor: amount_from * (from->TZS) / (to->TZS)
    return rateToTZS[from] / rateToTZS[to];
  }
}

module.exports = { ManualExchangeRateProvider };
