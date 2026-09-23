# Dynamic Fee Engine — design reference and current status

A configurable fee engine: fee rules, tiers, bundles, and exemptions are all
admin-managed data, never hardcoded in application logic. This doc is the
map of what exists, how it fits together, and what's explicitly deferred —
read it before assuming something is or isn't built.

## Core concepts

- **FeeTransactionType** — a label for a chargeable category (`QR_OFF_US`,
  `GEPG`, ...). Doing nothing on its own; created by an admin, never a
  hardcoded enum. `isMonetizable=false` (or the type simply not existing)
  means free — this is exactly how Shared Wallet stays free today while
  remaining ready to price later.
- **FeeRule** — a single, versioned, effective-dated pricing rule. Always
  points at one transaction type. Goes through a state machine:
  `DRAFT → PENDING_APPROVAL → ACTIVE` (or `REJECTED`). Only `ACTIVE` rules
  ever price a real transaction.
- **FeeTier** — amount bands, only present when a rule's `feeModel` is
  `tiered`. Validated at save time: must start at 0, be contiguous
  (a 1-unit gap like `0–10,000` / `10,001–50,000` is allowed — that's the
  natural whole-currency pattern — but nothing larger), and the last tier
  must be unbounded.
- **FeeBundle** / **CustomerBundleSubscription** — a purchasable
  daily/weekly/monthly package. See "Bundles" below.
- **FeeExemption** — an individual customer waiver. Highest priority in the
  pricing chain below a hard regulatory exemption.
- **FeeQuote** — an itemized, expiring quotation. Every completed
  transaction references the exact quote (and therefore exact rule +
  version) that priced it.
- **FeeCollectionRecord** — what was actually collected/waived/reversed
  against a completed transaction. Distinct from FeeQuote, which is the
  pre-transaction estimate.
- **FeeApprovalRequest** — the maker-checker record. A rule can't reach
  `ACTIVE` without one of these being `APPROVED` by someone other than the
  requester — enforced server-side, not just in the UI.

## Maker-checker, precisely

1. Create a rule → starts as `DRAFT`. Editable directly while still a draft.
2. **Submit** → `PENDING_APPROVAL`, creates a `FeeApprovalRequest`.
3. A *different* `admin_super` reviews it in the Approvals tab.
   - **Approve** → the rule becomes `ACTIVE`, and any prior active version
     of the same logical rule (same `parentRuleId` lineage) is
     auto-archived. There is deliberately never more than one active
     version of "the same rule" at once.
   - **Reject** → `REJECTED`, stays inert.
4. An `ACTIVE` rule **cannot be edited directly** — this is enforced
   server-side. To change a live rule: **Clone** it (creates a new `DRAFT`,
   version+1, linked via `parentRuleId`), edit the clone, submit, approve.
   Approval of the clone automatically archives the original — no manual
   deactivation step needed, though deactivating directly is also available
   for a straight shutdown with no replacement.

`admin_super` cannot approve their own submission — including cloned
rules. If you only have one `admin_super` account, promote a second one
(Admin users page) rather than weakening this control.

## Pricing priority (implemented in `lib/feeEngine.js` `quoteFee()`)

1. Customer-specific `FeeExemption` (a "regulatory/mandatory" exemption is
   modeled the same way — there's no separate mechanism, see Assumptions)
2. Active bundle entitlement
3. Best-matching `ACTIVE` `FeeRule` (a promotional rule is just a rule with
   `campaignName` set, that naturally wins via higher specificity/priority)
4. Default fallback: **zero fee** if nothing matches — see Assumptions

Rule matching (`findBestRule`/`ruleMatches`) checks every optional
dimension the rule has set (amount band, channel, on-us/off-us, segment,
account type, merchant category, currency, individual customer). A rule
with more dimensions pinned down wins ties over a more general one;
`priority` (lower wins) breaks further ties.

**Known trap, already hit once**: the **Channel** field on a rule must
match exactly what the app sends (`MOBILE_APP`) — it's a dropdown in the
admin UI specifically to prevent a free-text typo silently breaking a
rule's matching with no visible error. If you're troubleshooting a rule
that seems Active but isn't pricing anything, check this first, then check
for a second stray Active rule for the same transaction type (matching
picks the most specific/highest-priority match among *all* active rules
for that type, not just the one you're looking at).

## What's wired to actually charge a fee today

- **QR payments** (on-us and off-us) — `modules/qr-payments/qrPayment.service.js`.
  The MitaPesa fee layers on top of the pre-existing partner/institution
  fee (off-us only, from `lib/institutionRules.js` — a *different*
  mechanism, the bank's own markup, disclosed but never re-collected by
  the fee engine). Balance is checked against the fee-inclusive total.
- **GePG** and **LUKU** — both the main card and add-on card routes.
- **Virtual card issuance** — "first virtual card free" is enforced as
  code (the generic rule matcher has no concept of "which occurrence is
  this"), with the fee for the 2nd+ card fully configurable via a
  `CARD_ISSUANCE_VIRTUAL_ADDON` rule. Charged against the *owner's* main
  card, not the new card being issued.
- **Card statement export (CSV)** — deliberately *not* the in-app JSON
  statement view, which stays free as a core PFM feature. Only the
  downloadable export is monetizable, per `CARD_STATEMENT_MONTHLY`.
- **Bundle purchases** — `modules/fees/fees.routes.js`. See below.

**Not wired**: physical card issuance/replacement fees, other token
purchases beyond LUKU, anything outside what's listed above. Creating a
`FeeTransactionType` for one of these does nothing by itself — a real
transaction flow has to call `quoteFee()`/`collectFee()`, which none of
the unwired flows do yet.

## Bundles

- `GET /fees/bundles` — active, currently-available bundles a customer can
  browse (respects `startDate`/`endDate` if set).
- `POST /fees/bundles/:id/purchase` — debits the customer's main card for
  the bundle price, creates a `CustomerBundleSubscription` with `expiresAt`
  computed from `validity` (DAILY = +1 day, WEEKLY = +7 days, MONTHLY = +1
  calendar month from purchase time).
- One active subscription per bundle at a time — purchasing again while
  one is already active is refused, not stacked or extended.
- `PATCH /fees/bundles/subscriptions/:id` — toggle `autoRenew` on an
  active subscription.
- `POST /fees/bundles/subscriptions/:id/cancel` — only if the bundle is
  configured `cancellable`. If the bundle is also `refundable`, credits a
  **prorated refund** to the wallet based on time remaining in the
  subscription (`pricePaid × remainingTime / totalValidity`, floored, never
  applied if under 1 TZS). This is the automatic default policy — an admin
  can still make a different one-off call via a support ticket for a
  specific case, but most cancellations don't need manual handling at all
  anymore.
- **Auto-renewal billing is implemented** — `lib/bundleLifecycle.js`'s
  `processBundleRenewals()` runs via a 30-minute in-process scheduler
  (`index.js`), finding every `ACTIVE` subscription with `autoRenew=true`
  past its `expiresAt` (plus the bundle's configured `gracePeriodDays`) and
  charging the same `purchaseBundleForUser()` path a fresh purchase uses.
  A failed renewal (insufficient balance) expires the subscription and
  notifies the customer rather than retrying silently. An admin can trigger
  this on demand via `POST /admin/fees/bundles/process-renewals`
  ("Run renewals now" button, Bundles page) instead of waiting on the
  interval.
- Mobile UI: Profile → Bundles card → browse/purchase/cancel sheet, with
  an auto-renew toggle on each active subscription.
- Admin UI: Fee rules is not where bundles live — bundles have their own
  page (`FeeBundlesPage.jsx` / nav item "Bundles").

## Exemptions

Admin UI: Fee rules → Exemptions tab. Grant requires searching for the
customer (name/email/phone), an optional transaction type (blank = every
type), a reason (shown to the customer via the quote's disclosure when it
applies), and an optional end date. Revoking is immediate — the customer
starts being charged the standard fee again on their very next
transaction, no grace period.

## Assumptions made where the spec left a business detail undefined

- **"Regulatory/mandatory exemption" vs "customer-specific waiver"** (spec
  priorities 1 and 2) are modeled as the *same* mechanism (`FeeExemption`)
  rather than two separate systems, since nothing in the spec defined what
  would distinguish them mechanically. If a real regulatory-exemption
  category with different rules ever emerges, it's a straightforward
  extension of this model, not a redesign.
- **No matching rule = zero fee**, not a blocked transaction. Undercharging
  was judged the safer default over blocking an otherwise-working payment
  flow just because nobody has priced that transaction type yet — this
  matters especially during the current phased rollout, where most
  transaction types have no rule configured at all.
- **Card statement fee applies only to the CSV export**, not in-app
  viewing — see "What's wired" above.
- **Tax treatment**: `VAT_EXCLUSIVE` adds VAT on top of the computed fee;
  `VAT_INCLUSIVE` treats the configured fee as already including VAT and
  discloses the VAT component separately without changing the total. No
  excise duty or other tax types beyond VAT are modeled — see the
  Selcom-style "Fee X, VAT Y, Excise Z" reference the fee-display UI was
  built to resemble, if that breakdown becomes a real requirement.

## Explicitly deferred — not started

- Native Swahili review of the disclosure strings (the ones in
  `lib/feeEngine.js` are functional but not reviewed by a native speaker)
- Excel export of the revenue report (CSV export is done)
- Reporting breakdowns beyond "by transaction type" (by payment rail,
  by customer segment before/after a pricing change, etc.)
- Physical card fees, and every monetizable transaction type from the
  original spec not listed under "What's wired" above — blocked on
  physical card issuance itself not existing as a feature yet, not a fee
  engine gap specifically
- The in-process renewal scheduler (`setInterval` in `index.js`) is tied to
  a single web process's uptime — fine for one always-on Render web
  service, but would need a proper job queue with locking if this ever
  runs across multiple instances (see the comment in `bundleLifecycle.js`)

## Testing

`npm test` runs the automated test suite (Node's built-in `node --test`
runner — no new dependency needed). Covers the pure calculation core:

- `test/feeCalculations.test.js` — fee model math (fixed, percentage,
  tiered, fixed+percentage, caps/floors) and tier validation, including a
  regression test for the exact tier-boundary bug caught during
  development (the spec's own `0–10,000` / `10,001–50,000` pattern was
  once incorrectly rejected as a gap).
- `test/bundleCalculations.test.js` — bundle VAT computation (both tax
  treatments, and the invariant that `pricePaid + vatPaid` always equals
  what was actually charged — a real bug this project shipped once) and
  prorated refund math.
- `test/ruleMatching.test.js` — rule matching and specificity, including a
  regression test for the Channel-field bug (a free-text field with a
  typo silently broke matching with zero error feedback — the field is a
  dropdown in the admin UI now, but the underlying matching behavior is
  locked in here regardless of how a bad value might get there).

**What's tested**: the pure calculation logic in `lib/feeCalculations.js`
and `lib/bundleCalculations.js` — deliberately extracted into their own
dependency-free modules (no Prisma import) specifically so this, the part
of the engine most prone to the kind of off-by-one/sign error real money
is sensitive to, can be tested directly without mocking a database.

**What's not tested**: the DB-backed orchestration in `feeEngine.js`
(`quoteFee`, `collectFee`, `reverseFee`) and `bundleLifecycle.js`
(`purchaseBundleForUser`, `processBundleRenewals`) — these call Prisma
directly and would need either a real test database or a mocking layer to
test properly, neither of which exists yet. The pure logic they depend on
is fully covered; the orchestration around it (the DB reads/writes, the
sequencing) is currently only exercised by manual testing.

## Done since this doc was first written

- **Auto-renewal billing for bundles** — a shared `lib/bundleLifecycle.js`
  now handles both customer-initiated purchase and auto-renewal through
  the same code path, so they can't drift apart in behavior. A 30-minute
  in-process scheduler processes due renewals; failed renewals notify the
  customer and expire cleanly rather than failing silently. An admin
  "Run renewals now" button exists for on-demand testing.
- **Prorated refund on bundle cancellation** — automatic, based on time
  remaining in the subscription, for any bundle configured `refundable`.
  An admin can still make a different one-off call via a support ticket
  for a specific case; this is just the automatic default.
- **CSV export of the revenue report** — `GET /admin/fees/report?format=csv`.
