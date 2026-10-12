const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createFakePrisma } = require("./helpers/fakePrisma");

// Inject the fake client + a recording notifier BEFORE the modules load.
let fake = createFakePrisma();
const prismaPath = require.resolve("../src/lib/prisma");
const notifyPath = require.resolve("../src/lib/notify");
const sent = [];
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: new Proxy({}, { get: (_, p) => fake[p] }) };
require.cache[notifyPath] = { id: notifyPath, filename: notifyPath, loaded: true, exports: { notifyUser: async (userId, n) => { sent.push({ userId, ...n }); } } };

// aiUsage pulls in the payment gateway (and env/dotenv); credit purchases aren't under test.
const gwPath = require.resolve("../src/services/paymentGateway");
require.cache[gwPath] = { id: gwPath, filename: gwPath, loaded: true, exports: { getPaymentGatewayProvider: () => ({}) } };
const audPath = require.resolve("../src/lib/audit");
require.cache[audPath] = { id: audPath, filename: audPath, loaded: true, exports: { writeAudit: async () => {} } };

const R = require("../src/lib/referrals");
const { checkUsageAllowed, recordUsage } = require("../src/lib/aiUsage");

let n = 0;
async function mkUser(extra = {}) {
  n++;
  return fake.user.create({ data: { firstName: `User${n}`, lastName: "Test", email: `u${n}@example.com`, phone: `7000000${n}`, ...extra } });
}
async function setup(overrides = {}) {
  const { campaign } = await R.seedFirstCampaign("admin1");
  await fake.referralCampaign.update({ where: { id: campaign.id }, data: { status: "active", ...overrides } });
  return campaign;
}
async function signup(referrer, opts = {}) {
  const code = (await R.getOrCreateCode(referrer.id)).code;
  const referred = await mkUser();
  const res = await R.attributeSignup({ referredUser: referred, code, deviceId: opts.deviceId ?? `dev-${referred.id}`, ip: opts.ip ?? `10.0.0.${n}` });
  return { referred, res };
}
const doSteps = async (u) => {
  await R.trackEvent(u.id, "budget_created", "b1");
  for (let i = 0; i < 5; i++) await R.trackEvent(u.id, "transaction_logged", `t${i}`);
  for (const d of ["2026-10-10", "2026-10-11", "2026-10-12"]) await R.trackEvent(u.id, "daily_active", d);
};

beforeEach(() => { fake = createFakePrisma(); sent.length = 0; n = 0; });

describe("referral codes", () => {
  test("a user gets one stable code; codes are unambiguous uppercase", async () => {
    const u = await mkUser();
    const a = await R.getOrCreateCode(u.id), b = await R.getOrCreateCode(u.id);
    assert.equal(a.code, b.code);
    assert.match(a.code, /^[A-HJKMNP-Z2-9]{7}$/);
  });
  test("normalizeCode tolerates spaces, dashes and case", () => assert.equal(R.normalizeCode(" ab-c d12 "), "ABCD12"));
});

describe("attribution", () => {
  test("valid code creates a pending referral", async () => {
    await setup();
    const referrer = await mkUser();
    const { res } = await signup(referrer);
    assert.equal(res.attributed, true);
    assert.equal(res.status, "pending");
  });
  test("invalid code and no active campaign never throw, never attribute", async () => {
    const referred = await mkUser();
    assert.equal((await R.attributeSignup({ referredUser: referred, code: "ZZZZZZZ" })).attributed, false);
    await setup();
    assert.equal((await R.attributeSignup({ referredUser: referred, code: "ZZZZZZZ" })).reason, "invalid_code");
  });
  test("a customer can only ever be referred once", async () => {
    await setup();
    const a = await mkUser(), b = await mkUser();
    const { referred } = await signup(a);
    const code = (await R.getOrCreateCode(b.id)).code;
    const again = await R.attributeSignup({ referredUser: referred, code });
    assert.equal(again.attributed, false);
  });
  test("per-referrer referral cap", async () => {
    await setup({ maxReferralsPerReferrer: 1 });
    const referrer = await mkUser();
    assert.equal((await signup(referrer)).res.attributed, true);
    assert.equal((await signup(referrer)).res.reason, "referrer_limit");
  });
  test("same device as referrer is auto-rejected as self-referral", async () => {
    await setup();
    const referrer = await mkUser();
    await R.recordDevice(referrer.id, "shared-phone", "1.1.1.1");
    const { res } = await signup(referrer, { deviceId: "shared-phone" });
    assert.equal(res.status, "rejected");
  });
  test("one device behind two referred accounts is held for review", async () => {
    await setup();
    const referrer = await mkUser();
    const first = await signup(referrer, { deviceId: "farm-device" });
    assert.equal(first.res.status, "pending");
    const second = await signup(referrer, { deviceId: "farm-device" });
    assert.equal(second.res.status, "under_review");
  });
  test("blocked referrer is rejected", async () => {
    await setup();
    const referrer = await mkUser({ blockedByAdmin: true });
    assert.equal((await signup(referrer)).res.status, "rejected");
  });
});

describe("milestones & rewards", () => {
  test("welcome AI credits go to the referred customer at the budget step, once", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await R.trackEvent(referred.id, "budget_created", "b1");
    await R.trackEvent(referred.id, "budget_created", "b1"); // duplicate hook call
    const credits = await fake.aiRewardCredit.findMany({ where: { userId: referred.id } });
    assert.equal(credits.length, 1);
    assert.equal(credits[0].creditsGranted, 5);
    const ents = await fake.rewardEntitlement.findMany({ where: { userId: referred.id } });
    assert.equal(ents.length, 1);
    assert.equal(ents[0].status, "fulfilled");
  });
  test("completing every step qualifies the referral; referrer reward waits for maturity", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred);
    const ref = await fake.referral.findUnique({ where: { referredUserId: referred.id } });
    assert.equal(ref.status, "qualified");
    const mine = await fake.rewardEntitlement.findMany({ where: { userId: referrer.id } });
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, "pending_maturity");
    assert.equal(await fake.aiRewardCredit.count({ where: { userId: referrer.id } }), 0);
  });
  test("replaying every event changes nothing (idempotent)", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred); await doSteps(referred);
    assert.equal(await fake.rewardEntitlement.count({ where: { referralId: (await fake.referral.findUnique({ where: { referredUserId: referred.id } })).id } }), 2);
  });
  test("a step short of its threshold does not complete it", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    for (let i = 0; i < 4; i++) await R.trackEvent(referred.id, "transaction_logged", `t${i}`);
    const ref = await fake.referral.findUnique({ where: { referredUserId: referred.id } });
    assert.equal(ref.status, "pending");
  });
  test("events from users who were not referred are ignored and store nothing", async () => {
    await setup();
    const stranger = await mkUser();
    await R.trackEvent(stranger.id, "budget_created", "b1");
    assert.equal(await fake.referralEvent.count({}), 0);
  });
  test("maturity job releases the referrer's AI credits only after the hold", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred);
    let r = await R.processMaturity();
    assert.equal(r.released, 0);
    const ent = (await fake.rewardEntitlement.findMany({ where: { userId: referrer.id } }))[0];
    await fake.rewardEntitlement.update({ where: { id: ent.id }, data: { maturesAt: new Date(Date.now() - 1000) } });
    // spread the transactions out so the behavioural rule doesn't fire
    for (const e of await fake.referralEvent.findMany({ where: { eventName: "transaction_logged" } })) e.createdAt = new Date(Date.now() - 3 * 86400000 + Number(e.eventRef.slice(1)) * 3600000);
    r = await R.processMaturity();
    assert.equal(r.released, 1);
    assert.equal((await fake.aiRewardCredit.findMany({ where: { userId: referrer.id } }))[0].creditsGranted, 20);
    await R.processMaturity(); // run again — no double grant
    assert.equal(await fake.aiRewardCredit.count({ where: { userId: referrer.id } }), 1);
  });
  test("all transactions logged within minutes holds the referral at maturity", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred); // all events created "now" => rapid_completion
    const ent = (await fake.rewardEntitlement.findMany({ where: { userId: referrer.id } }))[0];
    await fake.rewardEntitlement.update({ where: { id: ent.id }, data: { maturesAt: new Date(Date.now() - 1000) } });
    // weight 40 alone is below hold(50); add a second signal
    await fake.fraudRule.create({ data: { key: "rapid_completion", enabled: true, weight: 60, params: { minutes: 10, minEvents: 3 } } });
    const r = await R.processMaturity();
    assert.equal(r.held, 1);
    assert.equal((await fake.referral.findUnique({ where: { referredUserId: referred.id } })).status, "under_review");
  });
  test("caps: per-referrer limit marks extra rewards capped, not fulfilled", async () => {
    await setup({ maxRewardsPerReferrer: 1 });
    const referrer = await mkUser();
    for (let i = 0; i < 2; i++) { const { referred } = await signup(referrer); await doSteps(referred); }
    const mine = await fake.rewardEntitlement.findMany({ where: { userId: referrer.id } });
    assert.deepEqual(mine.map((e) => e.status).sort(), ["capped", "pending_maturity"]);
  });
  test("campaign budget stops further rewards", async () => {
    await setup({ budgetTzs: 600 }); // welcome reward costs 500, next would exceed
    const referrer = await mkUser();
    const a = await signup(referrer), b = await signup(referrer);
    await R.trackEvent(a.referred.id, "budget_created", "b1");
    await R.trackEvent(b.referred.id, "budget_created", "b1");
    const all = await fake.rewardEntitlement.findMany({});
    assert.deepEqual(all.map((e) => e.status).sort(), ["capped", "fulfilled"]);
  });
  test("rejecting a referral cancels unfulfilled rewards and claws back unspent AI credits", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred);
    const ref = await fake.referral.findUnique({ where: { referredUserId: referred.id } });
    await R.setReferralStatus(ref.id, "rejected", "admin:a1", "fake accounts");
    const ents = await fake.rewardEntitlement.findMany({ where: { referralId: ref.id } });
    assert.ok(ents.some((e) => e.recipient === "referrer" && e.status === "cancelled"));
    assert.equal((await fake.aiRewardCredit.findMany({ where: { userId: referred.id } }))[0].status, "cancelled");
  });
  test("approving a held referral releases its rewards", async () => {
    await setup();
    const referrer = await mkUser();
    await signup(referrer, { deviceId: "d" });
    const { referred } = await signup(referrer, { deviceId: "d" }); // held
    await R.trackEvent(referred.id, "budget_created", "b1");
    const ref = await fake.referral.findUnique({ where: { referredUserId: referred.id } });
    assert.equal((await fake.rewardEntitlement.findMany({ where: { referralId: ref.id } }))[0].status, "under_review");
    await R.setReferralStatus(ref.id, "approved", "admin:a1", "legit, family");
    assert.equal((await fake.rewardEntitlement.findMany({ where: { referralId: ref.id } }))[0].status, "fulfilled");
  });
});

describe("manual fulfilment & ledger", () => {
  async function queuedReward() {
    const def = await fake.rewardDefinition.create({ data: { type: "airtime", nameEn: "TZS 1,000 airtime", nameSw: "Muda wa maongezi TZS 1,000", valueTzs: 1000, costTzs: 1000 } });
    const { campaign } = await R.seedFirstCampaign();
    await fake.referralCampaign.update({ where: { id: campaign.id }, data: { status: "active" } });
    const ms = (await fake.referralMilestone.findMany({ where: { eventName: "budget_created" } }))[0];
    await fake.referralMilestone.update({ where: { id: ms.id }, data: { referredRewardId: def.id } });
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await R.trackEvent(referred.id, "budget_created", "b1");
    return (await fake.rewardEntitlement.findMany({ where: { userId: referred.id } }))[0];
  }
  test("manual rewards land in the queue", async () => { assert.equal((await queuedReward()).status, "queued"); });
  test("fulfil is idempotent and writes the ledger once", async () => {
    const e = await queuedReward();
    assert.equal((await R.markFulfilled(e.id, { externalRef: "AIR-1", actor: "import" })).ok, true);
    assert.equal((await R.markFulfilled(e.id, { externalRef: "AIR-1", actor: "import" })).ok, false);
    const led = (await fake.rewardTransaction.findMany({ where: { entitlementId: e.id } })).map((t) => t.type);
    assert.equal(led.filter((t) => t === "fulfilled").length, 1);
    assert.ok(led.includes("created") && led.includes("queued"));
  });
  test("failed can be re-queued and then fulfilled; fulfilled can't be failed", async () => {
    const e = await queuedReward();
    assert.equal((await R.markFailed(e.id, "bad number", "admin:1")).ok, true);
    assert.equal((await R.requeue(e.id, "admin:1")).ok, true);
    assert.equal((await R.markFulfilled(e.id, { externalRef: "X" })).ok, true);
    assert.equal((await R.markFailed(e.id, "late", "admin:1")).ok, false);
  });
});

describe("CSV import parsing", () => {
  const { parseCsv } = require("../src/lib/referrals/csvParse");
  test("quotes, commas, CRLF and BOM", () => {
    const rows = parseCsv('﻿entitlement_id,result,reference,failure_reason\r\nabc,fulfilled,"A,1",\r\ndef,failed,,"no ""signal"""\r\n');
    assert.deepEqual(rows, [
      { entitlement_id: "abc", result: "fulfilled", reference: "A,1", failure_reason: "" },
      { entitlement_id: "def", result: "failed", reference: "", failure_reason: 'no "signal"' },
    ]);
  });
});

describe("AI usage integration", () => {
  async function userWithCredit(credits = 2) {
    const u = await mkUser();
    const ent = await fake.rewardEntitlement.create({ data: { idempotencyKey: `k${u.id}`, userId: u.id, recipient: "referred", campaignId: "c", referralId: "r", milestoneId: "m", rewardDefinitionId: "d", status: "fulfilled" } });
    await R.aiCredits.grantAiCredit({ userId: u.id, entitlementId: ent.id, feature: "all", credits, validDays: 30 });
    return u;
  }
  test("reward credits are offered after the free allowance and consumed only on recordUsage", async () => {
    const u = await userWithCredit(2);
    await fake.systemSetting.create({ data: { key: "voice_free_monthly_limit", value: "0" } });
    await fake.systemSetting.create({ data: { key: "voice_monthly_spend_ceiling_usd", value: "0" } });
    const chk = await checkUsageAllowed(u.id, "voice");
    assert.equal(chk.allowed, true);
    assert.match(chk.usingCreditId, /^promo:/);
    let c = (await fake.aiRewardCredit.findMany({ where: { userId: u.id } }))[0];
    assert.equal(c.creditsUsed, 0); // a failed request must cost nothing
    await recordUsage(u.id, "voice", 0.01, chk.usingCreditId);
    c = (await fake.aiRewardCredit.findMany({ where: { userId: u.id } }))[0];
    assert.equal(c.creditsUsed, 1);
  });
  test("exhausted credits stop being offered; ledger records each movement", async () => {
    const u = await userWithCredit(1);
    await fake.systemSetting.create({ data: { key: "voice_free_monthly_limit", value: "0" } });
    await fake.systemSetting.create({ data: { key: "voice_monthly_spend_ceiling_usd", value: "0" } });
    const chk = await checkUsageAllowed(u.id, "voice");
    await recordUsage(u.id, "voice", 0.01, chk.usingCreditId);
    assert.equal((await checkUsageAllowed(u.id, "voice")).allowed, false);
    const tx = await fake.aiCreditTransaction.findMany({ where: { userId: u.id } });
    assert.deepEqual(tx.map((t) => t.delta), [1, -1]);
  });
  test("two simultaneous consumptions can't spend the same last credit twice", async () => {
    const u = await userWithCredit(1);
    const c = (await fake.aiRewardCredit.findMany({ where: { userId: u.id } }))[0];
    const results = await Promise.all([R.aiCredits.consumePromoCredit(c.id), R.aiCredits.consumePromoCredit(c.id)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal((await fake.aiRewardCredit.findUnique({ where: { id: c.id } })).creditsUsed, 1);
  });
  test("expired credits are not usable and get expired by the job", async () => {
    const u = await userWithCredit(3);
    const c = (await fake.aiRewardCredit.findMany({ where: { userId: u.id } }))[0];
    c.expiresAt = new Date(Date.now() - 1000);
    assert.equal(await R.aiCredits.findActivePromoCredit(u.id, "voice"), null);
    assert.equal(await R.aiCredits.expireCredits(), 1);
    assert.equal((await fake.aiCreditTransaction.findMany({ where: { userId: u.id } })).at(-1).delta, -3);
  });
  test("a voice-only credit isn't offered for analytics", async () => {
    const u = await mkUser();
    await R.aiCredits.grantAiCredit({ userId: u.id, entitlementId: "e1", feature: "voice", credits: 2, validDays: 30 });
    assert.ok(await R.aiCredits.findActivePromoCredit(u.id, "voice"));
    assert.equal(await R.aiCredits.findActivePromoCredit(u.id, "analytics"), null);
  });
});

describe("fee waiver rewards & activation milestones", () => {
  // Turn the (normally off) activation steps on, as an admin would at Pay launch.
  async function withActivation() {
    const campaign = await setup();
    for (const m of await fake.referralMilestone.findMany({ where: { campaignId: campaign.id, active: false } })) {
      await fake.referralMilestone.update({ where: { id: m.id }, data: { active: true } });
    }
    return campaign;
  }
  const activate = async (u) => {
    await R.trackEvent(u.id, "kyc_verified", "kyc");
    await R.trackEvent(u.id, "topup_completed", "t1");
    await R.trackEvent(u.id, "payment_completed", "p1");
  };
  const matureAll = async () => {
    for (const e of await fake.rewardEntitlement.findMany({ where: { status: "pending_maturity" } })) e.maturesAt = new Date(Date.now() - 1000);
    for (const e of await fake.referralEvent.findMany({ where: { eventName: "transaction_logged" } })) e.createdAt = new Date(Date.now() - 3 * 86400000 + Number(e.eventRef.slice(1)) * 3600000);
    return R.processMaturity();
  };

  test("seeded activation steps are OFF by default and don't gate the welcome rewards", async () => {
    await setup();
    const off = await fake.referralMilestone.findMany({ where: { active: false } });
    assert.deepEqual(off.map((m) => m.eventName).sort(), ["kyc_verified", "payment_completed", "topup_completed"]);
  });

  test("with Pay on: first payment gives BOTH sides a fee waiver (FeeExemption), the inviter after the hold", async () => {
    await withActivation();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred);
    await activate(referred);
    // friend's waiver is immediate
    const friendEx = await fake.feeExemption.findMany({ where: { userId: referred.id } });
    assert.equal(friendEx.length, 1);
    assert.equal(friendEx[0].transactionTypeId, null);
    assert.ok(new Date(friendEx[0].endDate) > new Date(Date.now() + 29 * 86400000));
    // inviter's waits for maturity
    assert.equal(await fake.feeExemption.count({ where: { userId: referrer.id } }), 0);
    await matureAll();
    assert.equal(await fake.feeExemption.count({ where: { userId: referrer.id, isActive: true } }), 1);
  });

  test("with Pay off: the waiver is earned but does not start until Pay launches", async () => {
    await withActivation();
    await fake.systemSetting.create({ data: { key: "pay_module_enabled", value: "false" } });
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred); await activate(referred);
    assert.equal(await fake.feeExemption.count({}), 0);
    const ent = (await fake.rewardEntitlement.findMany({ where: { userId: referred.id } })).find((e) => e.status === "available");
    assert.ok(ent, "waiver should be waiting as 'available'");
    await R.processMaturity(); // still off
    assert.equal(await fake.feeExemption.count({}), 0);
    assert.equal((await fake.rewardTransaction.findMany({ where: { entitlementId: ent.id, type: "held" } })).length, 1);
    // Pay goes live
    (await fake.systemSetting.findUnique({ where: { key: "pay_module_enabled" } })).value = "true";
    await R.processMaturity();
    const ex = await fake.feeExemption.findMany({ where: { userId: referred.id } });
    assert.equal(ex.length, 1);
    assert.ok(new Date(ex[0].startDate) > new Date(Date.now() - 60000)); // 30 days run from launch, not from earning
    await R.processMaturity(); // idempotent
    assert.equal(await fake.feeExemption.count({ where: { userId: referred.id } }), 1);
  });

  test("activation events still count after the referral has already qualified", async () => {
    await withActivation();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred);
    // required steps done => qualified, activation not yet done
    await activate(referred);
    const prog = await fake.referralMilestoneProgress.findMany({ where: { referralId: (await fake.referral.findUnique({ where: { referredUserId: referred.id } })).id } });
    assert.equal(prog.filter((p) => p.achievedAt).length, 7);
  });

  test("rejecting the referral switches an active waiver off", async () => {
    await withActivation();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred); await activate(referred);
    const ref = await fake.referral.findUnique({ where: { referredUserId: referred.id } });
    await R.setReferralStatus(ref.id, "rejected", "admin:a", "farm");
    assert.equal((await fake.feeExemption.findMany({ where: { userId: referred.id } }))[0].isActive, false);
  });
});

describe("account deletion", () => {
  test("cancels pending rewards and retires the code", async () => {
    await setup();
    const referrer = await mkUser();
    const { referred } = await signup(referrer);
    await doSteps(referred);
    await R.onAccountDeleted(referrer.id);
    const mine = await fake.rewardEntitlement.findMany({ where: { userId: referrer.id } });
    assert.ok(mine.every((e) => e.status === "cancelled"));
    assert.equal((await fake.referralCode.findUnique({ where: { userId: referrer.id } })).active, false);
  });
});

describe("notifications", () => {
  test("sent in the recipient's language", async () => {
    await setup();
    const referrer = await mkUser({ language: "sw" });
    await signup(referrer);
    assert.ok(sent.some((s) => s.userId === referrer.id && /Rafiki amejiunga/.test(s.title)));
  });
});
