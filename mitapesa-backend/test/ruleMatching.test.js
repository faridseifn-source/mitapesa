const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { ruleMatches, specificity, startOfDay } = require("../src/lib/feeCalculations");

const baseRule = () => ({
  status: "ACTIVE",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
  minAmount: null, maxAmount: null,
  channel: null, onUsOffUs: null, customerSegment: null, accountType: null,
  merchantCategory: null, currency: null, customerId: null,
});

const now = new Date("2026-08-09T12:00:00Z");
const baseCtx = () => ({ amount: 15000, channel: "MOBILE_APP", onUsOffUs: "ON_US", currency: "TZS", userId: "user-1" });

describe("ruleMatches - status and dates", () => {
  test("a non-ACTIVE rule never matches, regardless of everything else", () => {
    assert.equal(ruleMatches({ ...baseRule(), status: "DRAFT" }, baseCtx(), now), false);
  });

  test("a rule effective in the future doesn't match yet", () => {
    assert.equal(ruleMatches({ ...baseRule(), effectiveFrom: new Date("2099-01-01") }, baseCtx(), now), false);
  });

  test("a rule with an expired effectiveTo doesn't match anymore", () => {
    assert.equal(ruleMatches({ ...baseRule(), effectiveTo: new Date("2020-01-01") }, baseCtx(), now), false);
  });

  test("a rule effective 'today' matches for the whole day regardless of exact hour", () => {
    const rule = { ...baseRule(), effectiveFrom: new Date("2026-08-09T23:00:00Z") };
    const earlyNow = new Date("2026-08-09T01:00:00Z");
    assert.equal(ruleMatches(rule, baseCtx(), earlyNow), true);
  });
});

describe("ruleMatches - the Channel field, regression coverage for a real bug", () => {
  // A free-text Channel field with a typo (extra space, wrong case) once
  // silently broke matching with no error shown anywhere — the field is a
  // dropdown in the admin UI now specifically to prevent this, but this
  // test locks in the underlying matching behavior regardless of how the
  // value got there.
  test("an exact channel match succeeds", () => {
    assert.equal(ruleMatches({ ...baseRule(), channel: "MOBILE_APP" }, baseCtx(), now), true);
  });

  test("a mismatched channel value fails silently (returns false, not an error) - exactly the historical bug", () => {
    assert.equal(ruleMatches({ ...baseRule(), channel: "mobile_app" }, baseCtx(), now), false, "case mismatch must not match");
    assert.equal(ruleMatches({ ...baseRule(), channel: "MOBILE_APP " }, baseCtx(), now), false, "trailing space must not match");
  });

  test("a blank/null channel on the rule matches any channel (wildcard)", () => {
    assert.equal(ruleMatches({ ...baseRule(), channel: null }, baseCtx(), now), true);
  });
});

describe("ruleMatches - other matching dimensions", () => {
  test("amount below the rule's minAmount doesn't match", () => {
    assert.equal(ruleMatches({ ...baseRule(), minAmount: 20000 }, baseCtx(), now), false);
  });

  test("amount above the rule's maxAmount doesn't match", () => {
    assert.equal(ruleMatches({ ...baseRule(), maxAmount: 10000 }, baseCtx(), now), false);
  });

  test("amount within min/max bounds matches", () => {
    assert.equal(ruleMatches({ ...baseRule(), minAmount: 10000, maxAmount: 20000 }, baseCtx(), now), true);
  });

  test("on-us/off-us mismatch fails to match", () => {
    assert.equal(ruleMatches({ ...baseRule(), onUsOffUs: "OFF_US" }, baseCtx(), now), false);
  });

  test("a rule scoped to a specific customer only matches that customer", () => {
    const rule = { ...baseRule(), customerId: "user-1" };
    assert.equal(ruleMatches(rule, baseCtx(), now), true);
    assert.equal(ruleMatches(rule, { ...baseCtx(), userId: "user-2" }, now), false);
  });

  test("every wildcard (all null) dimension matches any context", () => {
    assert.equal(ruleMatches(baseRule(), baseCtx(), now), true);
  });
});

describe("specificity", () => {
  test("a rule with no dimensions set has specificity 0", () => {
    assert.equal(specificity(baseRule()), 0);
  });

  test("each pinned-down dimension adds one to specificity", () => {
    assert.equal(specificity({ ...baseRule(), channel: "MOBILE_APP" }), 1);
    assert.equal(specificity({ ...baseRule(), channel: "MOBILE_APP", onUsOffUs: "ON_US" }), 2);
  });

  test("an individual customer exception is maximally specific relative to a general rule", () => {
    const general = baseRule();
    const specific = { ...baseRule(), customerId: "user-1" };
    assert.ok(specificity(specific) > specificity(general));
  });
});

describe("startOfDay", () => {
  test("normalizes a timestamp to midnight UTC of the same day", () => {
    const d = new Date("2026-08-09T17:42:13Z");
    assert.equal(startOfDay(d).toISOString(), "2026-08-09T00:00:00.000Z");
  });

  test("two timestamps on the same UTC day normalize to the same instant", () => {
    const a = startOfDay(new Date("2026-08-09T00:00:01Z"));
    const b = startOfDay(new Date("2026-08-09T23:59:59Z"));
    assert.equal(a.getTime(), b.getTime());
  });
});
