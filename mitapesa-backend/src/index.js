const app = require("./app");
const env = require("./lib/env");
const { processBundleRenewals } = require("./lib/bundleLifecycle");
const { purgeExpiredArchives } = require("./lib/accountArchive");
const { processMaturity: processReferralRewards } = require("./lib/referrals");
const { processReminders } = require("./lib/reminders");

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

// Referral rewards: release matured rewards (after a second fraud check) and
// expire old AI credits. Hourly is plenty — maturity is measured in days.
// Same single-instance caveat as the jobs above; every step is guarded by
// status transitions so an accidental overlap can't double-issue.
const REFERRAL_JOB_INTERVAL_MS = 60 * 60 * 1000;
const runReferralJob = () =>
  processReferralRewards()
    .then((r) => { if (r.released || r.held || r.cancelled || r.expiredCredits) console.log("Referral rewards:", JSON.stringify(r)); }) // eslint-disable-line no-console
    .catch((err) => console.error("Referral reward job failed:", err)); // eslint-disable-line no-console
setInterval(runReferralJob, REFERRAL_JOB_INTERVAL_MS);
setTimeout(runReferralJob, 90 * 1000);

// Daily expense reminder: every 15 minutes, send the reminder to customers whose
// chosen time has arrived and who have not logged an expense today (see
// lib/reminders.js). At most one a day per customer, so an overlap or a
// restart cannot double-send. Same single-instance caveat as above — and the
// service must stay awake, since a sleeping instance sends nothing.
const REMINDER_JOB_INTERVAL_MS = 15 * 60 * 1000;
const runReminderJob = () =>
  processReminders()
    .then((r) => { if (r.sent) console.log("Reminders:", JSON.stringify(r)); }) // eslint-disable-line no-console
    .catch((err) => console.error("Reminder job failed:", err)); // eslint-disable-line no-console
setInterval(runReminderJob, REMINDER_JOB_INTERVAL_MS);
setTimeout(runReminderJob, 2 * 60 * 1000);
