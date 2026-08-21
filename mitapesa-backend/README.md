# MitaPesa Backend

Express + PostgreSQL (Prisma) API for the MitaPesa frontend. Built around a
**provider-adapter layer** for the four external integrations discussed:
NIDA (KYC), TIPS (payments rail), Visa (card funding), and a card-issuing
processor. Every one of those currently runs as a `Mock*Provider` so the
whole app is fully runnable and demoable today, before any partnership is
signed. Swapping a mock for the real thing later means writing one new
provider class — no changes to routes or business logic.

## 1. Setup

### Option A — Docker (fastest)

```bash
docker compose up --build
```

This starts Postgres, runs migrations, seeds default categories, and starts
the API on `http://localhost:4000`. Nothing else to install locally.

### Option B — Local Node + your own Postgres

```bash
cp .env.example .env      # then fill in DATABASE_URL at minimum
npm install
npx prisma migrate dev --name init
npm run seed               # loads the 13 default categories
npm run dev                 # http://localhost:4000
```

Requires a running PostgreSQL instance matching `DATABASE_URL`. Easiest
local option if not using Docker Compose:

```bash
docker run --name mitapesa-db -e POSTGRES_USER=mitapesa -e POSTGRES_PASSWORD=mitapesa -e POSTGRES_DB=mitapesa -p 5432:5432 -d postgres:16
```

## 2. Project shape

```
src/
  app.js, index.js       Express app + entrypoint
  lib/                   env, prisma client, jwt, error types, serializers
  middleware/             auth guard, async wrapper, error handler
  modules/                one folder per resource: auth, users, categories,
                           budgets, transactions, wallets, cards, kyc, notifications
  services/                the provider-adapter layer:
    kyc/                    KycProvider interface + MockNidaProvider
    payments-rail/          PaymentRailProvider interface + MockTipsProvider
    card-funding/            CardFundingProvider interface + MockVisaProvider
    card-issuing/            CardIssuingProvider interface + MockCardProvider
prisma/
  schema.prisma            data model
  seed.js                   default categories
```

Each `services/<x>/index.js` is a factory: it reads `<X>_PROVIDER` from env
(`mock` today) and returns the right implementation. Routes and services
only ever call the interface methods (`lookupIdentity`, `initiatePayment`,
`chargeGateway`, `debit`, etc.) — they never know or care whether they're
talking to a mock or a live NIDA/TIPS/Visa/processor connection.

## 3. What's real vs. mocked right now

| Capability | Status |
|---|---|
| Auth (register/login/JWT refresh) | Real |
| Transactions, categories, budgets, wallets, notifications | Real — persisted in Postgres |
| Card balance / freeze / controls / activity | Real DB state, standing in for a processor (`MockCardProvider`) |
| NIDA identity lookup + OTP + KBV fallback | Mocked, same logic already validated in the frontend |
| TIPS merchant resolution + payment | Mocked |
| Visa gateway top-up / OCT push | Mocked — **note**: once real, card data must be collected via Visa/processor-hosted fields on the client and this backend should only ever see a single-use token, never a PAN/CVV |

## 4. KYC gate

`src/modules/cards/kycGate.js` is the server-side enforcement of the
"amounts over 50,000 TZS require KYC" rule — this is the version that
actually matters; the frontend check is just UX. It's called from every
money-movement route: top-up, OCT, Lipa, GePG, LUKU.

## 5. Next steps when a partnership lands

1. Add a real provider class next to the mock (e.g. `services/kyc/NidaProvider.js`)
   implementing the same interface.
2. Point `<X>_PROVIDER` in `.env` at it.
3. Nothing else changes — routes, KYC gate, and the frontend contract stay identical.

For card issuance specifically, `CARD_ISSUING_PROVIDER=bpc_smartvista_sim`
simulates BPC SmartVista's real API contracts (not just our own made-up
shapes) — see `docs/BPC_SMARTVISTA_MAPPING.md` for the full operation
mapping, so the eventual real bank connection is a transport-layer swap.

## 6. Name correction, NIDA data sync, and admin scaffolding

- **Name correction** (`PATCH /users/me`): customers can correct typos in first/middle/last name from the Profile page. Validated (letters/spaces/hyphens/apostrophes only) and every change is audit-logged with before/after values.
- **Automatic NIDA sync**: the moment KYC verification succeeds (OTP or KBV path), the backend automatically retrieves the customer's full NIDA record — name, sex, date of birth, marital status, place of birth, citizenship type, NIDA-registered phone, region/district/ward/village, photo — and stores it in a dedicated `KycNidaProfile` table. The customer never enters any of this manually. The NIDA-registered phone is stored as a separate field; it never overwrites the phone the customer verified at onboarding.
- **Encrypted at rest**: every field in `KycNidaProfile` is AES-256-GCM encrypted (see `src/lib/crypto.js`) before it touches the database. This requires `ENCRYPTION_KEY` to be set — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  If it's missing, the sync fails gracefully (logged, `syncStatus: "failed"`, retryable) rather than crashing the KYC flow — the customer's verification itself still succeeds.
- **Not customer-visible**: nothing in `KycNidaProfile` is ever returned from any customer-facing endpoint. The regular Profile page only ever shows what the customer themselves entered.
- **Admin scaffolding for a later portal**: `role` on `User` (`customer` | `admin`), a `requireAdmin` middleware, and gated routes (`GET /admin/users/:id`, `GET /admin/users/:id/kyc`) that decrypt and return the full record — every view is itself audit-logged. No admin UI exists yet; this is the backend capability it will call. To make yourself an admin for testing:
  ```bash
  npm run make-admin -- you@example.com
  ```

Because a new database table and User columns were added, remember to run `npx prisma db push --skip-generate` (or let your Start Command do it) after deploying this.

## 7. Security hardening

Added on top of the initial pass:

- **Refresh tokens live in an httpOnly cookie**, not the response body or `localStorage`. JavaScript in the browser cannot read it, which closes off the main token-theft path from an XSS bug. Only the short-lived access token (15 min default) is held in memory on the frontend.
- **Account lockout**: 5 failed logins (configurable via `MAX_LOGIN_ATTEMPTS`) locks the account for 15 minutes (`LOGIN_LOCKOUT_MINUTES`). Same pattern for KYC OTP/KBV attempts (`MAX_KYC_ATTEMPTS`) — exceeding it requires starting a fresh NIDA lookup rather than endlessly retrying.
- **Audit log** (`AuditLog` table): every login, lockout, KYC decision, and money-movement action is recorded with user, action, amount, metadata, and IP — independent of the records it describes, so it survives account changes.
- **Idempotency keys**: every route that moves money (`/cards/topup/*`, `/cards/pay/*`) requires an `Idempotency-Key` header. A repeated key for the same user returns the original result instead of re-running the operation — protects against double-charges from retries or double-taps.

Still outstanding before this should touch real production traffic:
- HTTPS termination (handled by your hosting platform or a reverse proxy — not something this codebase does itself)
- Rotating the placeholder JWT secrets in `.env` to real random values
- Dependency vulnerability scanning (`npm audit` / Dependabot / Snyk)
- Error monitoring / alerting (e.g. Sentry) so failures and suspicious patterns actually get noticed

