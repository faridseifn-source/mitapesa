# Multi-currency PFM

## The model

One "running" currency per customer (`User.preferredCurrency`, defaults
TZS) — NOT true multi-currency wallets. The customer's actual spendable
balance (`Card.balance`) stays TZS regardless of this setting, since
TIPS/GePG/LUKU are TZS-native rails with no foreign currency equivalent.
A transaction recorded in a different currency (a receipt scanned abroad,
or a manual entry with a foreign amount specified) gets converted into
the customer's running currency at the point it's recorded.

This was a deliberate scoping decision, not a limitation discovered
later — true multi-currency wallets would mean real FX settlement and
likely real regulatory requirements (foreign exchange holding is
typically tightly controlled by the Bank of Tanzania), which is a
business/legal decision requiring actual regulatory counsel, not
something to build as a technical feature on assumption.

## What's built

- `User.preferredCurrency` — the customer's running currency.
- `Transaction.originalAmount` / `originalCurrency` / `exchangeRate` —
  populated only when a transaction was converted; all three null for an
  ordinary same-currency entry. `Transaction.amount` itself is always in
  the customer's running currency, exactly as before this feature existed
  — nothing about existing behavior changed for a TZS-only customer.
- A real exchange rate provider (`services/exchange-rate/`), same
  provider-abstraction pattern as CMS/CBS/OCR elsewhere in this project —
  `EXCHANGE_RATE_PROVIDER=mock|exchangerate_api`. See the provider file
  itself for why ExchangeRate-API was chosen over several newer,
  SEO-blog-recommended alternatives found while researching this that
  read more like marketing content than services to build a real
  financial feature on.
- Both OCR providers (OpenAI, Gemini) detect the currency on a receipt,
  not just the amount, and the receipt scan route converts automatically.
- Manual transaction entry (`POST /transactions`) accepts an optional
  `currency` field — when set and different from the customer's
  preferred currency, the submitted `amount` is treated as being in that
  currency and converted before storage.
- `PATCH /auth/me/currency` — lets a customer change their running
  currency, gated by `multi_currency_enabled` and restricted to whatever
  `available_currencies` the admin has configured (both real settings,
  Admin Portal → Settings — nothing here is hardcoded).
- `CurrencyPreferenceCard` (Profile page) — the actual picker UI.

## What's NOT built yet — and why the admin toggle defaults to OFF

**The amount formatter throughout the rest of the app (`fmt`/`fmtTZS`)
does not yet read `preferredCurrency`.** It always labels amounts "TZS,"
unconditionally, everywhere. This means: if a customer switched their
running currency to USD today, their new transactions WOULD be correctly
converted and stored in USD-equivalent amounts on the backend — but every
screen in the app would keep displaying those numbers labeled "TZS,"
which is actively misleading, not just an incomplete label.

This is why `multi_currency_enabled` defaults to `"false"` — the backend
is complete and tested, but the feature isn't safe to expose to real
customers until the display layer also respects this preference. Turning
the setting on today would let a customer change their currency and get
genuinely wrong-looking numbers everywhere in their PFM view.

**The remaining work**: thread `preferredCurrency` through every
component that calls `fmt()`/`fmtTZS()` (roughly 90 call sites across
many components), matching the same pattern already used for threading
`tr`/`language` through the app for Swahili support. This is a
substantial, careful frontend pass — deliberately not rushed alongside
the backend work, given the size and the real risk of a careless edit to
a file this large.

## Testing what exists today

The backend and the currency picker card can both be exercised even with
the feature flag off, by an admin:
1. Admin Portal → Settings → turn `multi_currency_enabled` to `"true"`
   temporarily.
2. In the app, Profile → Running currency → pick something other than
   TZS.
3. Confirm the preference saves (`GET /auth/me` should reflect it).
4. Scan a receipt in a foreign currency (or manually enter one with a
   `currency` field) and confirm the stored amount is correctly
   converted — even though it will display mislabeled as TZS until the
   display-layer work above is done. Turn the setting back off afterward.
