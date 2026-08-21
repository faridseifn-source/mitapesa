const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { applyCap, resolveTier, computeRuleFee, validateTiers } = require("../src/lib/feeCalculations");

describe("applyCap", () => {
  test("leaves an uncapped fee unchanged", () => {
    assert.equal(applyCap(500, null, null), 500);
  });

  test("raises a fee up to the configured minimum", () => {
    assert.equal(applyCap(50, 200, null), 200);
  });

  test("caps a fee down to the configured maximum", () => {
    assert.equal(applyCap(5000, null, 2000), 2000);
  });

  test("never returns a negative fee even if inputs are odd", () => {
    assert.equal(applyCap(-100, null, null), 0);
  });

  test("rounds to two decimal places", () => {
    assert.equal(applyCap(100.005, null, null), 100.01);
  });
});

describe("resolveTier", () => {
  const tiers = [
    { minAmount: 0, maxAmount: 10000 },
    { minAmount: 10001, maxAmount: 50000 },
    { minAmount: 50001, maxAmount: null },
  ];

  test("resolves the first tier for a low amount", () => {
    assert.equal(resolveTier(tiers, 5000), tiers[0]);
  });

  test("resolves the middle tier for a mid amount", () => {
    assert.equal(resolveTier(tiers, 25000), tiers[1]);
  });

  test("resolves the unbounded top tier for a large amount", () => {
    assert.equal(resolveTier(tiers, 5000000), tiers[2]);
  });

  test("resolves nothing when no tier covers the amount (a gap)", () => {
    const gappy = [{ minAmount: 0, maxAmount: 100 }, { minAmount: 200, maxAmount: null }];
    assert.equal(resolveTier(gappy, 150), undefined);
  });
});

describe("computeRuleFee", () => {
  test("fixed model returns the fixed amount regardless of transaction amount", () => {
    assert.equal(computeRuleFee({ feeModel: "fixed", fixedAmount: 500 }, 10000), 500);
    assert.equal(computeRuleFee({ feeModel: "fixed", fixedAmount: 500 }, 999999), 500);
  });

  test("percentage model computes a straightforward percentage", () => {
    assert.equal(computeRuleFee({ feeModel: "percentage", percentage: 1 }, 10000), 100);
  });

  test("percentage model respects a fee cap", () => {
    assert.equal(computeRuleFee({ feeModel: "percentage", percentage: 1, maxFee: 2000 }, 500000), 2000);
  });

  test("percentage model respects a fee floor", () => {
    assert.equal(computeRuleFee({ feeModel: "percentage", percentage: 1, minFee: 50 }, 100), 50);
  });

  test("fixed_plus_percentage combines both components", () => {
    assert.equal(computeRuleFee({ feeModel: "fixed_plus_percentage", fixedAmount: 200, percentage: 0.5 }, 50000), 450);
  });

  test("zero model always returns 0 regardless of other fields", () => {
    assert.equal(computeRuleFee({ feeModel: "zero", fixedAmount: 999 }, 10000), 0);
  });

  test("display_only model always returns 0 (disclosed, never collected by MitaPesa)", () => {
    assert.equal(computeRuleFee({ feeModel: "display_only", percentage: 5 }, 10000), 0);
  });

  test("tiered model picks the correct band and applies that band's own fee", () => {
    const tiers = [
      { minAmount: 0, maxAmount: 10000, feeModel: "fixed", fixedAmount: 0 },
      { minAmount: 10001, maxAmount: 50000, feeModel: "fixed", fixedAmount: 500 },
      { minAmount: 50001, maxAmount: null, feeModel: "percentage", percentage: 1 },
    ];
    assert.equal(computeRuleFee({ feeModel: "tiered", tiers }, 5000), 0);
    assert.equal(computeRuleFee({ feeModel: "tiered", tiers }, 25000), 500);
    assert.equal(computeRuleFee({ feeModel: "tiered", tiers }, 100000), 1000);
  });

  test("tiered model returns 0 for a gap in coverage rather than throwing", () => {
    const gappy = [{ minAmount: 0, maxAmount: 100, feeModel: "fixed", fixedAmount: 10 }, { minAmount: 200, maxAmount: null, feeModel: "fixed", fixedAmount: 20 }];
    assert.equal(computeRuleFee({ feeModel: "tiered", tiers: gappy }, 150), 0);
  });

  test("an unrecognized fee model returns 0 rather than throwing", () => {
    assert.equal(computeRuleFee({ feeModel: "not_a_real_model" }, 10000), 0);
  });
});

describe("validateTiers", () => {
  test("accepts the spec's own worked example (off-by-one integer boundaries)", () => {
    assert.doesNotThrow(() => validateTiers([
      { minAmount: 0, maxAmount: 10000, feeModel: "fixed", fixedAmount: 0 },
      { minAmount: 10001, maxAmount: 50000, feeModel: "fixed", fixedAmount: 500 },
      { minAmount: 50001, maxAmount: null, feeModel: "percentage", percentage: 1 },
    ]));
  });

  test("accepts tiers passed out of order (sorts internally before validating)", () => {
    assert.doesNotThrow(() => validateTiers([
      { minAmount: 50001, maxAmount: null, feeModel: "percentage", percentage: 1 },
      { minAmount: 0, maxAmount: 10000, feeModel: "fixed", fixedAmount: 0 },
      { minAmount: 10001, maxAmount: 50000, feeModel: "fixed", fixedAmount: 500 },
    ]));
  });

  test("rejects an empty tier list", () => {
    assert.throws(() => validateTiers([]), /at least one tier/);
  });

  test("rejects tiers that don't start at 0", () => {
    assert.throws(() => validateTiers([{ minAmount: 100, maxAmount: null, feeModel: "fixed", fixedAmount: 0 }]), /must start at 0/);
  });

  test("rejects a genuine gap between tiers", () => {
    assert.throws(() => validateTiers([
      { minAmount: 0, maxAmount: 10000, feeModel: "fixed", fixedAmount: 0 },
      { minAmount: 15000, maxAmount: null, feeModel: "fixed", fixedAmount: 500 },
    ]), /Gap between tiers/);
  });

  test("rejects overlapping tiers", () => {
    assert.throws(() => validateTiers([
      { minAmount: 0, maxAmount: 10000, feeModel: "fixed", fixedAmount: 0 },
      { minAmount: 9000, maxAmount: null, feeModel: "fixed", fixedAmount: 500 },
    ]), /overlap/);
  });

  test("rejects a tier list where the last tier has a maximum (must be unbounded)", () => {
    assert.throws(() => validateTiers([{ minAmount: 0, maxAmount: 10000, feeModel: "fixed", fixedAmount: 0 }]), /must be unbounded/);
  });

  test("rejects a non-last tier that's unbounded", () => {
    assert.throws(() => validateTiers([
      { minAmount: 0, maxAmount: null, feeModel: "fixed", fixedAmount: 0 },
      { minAmount: 10001, maxAmount: null, feeModel: "fixed", fixedAmount: 500 },
    ]), /Only the last tier may be unbounded/);
  });

  test("rejects a negative tier fee", () => {
    assert.throws(() => validateTiers([{ minAmount: 0, maxAmount: null, feeModel: "fixed", fixedAmount: -50 }]), /negative/);
  });
});
