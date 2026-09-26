const app = require("./app");
const env = require("./lib/env");
const { processBundleRenewals } = require("./lib/bundleLifecycle");

app.listen(env.port, () => {
  console.log(`MitaPesa API listening on :${env.port} [${env.nodeEnv}]`); // eslint-disable-line no-console
  console.log(
    `Providers -> kyc:${env.providers.kyc} rail:${env.providers.paymentsRail} funding:${env.providers.cardFunding} issuing:${env.providers.cardIssuing}`
  ); // eslint-disable-line no-console
});

// Lightweight in-process scheduler for bundle auto-renewal — no separate
// cron service needed. Tied to this web process's uptime, which is
// sufficient for a single always-on Render web service; if this ever runs
// across multiple instances, this should move to a proper job queue with
// locking to avoid double-processing the same subscription.
const BUNDLE_RENEWAL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  processBundleRenewals().catch((err) => console.error("Bundle renewal job failed:", err)); // eslint-disable-line no-console
}, BUNDLE_RENEWAL_INTERVAL_MS);
