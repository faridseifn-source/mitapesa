const prisma = require("./prisma");
const { getSetting } = require("./settings");
const { sendPushToUser } = require("./push");

/**
 * Daily "log today's expenses" reminder.
 *
 * The server decides when to send (not the phone), so a customer who has not
 * opened the app still gets nudged. Rules, in one place:
 *  - only customers with a registered device (native token or web push);
 *  - at most one reminder per local day, at/after their chosen time, and only
 *    within reminder_catchup_hours of it (so a restart can catch up, but a
 *    reminder never lands in the middle of the night);
 *  - skipped when the customer has already logged an expense today (their own
 *    manual/scan/voice/import entries — card activity does not count);
 *  - paused after reminder_max_ignored reminders in a row with nothing logged
 *    afterwards, and resumed as soon as they log something or change the setting;
 *  - the text never contains amounts, balances or any financial detail.
 */

const MANUAL_SOURCES = ["manual", "scan", "voice", "import"];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BATCH_LIMIT = 1000;

const MESSAGES = {
  en: [
    (n) => `Hi ${n}, did you spend anything today? Add it now — it takes a few seconds.`,
    (n) => `${n}, a quick check-in: have today's expenses been recorded?`,
    (n) => `Keep your budget accurate, ${n}. Log today's spending before you forget.`,
  ],
  sw: [
    (n) => `Habari ${n}, umetumia chochote leo? Kiandike sasa — ni sekunde chache tu.`,
    (n) => `${n}, ukumbusho mfupi: matumizi ya leo yameandikwa?`,
    (n) => `Weka bajeti yako sahihi, ${n}. Andika matumizi ya leo kabla hujasahau.`,
  ],
};
const TITLE = { en: "MitaPesa reminder", sw: "Ukumbusho wa MitaPesa" };

function reminderText(user, dayOfYear) {
  const lang = user.language === "sw" ? "sw" : "en";
  const variants = MESSAGES[lang];
  const name = (user.firstName || "").trim() || (lang === "sw" ? "rafiki" : "there");
  return { title: TITLE[lang], body: variants[dayOfYear % variants.length](name) };
}

function parseDays(str) {
  if (!str) return [];
  return str.split(",").map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

async function numberSetting(key, fallback) {
  const v = Number(await getSetting(key));
  return Number.isFinite(v) ? v : fallback;
}

// "Today" for the customer: the calendar day in the configured UTC offset.
function localClock(now, offsetMin) {
  const local = new Date(now.getTime() + offsetMin * 60000);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate();
  const startOfDayUtc = new Date(Date.UTC(y, m, d) - offsetMin * 60000);
  const dayOfYear = Math.floor((Date.UTC(y, m, d) - Date.UTC(y, 0, 0)) / 86400000);
  return {
    dateKey: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    weekday: local.getUTCDay(),
    startOfDayUtc,
    dayOfYear,
  };
}

const loggedSince = (userId, since) =>
  prisma.transaction.count({ where: { loggedByUserId: userId, source: { in: MANUAL_SOURCES }, createdAt: { gt: since } } });

async function processReminders(now = new Date()) {
  const result = { checked: 0, sent: 0, skippedLoggedToday: 0, skippedPaused: 0 };
  if ((await getSetting("reminder_enabled")) === "false") return result;

  const defaultTime = TIME_RE.test(String(await getSetting("reminder_default_time"))) ? String(await getSetting("reminder_default_time")) : "20:00";
  const maxIgnored = await numberSetting("reminder_max_ignored", 7);
  const catchupMin = (await numberSetting("reminder_catchup_hours", 3)) * 60;
  const clock = localClock(now, await numberSetting("reminder_utc_offset_minutes", 180));

  // Customers who can actually receive a push.
  const [tokens, subs] = await Promise.all([prisma.pushDeviceToken.findMany({}), prisma.pushSubscription.findMany({})]);
  const ids = [...new Set([...tokens, ...subs].map((r) => r.userId))];
  if (!ids.length) return result;

  const [users, settings] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids }, deletedAt: null, blockedByAdmin: false } }),
    prisma.reminderSetting.findMany({ where: { userId: { in: ids } } }),
  ]);
  const byUser = new Map(settings.map((s) => [s.userId, s]));

  for (const user of users) {
    if (user.role && user.role !== "customer") continue;
    if (result.checked >= BATCH_LIMIT) break;
    const s = byUser.get(user.id) || { enabled: true, time: defaultTime, days: "", lastSentAt: null, lastSentDate: null, ignoredCount: 0 };
    if (!s.enabled) continue;
    const days = parseDays(s.days);
    if (days.length && !days.includes(clock.weekday)) continue;
    const at = toMinutes(s.time || defaultTime);
    if (clock.minutes < at || clock.minutes >= at + catchupMin) continue;
    if (s.lastSentDate === clock.dateKey) continue;
    result.checked++;

    if ((await loggedSince(user.id, clock.startOfDayUtc)) > 0) { result.skippedLoggedToday++; continue; }

    // Was the previous reminder ignored? (nothing logged since it was sent)
    const previousIgnored = s.lastSentAt ? (await loggedSince(user.id, s.lastSentAt)) === 0 : false;
    const ignored = previousIgnored ? (s.ignoredCount || 0) + 1 : 0;
    if (maxIgnored > 0 && ignored >= maxIgnored) { result.skippedPaused++; continue; }

    const { title, body } = reminderText(user, clock.dayOfYear);
    await sendPushToUser(user.id, { title, body, url: "/" });
    await prisma.reminderSetting.upsert({
      where: { userId: user.id },
      update: { lastSentAt: now, lastSentDate: clock.dateKey, ignoredCount: ignored },
      create: { userId: user.id, enabled: true, time: s.time || defaultTime, days: s.days || "", lastSentAt: now, lastSentDate: clock.dateKey, ignoredCount: ignored },
    });
    result.sent++;
  }
  return result;
}

async function getReminder(userId) {
  const [row, defaultTime, tokens, subs, master] = await Promise.all([
    prisma.reminderSetting.findUnique({ where: { userId } }),
    getSetting("reminder_default_time"),
    prisma.pushDeviceToken.count({ where: { userId } }),
    prisma.pushSubscription.count({ where: { userId } }),
    getSetting("reminder_enabled"),
  ]);
  return {
    enabled: row ? row.enabled : true,
    time: row ? row.time : TIME_RE.test(String(defaultTime)) ? String(defaultTime) : "20:00",
    days: row ? parseDays(row.days) : [],
    hasPushDevice: tokens + subs > 0,
    availableSystemWide: master !== "false",
  };
}

// Saving a setting also restarts the "ignored" count — the customer just
// told us they want reminders, so a pause from past ignored ones ends.
async function saveReminder(userId, { enabled, time, days }) {
  const current = await getReminder(userId);
  const next = {
    enabled: enabled === undefined ? current.enabled : enabled,
    time: time === undefined ? current.time : time,
    days: days === undefined ? current.days : [...new Set(days)].sort(),
  };
  const data = { enabled: next.enabled, time: next.time, days: next.days.join(","), ignoredCount: 0, lastSentAt: null };
  await prisma.reminderSetting.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  return getReminder(userId);
}

module.exports = { processReminders, getReminder, saveReminder, reminderText, TIME_RE };
