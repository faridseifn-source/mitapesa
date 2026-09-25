# MitaPesa Admin Portal

A **separate** web application from the MitaPesa mobile app — different
codebase, different deployment, different visual design (dark sidebar,
desktop-oriented, data tables). It talks to the same backend, using a
distinct, more restricted set of routes and its own login flow.

## Setup

```bash
npm install
cp .env.example .env    # set VITE_API_URL if not using the deployed backend
npm run dev              # http://localhost:5174
```

For production, `npm run build` and deploy the `dist/` folder — as its own
site, on its own domain/subdomain, separate from the customer app's Vercel
deployment. Add that domain to the backend's `CORS_ORIGIN` (comma-separated
alongside the customer app's URL).

## Creating your first admin account

The backend has no signup flow for admins — accounts are promoted from
regular MitaPesa users:

```bash
# from the mitapesa-backend directory
npm run make-admin -- you@example.com admin_super
```

Roles: `admin_super` (full access, including settings and blocking
accounts), `admin_support` (customer lookup, statements, disputes),
`admin_viewer` (read-only dashboard, redacted customer info).

## Security notes

- **Two-factor login is mandatory** — password alone never issues a
  session. A 6-digit code is emailed on every login attempt.
- **Sessions are short**: 15-minute access tokens, 8-hour admin session,
  versus the customer app's 30 days. Configurable via `ADMIN_JWT_ACCESS_EXPIRES_IN`
  and `ADMIN_SESSION_HOURS` on the backend.
- **Every sensitive action is audit-logged** — visible in the Audit Log
  page itself (support tier and above).
- **Role checks are enforced server-side**, not just hidden in this UI —
  see `requireAdminRole()` in the backend. A viewer-tier admin calling a
  super-admin-only endpoint directly gets a 403, regardless of what this
  frontend shows them.
- This app is marked `noindex, nofollow` and should never be linked from
  anywhere public.

## What's not built yet

- No password reset flow specific to admins (uses the same one as the
  customer app currently).
- No IP allowlisting — worth adding at the infrastructure level (e.g. a
  VPN or a reverse-proxy allowlist) for a real production deployment,
  since this app is intentionally reachable from the public internet
  today (behind login + 2FA + role checks) rather than network-isolated.
- No TOTP authenticator-app option — email OTP only.
