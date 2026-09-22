# Push notifications — design reference

Two independent delivery channels, both reached through the same
`sendPushToUser()` call - callers never need to know or care which
channel a given user actually has active:

- **Web push** (RFC 8030, VAPID/RFC 8292) - for the website, standard
  browser Push API, no third-party account needed.
- **Native push (FCM)** - for the Android app, Firebase Cloud Messaging
  via the official `@capacitor/push-notifications` plugin and the
  `firebase-admin` SDK server-side. iOS isn't wired up yet - real iOS
  push needs a paid Apple Developer account (APNs certificates), the
  same blocker as Face ID, so it's deliberately deferred.

A user can have both a web-push subscription and a native device token
registered at once (e.g. they've used the website and the native app on
different occasions) - `sendPushToUser()` sends to whichever exist,
in parallel, and neither channel's failure affects the other.

## Web push

Standard Web Push (RFC 8030) with VAPID (RFC 8292) — not a third-party
push service, no Firebase/APNs account needed. Works in any browser that
supports the Push API (all major browsers except Safari on older iOS).

## How the VAPID keys were generated

VAPID keys are just a standard EC P-256 key pair — no third-party
credential, nothing to "sign up" for. The pair shipped with this project
was generated with Node's built-in `crypto` module (via structured JWK
export, not manual DER parsing — an earlier manual-parsing attempt during
development produced a corrupted private key, caught by testing sign/verify
round-trip before shipping):

```js
const crypto = require("crypto");
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pubJwk = publicKey.export({ format: "jwk" });
const privJwk = privateKey.export({ format: "jwk" });
const b64url = (s) => Buffer.from(s, "base64url");
const vapidPublic = Buffer.concat([Buffer.from([0x04]), b64url(pubJwk.x), b64url(pubJwk.y)]).toString("base64url");
const vapidPrivate = b64url(privJwk.d).toString("base64url");
```

**Keep these stable across deploys** — rotating them invalidates every
customer's existing push subscription (they'd each need to re-enable
notifications). If you ever do need to rotate, generate a fresh pair the
same way and treat it as a breaking change communicated to users, not a
routine env var update.

## Architecture

- `lib/push.js` — `sendPushToUser()`, the single entry point everything
  else calls. Internally fans out to `sendWebPush()` (web-push npm
  library — handles VAPID JWT signing and payload encryption per spec,
  not reimplemented by hand) and `sendNativePush()` (delegates to
  `lib/fcm.js` for each registered device token), running both in
  parallel via `Promise.all`.
- `lib/fcm.js` — sends a single FCM message via `firebase-admin`,
  lazily initialized from the `FIREBASE_SERVICE_ACCOUNT_JSON` env var
  (parsed once, cached). Returns `"ok"` / `"invalid"` / `"error"` /
  `"not_configured"` rather than throwing, so `sendNativePush()` can
  clean up a dead token without needing a try/catch around every call.
- `lib/notify.js` — `notifyUser()`, the single place that creates an
  in-app `Notification` row AND best-effort sends a push (through
  whichever channel(s) the user has), so the channels never drift out
  of sync.
- Sending is always best-effort, on both channels: a push failure never
  throws back into the caller's business logic. A payment completing
  successfully shouldn't be undone or blocked just because a
  notification couldn't be delivered.
- An expired/invalid web-push subscription (push service responds
  404/410) or FCM token (`messaging/registration-token-not-registered`)
  is deleted automatically on the next send attempt — no separate
  cleanup job for either channel.

## What's wired to send a notification today

- Wallet invitation sent / accepted
- Add-on card issued
- QR payment completed
- QR payment reversed (the more important of the two — the customer needs
  to know their money came back)
- Account blocked / unblocked by an admin
- Support ticket marked resolved

Adding a new trigger point anywhere else in the app is one call to
`notifyUser(userId, { type, title, message, url })` — no separate push-
specific code needed at the call site.

## Admin control

`push_notifications_enabled` (default `"true"`) gates BOTH new
subscriptions/registrations and sending, on both channels — turning it
off makes `/push/subscribe` and `/push/register-device` refuse, and
makes every `sendPushToUser()` call a silent no-op across web push and
FCM alike. The in-app notification list keeps working regardless, since
that's a separate, always-on channel.

## Frontend pieces — web push

- `public/sw.js` — the service worker. Deliberately minimal: only handles
  `push` and `notificationclick` events, no offline caching or asset
  interception (this isn't trying to be a full offline-first PWA).
- Registered once at startup in `main.jsx`.
- `api.push.subscribe()` triggers the browser's native permission prompt
  as a side effect of calling `pushManager.subscribe()` — there's no
  separate "ask permission" step in the Push API itself.

## Frontend pieces — native push (Android)

- `@capacitor/push-notifications` (official Capacitor plugin) handles
  the native registration flow; `api.js`'s `push` object detects
  `Capacitor.isNativePlatform()` and branches internally, so every method
  (`isSupported`, `getCurrentSubscription`, `subscribe`, `unsubscribe`)
  keeps the same call signature regardless of platform — the UI
  component itself needed zero changes.
- `push.subscribeNative()` requests permission, calls
  `PushNotifications.register()`, waits for the `registration` event to
  get the FCM token, then POSTs it to `/push/register-device`. The token
  is also cached in `localStorage` so `unsubscribe()` can tell the
  backend which token to remove without needing to re-register just to
  look it up.
- App-root-level listeners (`pushNotificationReceived`,
  `pushNotificationActionPerformed`) refresh the in-app notification
  list on arrival, and navigate to the notifications screen on tap —
  set up once in `PersonalFinanceApp.jsx`, active only when
  `Capacitor.isNativePlatform()` is true.
- See `CAPACITOR_SETUP.md` in the frontend repo for the full Firebase
  project setup, `google-services.json` placement, and the
  `FIREBASE_SERVICE_ACCOUNT_JSON` env var this backend needs.

## Shared UI

UI lives in Profile → "Push notifications" card, including a
"Send test" button so a customer can confirm it's actually working on
their specific device right after enabling it — same card, same button,
regardless of which channel is actually active underneath.

## Known limitations

- No iOS native push yet — blocked on the paid Apple Developer account
  (APNs certificates), same as Face ID. The `@capacitor/push-notifications`
  plugin supports iOS once that's unblocked; the frontend/backend work
  here was scoped to Android only for now.
- No admin broadcast/campaign tool (send-to-all-customers) — every
  notification today is triggered by a specific event for a specific user.
  Worth building if marketing-style announcements become a need.
- No per-notification-type opt-out (it's all-or-nothing per device) — a
  customer can't currently say "notify me about payments but not disputes."
