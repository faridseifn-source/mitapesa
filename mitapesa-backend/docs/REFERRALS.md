# Referral & Rewards — Phase 1

## What it does
A customer gets an invite code (and link / QR). A friend enters it at sign-up. As the friend completes the
campaign's welcome steps (create a budget, log transactions, open the app on different days) the friend and/or
the inviter earn rewards. Phase 1 rewards are **AI credits** (automatic) and **manual rewards** (airtime, vouchers,
discounts…) delivered by staff through a CSV queue. No partner API is needed.

## Privacy rule (enforced in code)
The module only ever receives an event NAME and an opaque id (`budget_created`, `transaction_logged`,
`daily_active`) — never amounts, merchants, categories, balances. A referrer sees a friend's first name + last
initial, which steps are done, and the status. Nothing about loans or credit is connected to it.

## Flow
1. `POST /auth/register` accepts optional `referralCode` + `deviceId` → `attributeSignup()` (never blocks sign-up).
2. Product hooks call `referrals.trackEvent(userId, eventName, ref)` (idempotent, fire-and-forget):
   budgets PUT, transactions POST / bulk, `GET /auth/me` + login (daily_active, once per calendar day).
3. Each event advances milestone progress. A milestone's reward is released only when all earlier milestones are done.
4. Rewards → `RewardEntitlement` (unique idempotency key = referral:milestone:recipient).
   - AI credits (auto): granted immediately for the friend; for the inviter after the **maturity hold**.
   - Manual: status `queued` → staff export CSV → deliver → upload results (or mark individually).
5. Hourly job (`processMaturity`): second fraud look at the end of the hold, then release; expires old AI credits.
6. AI credits are spent **after the free monthly allowance and before purchased credits**, only when the AI request
   succeeded (`recordUsage`), under the existing global spend ceiling. Voice / analytics routes did not change.

## Fee waivers & activation (for when Pay launches)
- Reward type `fee_waiver` (automatic): N days, for all fees or one fee transaction type. It is created as a
  `FeeExemption`, which `feeEngine.quoteFee` already honours first in its pricing order — no fee-engine change.
- If `pay_module_enabled` is off when the waiver is earned, it waits (status `available`, shown to the customer as
  "starts when Pay launches") and the N days start when the hourly job sees Pay is on.
- Activation events: `kyc_verified` (KYC routes), `topup_completed` (card top-ups), `payment_completed` (Lipa/GePG/LUKU and
  QR payments). Event name only — never the amount. The seeded campaign includes three activation steps, switched OFF; turn them on
  in Admin → Campaigns at Pay launch. The last one (first payment) carries the waiver for both friend and inviter.
- Rejecting a referral switches its waivers off (past fee-free transactions are not reversed).

## Fraud controls
Rule engine in `src/lib/referrals/fraud.js`; every rule has a weight and can be switched off / tuned in
Admin → Referrals → Fraud rules. Score ≥ `referral_fraud_hold_score` (50) → referral goes to manual review and its
rewards wait; ≥ `referral_fraud_reject_score` (100) → refused. Each evaluation stores its reasons. Customers see
only "under review" and can appeal (staff resolve in the Appeals tab; upholding reinstates the referral).

## Ledger
`RewardTransaction` and `AiCreditTransaction` are append-only: no code path updates or deletes them.

## Settings
`referral_enabled`, `referral_landing_url`, `referral_fraud_hold_score`, `referral_fraud_reject_score`
(Admin → Settings). `referral_enabled` and `referral_landing_url` are public (the app reads them).

## Admin permissions
viewer: read-only, names shortened, no contact details · support: review referrals, fulfilment, appeals ·
super: campaigns, steps, rewards, partners, fraud rules, cancel a reward.

## Future (Phase 2+)
Partner API fulfilment plugs in at `markFulfilled` / `markFailed` (the manual CSV path already calls the same functions);
`Partner.integration` is already modelled.
