# QR Payments — design reference

Built against the **BOT TANQR Code Standard 2022** (Bank of Tanzania,
based on the EMVCo Merchant-Presented QR Specification). This document
covers the backend that's built, what's simulated vs. genuinely real, and
what's still needed for the customer-facing scanner and admin tooling.

## What's real (not simulated)

- **`lib/tanqr.js`** — a genuine TANQR/EMVCo payload parser. Validated
  byte-for-byte against the standard's own worked example (Annex 3,
  §2 — a Dodoma restaurant QR), including full CRC-16/CCITT-FALSE
  checksum verification (polynomial `0x1021`, initial value `0xFFFF`).
  Rejects tampered payloads, non-TIPS QR codes, non-TZS currencies, and
  malformed TLV structures with customer-safe error messages.
- On-us/off-us determination is genuinely computed by comparing the QR's
  Acquirer ID (5-digit TIPS-assigned code, TANQR Annex 3) against our own
  partner bank's Acquirer ID — a real `SystemSetting`, not hardcoded.
- The full transaction state machine, idempotency, and automatic reversal
  logic are real and will work identically once the CBS/TIPS providers
  below are swapped for real ones — nothing about the orchestration itself
  is a placeholder.

## What's simulated (and how)

| Component | Real system | Simulation |
|---|---|---|
| Core Banking System | Partner bank's CBS | `services/cbs/MockCbsProvider.js` — its own independent ledger table (`CbsLedgerEntry`), so reconciliation is a genuine cross-system check |
| TIPS rail | Bank of Tanzania TIPS | `services/tips/MockTipsProvider.js` — same pattern, `TipsLedgerEntry` |

Both follow the same provider-adapter pattern as every other integration in
this app (KYC, card issuing, payments rail): a real implementation is a
new class satisfying the same interface (`CbsProvider`, `TipsProvider`),
selected via `CBS_PROVIDER` / `TIPS_RAIL_PROVIDER` env vars — the rest of
the app doesn't change.

**Testing failure/reversal paths**: `cbs_simulated_failure_rate` and
`tips_simulated_failure_rate` are admin-configurable settings (0-100,
default 0) that inject simulated failures, so the reversal logic can
actually be exercised rather than only ever seeing the happy path.

**Pending resolution**: a real off-us payment can come back from TIPS as
"pending" rather than an immediate final answer. Since the mock resolves
synchronously, `getPaymentStatus()` simulates the eventual response by
resolving anything still pending after 30 seconds. A real integration
replaces this timer with acting on TIPS's actual webhook/poll response.

## Transaction lifecycle (`QrPayment.stage`)

```
initiated → wallet_held → cbs_posted → settlement_debited
  on-us:  → merchant_credited → completed
  off-us: → tips_initiated → tips_routed → awaiting_acquirer_response → completed
any stage → failed → reversed
```

Every transition is written to `QrPaymentEvent` — the complete per-stage
audit trail. The wallet is only ever left debited if the flow reaches
`completed`; any failure along the way triggers `reversePayment()`
(credits the wallet back, reverses any CBS postings already made) before
the request returns.

## Reconciliation

`lib/reconciliation.js` runs a daily comparison across the three
independent ledgers (wallet `Transaction`, `CbsLedgerEntry`,
`TipsLedgerEntry`), flagging into `ReconciliationException`:
- A completed payment with no matching CBS settlement entry
- An amount mismatch between wallet and CBS
- An on-us payment where the merchant was never credited
- An off-us payment with no completed TIPS entry
- A reversed payment with no CBS reversal entry
- A payment stuck in `processing` for over 10 minutes

Exposed via `POST /admin/reconciliation/run` (super admin) and
`GET/PATCH /admin/reconciliation/exceptions` (support tier and above).

## API surface

- `POST /qr/resolve` — parse + validate a scanned payload, return merchant
  details for display before confirmation. No money moves.
- `POST /qr/pay` — the full journey, idempotency-key protected.
- `GET /qr/payments/:reference` — status enquiry, with full event history.
- `GET /qr/payments` — the customer's own payment history.

## Still needed (not built yet)

- **Frontend camera scanner** — the actual QR-scanning UI (camera access,
  live decode, the confirm/PIN-or-biometric/receipt screens). The backend
  above is what it will call.
- **Admin reconciliation UI** — the backend/API exists; no screen in the
  admin portal yet.
- **Risk-based auth method selection** — `authMethod` is currently supplied
  by the client rather than derived from a real risk-rules engine (e.g.
  "PIN under X, biometric or OTP above X"). The field exists on `QrPayment`
  for this to be layered in without a schema change.
- **Digital receipt rendering/sharing** — the data for a receipt is all on
  a completed `QrPayment` + its linked `Transaction`; no receipt screen or
  PDF/share flow built yet.
