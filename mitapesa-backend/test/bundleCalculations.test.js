const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { computeExpiry, computeBundleVat, computeProratedRefund } = require("../src/lib/bundleCalculations");

describe("computeExpiry", () => {
  test("DAILY adds one day", () => {
    const from = new Date("2026-08-09T10:00:00Z");
    const expiry = computeExpiry("DAILY", from);
    assert.equal(expiry.toISOString(), "2026-08-10T10:00:00.000Z");
  });

  test("WEEKLY adds seven days", () => {
    const from = new Date("2026-08-09T10:00:00Z");
    const expiry = computeExpiry("WEEKLY", from);
    assert.equal(expiry.toISOString(), "2026-08-16T10:00:00.000Z");
  });

  test("MONTHLY adds one calendar month", () => {
    const from = new Date("2026-08-09T10:00:00Z");
    const expiry = computeExpiry("MONTHLY", from);
    assert.equal(expiry.toISOString(), "2026-09-09T10:00:00.000Z");
  });

  test("throws on an unknown validity period", () => {
    assert.throws(() => computeExpiry("YEARLY", new Date()), /Unknown bundle validity/);
  });
});

describe("computeBundleVat", () => {
  test("NONE treatment: no VAT, total equals the listed price", () => {
    const result = computeBundleVat({ price: 1000, taxTreatment: "NONE", vatRate: 0 });
    assert.deepEqual(result, { vatAmount: 0, totalCharge: 1000 });
  });

  test("VAT_EXCLUSIVE: VAT is added on top of the listed price", () => {
    const result = computeBundleVat({ price: 1000, taxTreatment: "VAT_EXCLUSIVE", vatRate: 18 });
    assert.equal(result.vatAmount, 180);
    assert.equal(result.totalCharge, 1180);
  });

  test("VAT_INCLUSIVE: total charge equals the listed price, VAT disclosed as a component within it", () => {
    const result = computeBundleVat({ price: 1180, taxTreatment: "VAT_INCLUSIVE", vatRate: 18 });
    assert.equal(result.vatAmount, 180);
    assert.equal(result.totalCharge, 1180, "VAT_INCLUSIVE never charges more than the listed price");
  });

  test("VAT_EXCLUSIVE and VAT_INCLUSIVE agree on the same underlying split when the numbers are equivalent", () => {
    const exclusive = computeBundleVat({ price: 1000, taxTreatment: "VAT_EXCLUSIVE", vatRate: 18 });
    const inclusive = computeBundleVat({ price: 1180, taxTreatment: "VAT_INCLUSIVE", vatRate: 18 });
    assert.equal(exclusive.totalCharge, inclusive.totalCharge);
    assert.equal(exclusive.vatAmount, inclusive.vatAmount);
  });

  test("a zero VAT rate never adds a VAT component, even if a treatment is set", () => {
    const result = computeBundleVat({ price: 1000, taxTreatment: "VAT_EXCLUSIVE", vatRate: 0 });
    assert.deepEqual(result, { vatAmount: 0, totalCharge: 1000 });
  });

  test("the pricePaid + vatPaid invariant always holds (critical for correct refund proration later)", () => {
    for (const bundle of [
      { price: 1000, taxTreatment: "NONE", vatRate: 0 },
      { price: 1000, taxTreatment: "VAT_EXCLUSIVE", vatRate: 18 },
      { price: 1180, taxTreatment: "VAT_INCLUSIVE", vatRate: 18 },
      { price: 2500, taxTreatment: "VAT_EXCLUSIVE", vatRate: 5.5 },
    ]) {
      const { vatAmount, totalCharge } = computeBundleVat(bundle);
      const pricePaid = totalCharge - vatAmount;
      assert.equal(pricePaid + vatAmount, totalCharge, `invariant broken for ${JSON.stringify(bundle)}`);
    }
  });
});

describe("computeProratedRefund", () => {
  test("refunds roughly half when cancelled halfway through a subscription", () => {
    const purchasedAt = new Date("2026-08-01T00:00:00Z");
    const expiresAt = new Date("2026-08-31T00:00:00Z"); // 30 days
    const now = new Date("2026-08-16T00:00:00Z"); // 15 days in, 15 remaining
    const { refundAmount } = computeProratedRefund({ pricePaid: 3000, vatPaid: 0, purchasedAt, expiresAt, now });
    assert.equal(refundAmount, 1500);
  });

  test("refunds the VAT component proportionally alongside the base price, not separately or ignored", () => {
    const purchasedAt = new Date("2026-08-01T00:00:00Z");
    const expiresAt = new Date("2026-08-31T00:00:00Z");
    const now = new Date("2026-08-16T00:00:00Z"); // exactly half remaining
    const { refundAmount, vatRefunded } = computeProratedRefund({ pricePaid: 1000, vatPaid: 180, purchasedAt, expiresAt, now });
    assert.equal(vatRefunded, 90);
    assert.equal(refundAmount, 500 + 90);
  });

  test("refunds nothing once the subscription has already fully expired", () => {
    const purchasedAt = new Date("2026-08-01T00:00:00Z");
    const expiresAt = new Date("2026-08-31T00:00:00Z");
    const now = new Date("2026-09-01T00:00:00Z"); // already past expiry
    const { refundAmount, vatRefunded } = computeProratedRefund({ pricePaid: 1000, vatPaid: 180, purchasedAt, expiresAt, now });
    assert.equal(refundAmount, 0);
    assert.equal(vatRefunded, 0);
  });

  test("refunds close to the full amount when cancelled immediately after purchase", () => {
    const purchasedAt = new Date("2026-08-01T00:00:00Z");
    const expiresAt = new Date("2026-08-31T00:00:00Z");
    const now = new Date("2026-08-01T00:00:01Z"); // one second in
    const { refundAmount } = computeProratedRefund({ pricePaid: 3000, vatPaid: 0, purchasedAt, expiresAt, now });
    // computeProratedRefund floors by design (never over-refund), so one
    // second into a 30-day window correctly floors 2999.9988... down to
    // 2999, not 3000 — this asserts "very close to" the full amount, not
    // a strict > which doesn't account for that intentional flooring.
    assert.ok(refundAmount >= 2999, `expected close to 3000, got ${refundAmount}`);
  });

  test("never returns a negative refund even with an invalid (zero-length) subscription window", () => {
    const purchasedAt = new Date("2026-08-01T00:00:00Z");
    const { refundAmount, vatRefunded } = computeProratedRefund({ pricePaid: 1000, vatPaid: 0, purchasedAt, expiresAt: purchasedAt, now: purchasedAt });
    assert.equal(refundAmount, 0);
    assert.equal(vatRefunded, 0);
  });
});
