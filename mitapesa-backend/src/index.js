const app = require("./app");
const env = require("./lib/env");
const { processBundleRenewals } = require("./lib/bundleLifecycle");
const { purgeExpiredArchives } = require("./lib/accountArchive");

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

// Retention for deleted accounts: once an archive's window runs out, its
// personal data is permanently erased. Hourly is plenty — the window is
// measured in days — and the same single-instance caveat as above applies.
// It also runs shortly after boot, so a service that was asleep or redeploying
// when an archive came due catches up instead of waiting for the next tick.
const ARCHIVE_PURGE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const runArchivePurge = () =>
  purgeExpiredArchives()
    .then((r) => { if (r.purged) console.log(`Archive retention: erased ${r.purged} expired archive(s)`); }) // eslint-disable-line no-console
    .catch((err) => console.error("Archive retention job failed:", err)); // eslint-disable-line no-console
setInterval(runArchivePurge, ARCHIVE_PURGE_INTERVAL_MS);
setTimeout(runArchivePurge, 60 * 1000);
