# BPC SmartVista — CMS integration mapping

This documents how MitaPesa's card-issuing provider abstraction maps onto
BPC SmartVista's real, documented API surface (SmartVista Webgate
specification guide — "SVWG", and the SVAP issuing file/web-service
structure guide — "SVAP"), so the eventual real connection is a swap of
`src/services/card-issuing/BpcSmartVistaSimProvider.js` for a real
`BpcSmartVistaProvider.js` implementing the same `CardIssuingProvider`
interface — not a redesign of anything else in the app.

## Wallet/account identifier convention

Per explicit product requirement: every card/wallet generation request
submits the relevant person's **mobile number, local format, no country
code, WITH the leading zero** (e.g. `0712552287`) as the `account` field —
never an internal MitaPesa id. For an add-on card this is the **holder's**
number (the person the card is issued to), not the primary member's, even
though the primary member funds and controls it.

SmartVista is the system of record for the actual wallet/account number —
we never invent one. Whatever it returns is stored in `processorRef` on
`Card`/`VirtualCard` (`lib/phone.js` does the format conversion; today's
simulation generates a plausible-looking reference in
`BpcSmartVistaSimProvider._simulateCmsWalletNumber()` — a real integration
replaces only that one method with reading the actual SOAP response).

## Operation mapping

| Our provider method | Real BPC operation | Source |
|---|---|---|
| `issueCard()` — primary card | `CardLink`, `ApplType=LKTPNECT` (new customer) | SVWG §3.11 |
| `issueVirtualCard()`, type `parent_linked` — add-on card | `CardLink`, `ApplType=LKTPEXSC` (supplementary card for existing account) | SVWG §3.11 |
| `issueVirtualCard()`, type `independent` | `createVirtualCard` | SVWG §3.3 |
| `getBalance()` | `BalanceInquiry` | SVWG §1.8 |
| `setFrozen()` | `ChangeCardStatus` | SVWG §1.5 |
| `setControls()` | `ChangeCardRestrictions` (closest analog — BPC's model is transaction-type/channel based) | SVWG §1.15 |
| `setDailyLimit()` | `ChangeCardLimit` / `ChangeCardLimits` | SVWG §1.7, §1.16 |
| `debit()` / `credit()` | No direct synchronous equivalent — real balance movement happens via ISO 8583 authorization/settlement messages | — |
| Statement (`lib/statement.js`, not part of the provider) | `GetTransactionHistoryBO` (full, filterable) or `getStatement` (last-5 mini-statement) | SVWG §2.2, §1.9 |
| Card list / supplementary card list | `GetCardList`, `GetSuppCards` | SVWG §1.1, §1.6 |

**Confirms our data model is right**: BPC's own `PrimaryIndicator` field
(`GetCardList` response) and `CATEGORY` dictionary (`CRCG0800` = Main,
`CRCG0400` = Additional — SVAP, `CARD` tag) draw the exact same
primary/add-on distinction our `VirtualCard.type` field does.

## What's simulated vs. what's still a gap

- **Simulated now**: every operation above, using BPC's real field names
  and, for the one case that matters (insufficient funds on debit), BPC's
  real error code (`WSA018`, attached as `err.bpcErrorCode` alongside our
  own `err.code = "INSUFFICIENT_FUNDS"` that the rest of the app relies on).
- **Not simulated**: BPC's actual transport (SOAP + WSDL, with a
  `<auth:credentials><user>/<pass></auth:credentials>` SOAP header — SVWG
  §3.11 sample), and the full WSA0xx/WSR0xx error catalog (SVWG §3.2.2/3).
  Both are documented enough here for a real integration to implement
  directly against the mock's method signatures.
- **Architecturally different from BPC**: BPC settles balances
  asynchronously via authorization messages; our simulation debits/credits
  synchronously in the same request. A real integration will likely need a
  webhook/polling reconciliation step here instead.

## Transaction sync — closing the "external online purchase" gap

**The gap this solves**: MitaPesa's own `Transaction` table (the PFM/budgeting
ledger) is only ever written to by requests that pass through MitaPesa's
own backend — QR payments, GePG, LUKU, manual entries. A virtual card used
directly at an external online checkout (Amazon, Netflix, any e-commerce
merchant) never touches MitaPesa's backend at all once a real card network
is connected, so nothing writes a `Transaction` row for it. Without this,
that spending is invisible to the app's own budgeting/insights view even
though it's real money the customer spent — which undermines the core PFM
purpose the app exists for.

**Two complementary mechanisms, not one, matching standard real-world
practice** (a webhook alone can silently miss events during downtime or a
network blip; a periodic pull alone adds latency the customer would notice
if it were the only mechanism):

### 1. Real-time webhook (not yet built — no endpoint exists in this
codebase today; confirmed by searching the whole backend for one)

BPC would need to be configured to POST to a MitaPesa endpoint (e.g.
`POST /webhooks/bpc/transaction`) on each authorization/settlement event.
On receipt: look up the `VirtualCard` by `processorRef`, create a matching
`Transaction` + `VirtualCardActivity` row, using the webhook payload's
merchant name and MCC to suggest a category (see "categorization" below).
Needs signature verification (whatever BPC's webhook-auth mechanism is —
not yet documented in the SVWG pages searched for this doc; check the
webhook/notification section of the full BPC integration pack when real
credentials are being set up) before trusting the payload.

### 2. Periodic reconciliation pull (the safety net — catches anything the
webhook missed)

Uses APIs BPC's own documentation already specifies (SVWG §2 "Transaction
history"):

| API | Purpose | Key fields returned |
|---|---|---|
| `GetAuthHistoryFE` | Authorization-level transactions, from the front-end system | `TransactionID`, `TransactionDate`, `BillingAmount`, `TrxnDescription`, `CardNumber` |
| `GetTransactionHistoryBO` | Cleared/posted transactions, from the back-office system | Same core fields, plus `PostDate`, `MCC`, `MerchantName`, `DeclineReason` |

Both accept `CardNumber` + `TransactionDateFrom`/`TransactionDateTo` filters
(BPC's own docs recommend always filtering by date range for query
performance — SVWG explicitly calls this out).

**Proposed implementation**:

1. Add `lastSyncedAt DateTime?` to `VirtualCard` (and `Card`, for the
   primary card, once it's real-network-usable too) — the watermark for
   "we've already pulled everything up to this point."
2. Add `processorTransactionId String? @unique` to `VirtualCardActivity` —
   BPC's own `TransactionID`, stored specifically so a re-run of the sync
   (or an overlap window) can't create a duplicate row. This is the same
   idempotency principle the QR payment flow already uses via
   `reference`/`idempotencyKey` — nothing new conceptually, just applied to
   an inbound sync instead of an outbound request.
3. A scheduled job (cron-style, e.g. every 15–30 minutes — frequent enough
   that Insights doesn't feel stale, infrequent enough to respect BPC's
   query-performance guidance) does, per active virtual card with a real
   `processorRef`:
   - Call `GetTransactionHistoryBO` with `TransactionDateFrom = lastSyncedAt`.
   - For each returned transaction, skip if `processorTransactionId`
     already exists locally (idempotent, safe to re-run or overlap).
   - Otherwise, create the `Transaction` + `VirtualCardActivity` row and
     advance `lastSyncedAt`.
4. Reuse the existing notification pipeline (`lib/notify.js`) to tell the
   customer about a newly-synced external transaction, same as any
   in-app payment already does — no new notification mechanism needed.

**Categorization is a best-effort guess, not a guarantee.** MCC codes are
often too generic to map cleanly onto how a person actually organizes
their own budget (e.g. MCC 5411 "Grocery Stores" could be a customer's
"Food" category or their shared household "Groceries" category — the app
can't know which without asking). Land these in a generic default category
(e.g. "Uncategorized" or "Card purchase") with the merchant name and MCC
preserved, so the customer can quickly re-file it rather than the app
guessing wrong and hiding a miscategorization silently.

**Not yet built.** This section is the implementation plan for when a real
`BpcSmartVistaProvider.js` replaces the sim — there's nothing to sync
against `BpcSmartVistaSimProvider.js`, since it never talks to a real card
network. Treat this as the concrete spec to build from at that point, not
speculative design.

## Configuration that should live in an Admin Portal (not hardcoded)

Already wired through the DB-backed `SystemSetting` table and the existing
`GET/PATCH /admin/settings/:key` routes — no portal UI yet, but the backend
capability is real:

- `card_bin` — the 6-digit BIN prefix used when generating card numbers.
  Mirrors BPC's real model, where BIN is configured per card "Product"
  (`UNDEFINED_BIN_FOR_PRODUCT` error — SVAP, `PRODUCT_ID`/`PRODUCT_NUMBER`).
- `cms_provider_label` — human-readable label for whichever provider is
  active, for display in an admin screen.
- `household_max_members` — unrelated to the CMS, but the same pattern.

**Deliberately NOT in this table** — these belong in environment variables
(secrets), never in a DB table an admin-portal screen can read out:

- CMS base URL / WSDL endpoint
- CMS API username/password (the SOAP header credentials)
- Any API keys for other providers (Resend, Africa's Talking, etc.)

A future Admin Portal can still *show* whether these are configured
(e.g. "CMS endpoint: configured ✓ / not set") without ever displaying or
accepting the actual secret value through the UI — that's the standard
pattern for keeping secrets out of a database that a support/admin tool can
query.

## To make BIN configurable right now

```bash
curl -X PATCH https://your-api/admin/settings/card_bin \
  -H "Authorization: Bearer <admin access token>" \
  -H "Content-Type: application/json" \
  -d '{"value": "428427"}'
```

(Requires an admin account — see the main README's `npm run make-admin`.)
