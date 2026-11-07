const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createFakePrisma } = require("./helpers/fakePrisma");

let fake = createFakePrisma();
const prismaPath = require.resolve("../src/lib/prisma");
const pushPath = require.resolve("../src/lib/push");
const pushed = [];
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: new Proxy({}, { get: (_, p) => fake[p] }) };
require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: { sendPushToUser: async (userId, p) => { pushed.push({ userId, ...p }); } } };

const R = require("../src/lib/reminders");

// 2026-11-09 is a Monday. Tanzania = UTC+3, so 20:05 local = 17:05 UTC.
const at = (hhmmLocal, date = "2026-11-09") => {
  const [h, m] = hhmmLocal.split(":").map(Number);
  return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - 3, m));
};

let n = 0;
async function mkUser(extra = {}) {
  n++;
  const u = await fake.user.create({ data: { firstName: `Amina${n}`, lastName: "T", email: `r${n}@x.com`, phone: `7100000${n}`, ...extra } });
  await fake.pushDeviceToken.create({ data: { userId: u.id, token: `tok${n}`, platform: "ios" } });
  return u;
}
const logExpense = (userId, when, source = "manual") =>
  fake.transaction.create({ data: { loggedByUserId: userId, source, createdAt: when, amount: -1000 } }).then(async (t) => { t.createdAt = when; return t; });

describe("daily expense reminder", () => {
  beforeEach(() => { fake = createFakePrisma(); pushed.length = 0; });

  test("sends once at the default time to a customer who logged nothing", async () => {
    const u = await mkUser();
    const r = await R.processReminders(at("20:05"));
    assert.equal(r.sent, 1);
    assert.equal(pushed[0].userId, u.id);
    assert.match(pushed[0].body, /Amina/);
    // same day again (next 15-minute tick) -> nothing
    assert.equal((await R.processReminders(at("20:20"))).sent, 0);
    assert.equal(pushed.length, 1);
  });

  test("does not send before the chosen time or long after it", async () => {
    await mkUser();
    assert.equal((await R.processReminders(at("19:45"))).sent, 0);
    assert.equal((await R.processReminders(at("23:30"))).sent, 0); // beyond 3h catch-up window
    assert.equal(pushed.length, 0);
  });

  test("uses the customer's own time and sends a catch-up within the window", async () => {
    const u = await mkUser();
    await R.saveReminder(u.id, { time: "18:30" });
    assert.equal((await R.processReminders(at("18:00"))).sent, 0);
    assert.equal((await R.processReminders(at("19:40"))).sent, 1); // service was restarting; still inside 3h
  });

  test("skips a customer who already logged an expense today, but not card activity", async () => {
    const a = await mkUser();
    await logExpense(a.id, at("12:00"));
    const b = await mkUser();
    await logExpense(b.id, at("12:00"), "lipa"); // payment rail, not the customer logging
    const r = await R.processReminders(at("20:05"));
    assert.equal(r.skippedLoggedToday, 1);
    assert.equal(r.sent, 1);
    assert.equal(pushed[0].userId, b.id);
  });

  test("respects disabled, chosen weekdays, blocked and deleted accounts, no device", async () => {
    const off = await mkUser(); await R.saveReminder(off.id, { enabled: false });
    const tue = await mkUser(); await R.saveReminder(tue.id, { days: [2] }); // Tuesday only; today is Monday
    await mkUser({ blockedByAdmin: true });
    await mkUser({ deletedAt: new Date() });
    await fake.user.create({ data: { firstName: "NoDevice", lastName: "T", email: "nd@x.com", phone: "71999999" } });
    const mon = await mkUser(); await R.saveReminder(mon.id, { days: [1] });
    const r = await R.processReminders(at("20:05"));
    assert.equal(r.sent, 1);
    assert.equal(pushed[0].userId, mon.id);
  });

  test("master switch off sends nothing", async () => {
    await mkUser();
    await fake.systemSetting.create({ data: { key: "reminder_enabled", value: "false" } });
    assert.equal((await R.processReminders(at("20:05"))).sent, 0);
  });

  test("Swahili customers get Swahili text", async () => {
    await mkUser({ language: "sw" });
    await R.processReminders(at("20:05"));
    assert.match(pushed[0].title, /Ukumbusho/);
  });

  test("pauses after 7 ignored reminders and resumes once an expense is logged", async () => {
    const u = await mkUser();
    for (let d = 9; d < 16; d++) await R.processReminders(at("20:05", `2026-11-${String(d).padStart(2, "0")}`));
    assert.equal(pushed.length, 7);
    assert.equal((await R.processReminders(at("20:05", "2026-11-16"))).skippedPaused, 1); // 8th day: paused
    assert.equal(pushed.length, 7);
    await logExpense(u.id, at("09:00", "2026-11-17")); // customer is back
    assert.equal((await R.processReminders(at("20:05", "2026-11-18"))).sent, 1);
  });

  test("changing the setting ends a pause", async () => {
    const u = await mkUser();
    for (let d = 9; d < 17; d++) await R.processReminders(at("20:05", `2026-11-${String(d).padStart(2, "0")}`));
    assert.equal(pushed.length, 7);
    await R.saveReminder(u.id, { enabled: true });
    assert.equal((await R.processReminders(at("20:05", "2026-11-17"))).sent, 1);
  });

  test("saveReminder keeps unspecified fields and getReminder reports defaults and device", async () => {
    const u = await mkUser();
    let g = await R.getReminder(u.id);
    assert.deepEqual([g.enabled, g.time, g.days, g.hasPushDevice], [true, "20:00", [], true]);
    await R.saveReminder(u.id, { time: "07:15", days: [1, 3, 1] });
    g = await R.saveReminder(u.id, { enabled: false });
    assert.deepEqual([g.enabled, g.time, g.days], [false, "07:15", [1, 3]]);
  });

  test("notification text carries no financial detail", async () => {
    await mkUser();
    await R.processReminders(at("20:05"));
    assert.doesNotMatch(pushed[0].body, /TZS|\d{3,}|balance/i);
  });
});
