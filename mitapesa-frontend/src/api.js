// Drop this file in as `src/api.js` alongside PersonalFinanceApp.jsx.
// It's the only place that knows the backend exists — every component still
// works with the same plain-name shapes (category: "Food & Dining", wallet:
// "personal") it always did; this module translates at the boundary.
//
// Auth note: the refresh token lives in an httpOnly cookie set by the
// backend — this file never reads or stores it directly (JS can't read an
// httpOnly cookie, which is the point). Only the short-lived access token
// is held here, in memory, for the lifetime of the tab.

import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

const BASE_URL = import.meta?.env?.VITE_API_URL || "https://mitapesa-api.dugapay.com";

let accessToken = null;

function setAccessToken(token) {
  accessToken = token || null;
}
function clearAccessToken() {
  accessToken = null;
}

async function raw(path, { method = "GET", body, auth = true, retry = true, extraHeaders = {} } = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include", // sends/receives the httpOnly refresh-token cookie
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return raw(path, { method, body, auth, retry: false, extraHeaders });
  }

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.details = data?.details;
    throw err;
  }
  return data;
}

// Generates a fresh key per logical operation. The caller is responsible for
// reusing the same key if it needs to safely retry a specific attempt —
// see cards.* below, where each user-initiated action gets one key.
const newIdempotencyKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Fetches a file with the same auth headers `raw` uses, then triggers a
// browser download — a plain <a href> can't carry the Authorization header
// this needs, since it's a short-lived in-memory token, not a cookie.
async function downloadFile(path, filename) {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || data.message || message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function tryRefresh() {
  try {
    const data = await raw("/auth/refresh", { method: "POST", auth: false });
    setAccessToken(data.accessToken);
    return true;
  } catch {
    clearAccessToken();
    return false;
  }
}

/* ------------------------------ auth ------------------------------ */

const auth = {
  async register({ firstName, lastName, email, phone, password, phoneVerifyToken, emailVerifyToken }) {
    const data = await raw("/auth/register", { method: "POST", body: { firstName, lastName, email, phone, password, phoneVerifyToken, emailVerifyToken }, auth: false });
    setAccessToken(data.accessToken);
    return data.user;
  },
  async sendPhoneOtp(phone) {
    return raw("/auth/phone/send-otp", { method: "POST", body: { phone }, auth: false });
  },
  async verifyPhoneOtp(phone, code) {
    return raw("/auth/phone/verify-otp", { method: "POST", body: { phone, code }, auth: false });
  },
  async sendEmailOtp(email) {
    return raw("/auth/email/send-otp", { method: "POST", body: { email }, auth: false });
  },
  async verifyEmailOtp(email, code) {
    return raw("/auth/email/verify-otp", { method: "POST", body: { email, code }, auth: false });
  },
  async login({ email, password }) {
    const data = await raw("/auth/login", { method: "POST", body: { email, password }, auth: false });
    setAccessToken(data.accessToken);
    return data.user;
  },
  async restoreSession() {
    const ok = await tryRefresh();
    if (!ok) return null;
    const { user } = await raw("/auth/me");
    return user;
  },
  async me() {
    const { user, currencyRate } = await raw("/auth/me");
    return { ...user, currencyRate };
  },
  async logout() {
    await raw("/auth/logout", { method: "POST", auth: false }).catch(() => {});
    clearAccessToken();
  },
  async updateProfile(patch) {
    const { user } = await raw("/users/me", { method: "PATCH", body: patch });
    return user;
  },
  async setCurrency(currency) {
    const { user, currencyRate } = await raw("/auth/me/currency", { method: "PATCH", body: { currency } });
    return { ...user, currencyRate };
  },
  async verifyPassword(password) {
    return raw("/auth/verify-password", { method: "POST", body: { password } });
  },
  async forgotPassword(email) {
    return raw("/auth/forgot-password", { method: "POST", body: { email }, auth: false });
  },
  async resetPassword(token, newPassword) {
    return raw("/auth/reset-password", { method: "POST", body: { token, newPassword }, auth: false });
  },
  async changePassword(currentPassword, newPassword) {
    const data = await raw("/users/me/password", { method: "POST", body: { currentPassword, newPassword } });
    // The backend revokes every session (including this one) on a password change.
    clearAccessToken();
    return data;
  },
};

/* --------------------------- categories ---------------------------- */
// Backend: [{ id, name, color, subcategories:[{id,name}] }]
// Frontend expects the same shape (id is just extra, existing renders ignore it).

const categories = {
  async list() {
    const { categories } = await raw("/categories");
    return categories;
  },
  async create(name) {
    const { category } = await raw("/categories", { method: "POST", body: { name } });
    return category;
  },
  async rename(id, name) {
    const { category } = await raw(`/categories/${id}`, { method: "PATCH", body: { name } });
    return category;
  },
  async remove(id) {
    await raw(`/categories/${id}`, { method: "DELETE" });
  },
  async addSubcategory(categoryId, name) {
    const { subcategory } = await raw(`/categories/${categoryId}/subcategories`, { method: "POST", body: { name } });
    return subcategory;
  },
  async renameSubcategory(subId, name) {
    const { subcategory } = await raw(`/categories/subcategories/${subId}`, { method: "PATCH", body: { name } });
    return subcategory;
  },
  async removeSubcategory(subId) {
    await raw(`/categories/subcategories/${subId}`, { method: "DELETE" });
  },
};

/* ----------------------------- wallets ------------------------------ */

const wallets = {
  async list() {
    const { wallets } = await raw("/wallets");
    return wallets; // [{ id, type: "PERSONAL"|"SHARED", name, members }]
  },
  async create(name) {
    const { wallet } = await raw("/wallets", { method: "POST", body: { name } });
    return wallet;
  },
  async removeMember(walletId, userId) {
    await raw(`/wallets/${walletId}/members/${userId}`, { method: "DELETE" });
  },
  async invite(walletId, phone, options = {}) {
    const { invite } = await raw(`/wallets/${walletId}/invite`, { method: "POST", body: { phone, ...options } });
    return invite;
  },
  async myInvites() {
    const { invites } = await raw("/wallets/invites");
    return invites;
  },
  async sentInvites(walletId) {
    return raw(`/wallets/${walletId}/invites`); // { invites, maxMembers, acceptedCount, pendingCount }
  },
  async acceptInvite(inviteId) {
    await raw(`/wallets/invites/${inviteId}/accept`, { method: "POST" });
  },
  async declineInvite(inviteId) {
    await raw(`/wallets/invites/${inviteId}/decline`, { method: "POST" });
  },
  async revokeInvite(walletId, inviteId) {
    await raw(`/wallets/${walletId}/invites/${inviteId}`, { method: "DELETE" });
  },
};

/* --------------------------- transactions ---------------------------- */
// Frontend tx shape: { id, amount, merchant, category, subcategory, date, wallet, loggedBy }
// Backend tx shape:  { id, amount, merchant, categoryId, category:{name}, subcategoryId, subcategory:{name}, date, walletId, loggedByName }

function toFrontendTx(t, walletTypeById) {
  return {
    id: t.id,
    amount: Number(t.amount),
    merchant: t.merchant,
    category: t.category?.name,
    subcategory: t.subcategory?.name || null,
    date: t.date.slice(0, 10),
    wallet: walletTypeById[t.walletId] === "SHARED" ? "shared" : "personal",
    loggedBy: t.loggedByName,
    loggedByUserId: t.loggedByUserId || null,
    note: t.note || undefined,
    photoUrl: t.photoUrl || undefined,
    reference: t.reference || undefined,
    source: t.source || "manual",
  };
}

function toBackendTxInput({ tx, categoryIdByName, subcategoryIdByName, walletIdByType, source }) {
  return {
    walletId: walletIdByType[tx.wallet] || walletIdByType.personal,
    categoryId: categoryIdByName[tx.category],
    subcategoryId: tx.subcategory ? subcategoryIdByName[tx.subcategory] || null : null,
    amount: tx.amount,
    merchant: tx.merchant,
    note: tx.note || null,
    photoUrl: tx.photoUrl || null,
    date: new Date(tx.date || Date.now()).toISOString(),
    source: source || "manual",
  };
}

const transactions = {
  async list({ walletTypeById }) {
    const { transactions } = await raw("/transactions");
    return transactions.map((t) => toFrontendTx(t, walletTypeById));
  },
  downloadExportCsv: (from, to) => downloadFile(`/transactions?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), format: "csv" })}`, `mitapesa-transactions-${from}-to-${to}.csv`),
  async create(tx, ctx) {
    const body = toBackendTxInput({ tx, ...ctx });
    const { transaction } = await raw("/transactions", { method: "POST", body });
    return toFrontendTx(transaction, ctx.walletTypeById);
  },
  async createMany(txs, ctx) {
    const body = txs.map((tx) => toBackendTxInput({ tx, ...ctx }));
    const { transactions } = await raw("/transactions/bulk", { method: "POST", body: { transactions: body } });
    return transactions.map((t) => toFrontendTx(t, ctx.walletTypeById));
  },
  async update(id, patch, ctx) {
    const body = {};
    if (patch.amount !== undefined) body.amount = patch.amount;
    if (patch.merchant !== undefined) body.merchant = patch.merchant;
    if (patch.date !== undefined) body.date = new Date(patch.date).toISOString();
    if (patch.category !== undefined) body.categoryId = ctx.categoryIdByName[patch.category];
    if (patch.subcategory !== undefined) body.subcategoryId = patch.subcategory ? ctx.subcategoryIdByName[patch.subcategory] : null;
    const { transaction } = await raw(`/transactions/${id}`, { method: "PATCH", body });
    return toFrontendTx(transaction, ctx.walletTypeById);
  },
  async remove(id) {
    await raw(`/transactions/${id}`, { method: "DELETE" });
  },
  async removeMany(ids) {
    await raw("/transactions/bulk-delete", { method: "POST", body: { ids } });
  },
};

/* ----------------------------- budgets ------------------------------ */
// Frontend shape: { category: name, limit }. Backend: { id, categoryId, category:{name}, limit }.

const budgets = {
  async list() {
    const { budgets } = await raw("/budgets");
    return budgets.map((b) => ({ id: b.id, category: b.category.name, categoryId: b.categoryId, limit: Number(b.limit) }));
  },
  async upsert(categoryId, limit, period = "monthly") {
    const { budget } = await raw("/budgets", { method: "PUT", body: { categoryId, limit, period } });
    return { id: budget.id, category: budget.category.name, categoryId: budget.categoryId, limit: Number(budget.limit) };
  },
  async remove(id) {
    await raw(`/budgets/${id}`, { method: "DELETE" });
  },
};

/* ------------------------------- kyc --------------------------------- */

const kyc = {
  status: () => raw("/kyc/status"),
  lookup: (nidaNumber) => raw("/kyc/lookup", { method: "POST", body: { nidaNumber } }), // -> { maskedName, maskedPhone }
  sendOtp: () => raw("/kyc/otp/send", { method: "POST" }), // -> { sent, expiresInSec }
  verifyOtp: (code) => raw("/kyc/otp/verify", { method: "POST", body: { code } }), // -> { verified }
  kbvQuestions: () => raw("/kyc/kbv/questions"), // -> { questions }
  verifyKbv: (answers) => raw("/kyc/kbv/verify", { method: "POST", body: { answers } }), // -> { verified, correctCount }
};

/* ------------------------------- cards -------------------------------- */

const cards = {
  me: () => raw("/cards/me"), // -> { card, activity }
  freeze: (frozen) => raw("/cards/freeze", { method: "POST", body: { frozen } }),
  controls: (controls) => raw("/cards/controls", { method: "POST", body: controls }),
  dailyLimit: (dailyLimit) => raw("/cards/daily-limit", { method: "POST", body: { dailyLimit } }),
  topupGateway: (paymentToken, amount) => raw("/cards/topup/gateway", { method: "POST", body: { paymentToken, amount }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  topupOct: (paymentToken, amount) => raw("/cards/topup/oct", { method: "POST", body: { paymentToken, amount }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  resolveLipa: (destination) => raw("/cards/pay/lipa/resolve", { method: "POST", body: { destination } }).then((d) => d.recipient),
  payLipa: (destination, amount, categoryId) => raw("/cards/pay/lipa", { method: "POST", body: { destination, amount, categoryId }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  payGepg: (control, amount, biller, categoryId) => raw("/cards/pay/gepg", { method: "POST", body: { control, amount, biller, categoryId }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  payLuku: (meter, amount, categoryId) => raw("/cards/pay/luku", { method: "POST", body: { meter, amount, categoryId }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  reveal: () => raw("/cards/me/reveal"),
  statement: (from, to) => raw(`/cards/me/statement?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`),
  downloadStatementCsv: (from, to) => downloadFile(`/cards/me/statement?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), format: "csv" })}`, "mitapesa-statement.csv"),
};

/* --------------------------- virtual cards ---------------------------- */

const virtualCards = {
  list: () => raw("/virtual-cards").then((d) => d.cards),
  get: (id) => raw(`/virtual-cards/${id}`).then((d) => d.card),
  activity: (id) => raw(`/virtual-cards/${id}/activity`).then((d) => d.activity),
  insights: (id) => raw(`/virtual-cards/${id}/insights`),
  createParentLinked: (walletId, holderUserId, label) => raw("/virtual-cards/parent-linked", { method: "POST", body: { walletId, holderUserId, label } }).then((d) => d.card),
  createIndependent: (label) => raw("/virtual-cards/independent", { method: "POST", body: { label } }).then((d) => d.card),
  topup: (id, amount) => raw(`/virtual-cards/${id}/topup`, { method: "POST", body: { amount }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }).then((d) => d.card),
  transferToMain: (id, amount) => raw(`/virtual-cards/${id}/transfer-to-main`, { method: "POST", body: { amount }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }).then((d) => d.card),
  setLimit: (id, dailyLimit) => raw(`/virtual-cards/${id}/limit`, { method: "POST", body: { dailyLimit } }).then((d) => d.card),
  setFrozen: (id, frozen) => raw(`/virtual-cards/${id}/freeze`, { method: "POST", body: { frozen } }).then((d) => d.card),
  terminate: (id) => raw(`/virtual-cards/${id}/terminate`, { method: "POST" }).then((d) => d.card),
  setCategories: (id, categoryIds) => raw(`/virtual-cards/${id}/categories`, { method: "POST", body: { categoryIds } }).then((d) => d.card),
  setServices: (id, services) => raw(`/virtual-cards/${id}/services`, { method: "POST", body: { services } }).then((d) => d.card),
  resolveLipa: (id, destination) => raw(`/virtual-cards/${id}/pay/lipa/resolve`, { method: "POST", body: { destination } }).then((d) => d.recipient),
  payLipa: (id, destination, amount, categoryId) => raw(`/virtual-cards/${id}/pay/lipa`, { method: "POST", body: { destination, amount, categoryId }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  payGepg: (id, control, amount, biller, categoryId) => raw(`/virtual-cards/${id}/pay/gepg`, { method: "POST", body: { control, amount, biller, categoryId }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  payLuku: (id, meter, amount, categoryId) => raw(`/virtual-cards/${id}/pay/luku`, { method: "POST", body: { meter, amount, categoryId }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  spend: (id, amount, merchant, categoryId, serviceType = "other") => raw(`/virtual-cards/${id}/spend`, { method: "POST", body: { amount, merchant, categoryId, serviceType }, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  reveal: (id) => raw(`/virtual-cards/${id}/reveal`),
  statement: (id, from, to) => raw(`/virtual-cards/${id}/statement?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) })}`),
  downloadStatementCsv: (id, from, to) => downloadFile(`/virtual-cards/${id}/statement?${new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}), format: "csv" })}`, "mitapesa-statement.csv"),
};

/* ------------------------------ QR payments ------------------------------ */

const qr = {
  resolve: (payload) => raw("/qr/resolve", { method: "POST", body: { payload } }),
  resolveAlias: (aliasMerchantId) => raw("/qr/resolve-alias", { method: "POST", body: { aliasMerchantId } }),
  pay: (body) => raw("/qr/pay", { method: "POST", body, extraHeaders: { "Idempotency-Key": newIdempotencyKey() } }),
  status: (reference) => raw(`/qr/payments/${reference}`),
  history: () => raw("/qr/payments").then((d) => d.payments),
  devSamples: () => raw("/qr/dev/sample-payloads"),
};

const settingsPublic = () => raw("/settings/public").then((d) => d.settings);

/* ------------------------------ biometric login (WebAuthn) ------------------------------ */

const webauthn = {
  // A capability check, not a policy check — whether the feature is turned
  // on for this app is a separate call to settingsPublic().
  isSupported: () => typeof window !== "undefined" && !!window.PublicKeyCredential,

  // Enrolls the CURRENTLY LOGGED IN user's device. Call after a normal
  // password login, from a "Set up Face ID / fingerprint" prompt.
  async registerDevice(deviceLabel) {
    const options = await raw("/auth/webauthn/register/options", { method: "POST" });
    const response = await startRegistration(options);
    return raw("/auth/webauthn/register/verify", { method: "POST", body: { response, deviceLabel } });
  },

  listCredentials: () => raw("/auth/webauthn/credentials").then((d) => d.credentials),
  removeCredential: (id) => raw(`/auth/webauthn/credentials/${id}`, { method: "DELETE" }),

  // Full biometric login: options -> browser prompt -> verify -> tokens.
  async loginWithDevice(email) {
    const { options, userId } = await raw("/auth/webauthn/login/options", { method: "POST", body: { email }, auth: false });
    const response = await startAuthentication(options);
    const data = await raw("/auth/webauthn/login/verify", { method: "POST", body: { userId, response }, auth: false });
    setAccessToken(data.accessToken);
    return data.user;
  },
};

/* ------------------------------ push notifications ------------------------------ */

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

const NATIVE_PUSH_TOKEN_KEY = "mitapesa_native_push_token";

const push = {
  isNative: () => Capacitor.isNativePlatform(),

  isSupported: () => push.isNative() || (typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window),

  getVapidPublicKey: () => raw("/push/vapid-public-key", { auth: false }),

  async getCurrentSubscription() {
    if (push.isNative()) {
      // Native push has no persistent "subscription object" the way the
      // web Push API does — permission-granted plus a token we've already
      // registered is the closest equivalent, since a granted permission
      // means the app will (re-)register on next launch regardless.
      const status = await PushNotifications.checkPermissions();
      return status.receive === "granted" && localStorage.getItem(NATIVE_PUSH_TOKEN_KEY) ? { native: true } : null;
    }
    if (!push.isSupported()) return null;
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  },

  // Triggers the OS-level permission prompt as a side effect — Android
  // grants silently, iOS actually prompts (not that iOS reaches this path
  // yet, since native push there is still on hold behind the paid
  // developer account).
  async subscribeNative() {
    let status = await PushNotifications.checkPermissions();
    if (status.receive === "prompt") status = await PushNotifications.requestPermissions();
    if (status.receive !== "granted") throw new Error("Notification permission was denied. Enable it in your device settings to turn this on.");

    const token = await new Promise((resolve, reject) => {
      PushNotifications.addListener("registration", (t) => resolve(t.value));
      PushNotifications.addListener("registrationError", (err) => reject(new Error(err?.error || "Registration failed")));
      PushNotifications.register();
    });
    await raw("/push/register-device", { method: "POST", body: { token, platform: Capacitor.getPlatform() } });
    localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token);
    return { native: true, token };
  },

  // Triggers the browser's native permission prompt as a side effect of
  // subscribing — there's no separate "ask permission" step in the Push API.
  async subscribe() {
    if (push.isNative()) return push.subscribeNative();
    const { publicKey, enabled } = await push.getVapidPublicKey();
    if (!enabled || !publicKey) throw new Error("Push notifications are currently turned off for this app");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = subscription.toJSON();
    await raw("/push/subscribe", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys } });
    return subscription;
  },

  async unsubscribe() {
    if (push.isNative()) {
      const token = localStorage.getItem(NATIVE_PUSH_TOKEN_KEY);
      if (token) await raw("/push/unregister-device", { method: "POST", body: { token } }).catch(() => {});
      await PushNotifications.unregister().catch(() => {});
      localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY);
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await raw("/push/unsubscribe", { method: "POST", body: { endpoint: subscription.endpoint } }).catch(() => {});
      await subscription.unsubscribe();
    }
  },

  sendTest: () => raw("/push/test", { method: "POST" }),
};

/* ------------------------------ receipt scanning ------------------------------ */

const receipts = {
  scan: (imageBase64, mimeType) => raw("/receipts/scan", { method: "POST", body: { imageBase64, mimeType } }),
};

/* ------------------------------ fee bundles ------------------------------ */

const bundles = {
  list: () => raw("/fees/bundles").then((d) => d.bundles),
  mySubscriptions: () => raw("/fees/bundles/my").then((d) => d.subscriptions),
  purchase: (id) => raw(`/fees/bundles/${id}/purchase`, { method: "POST" }).then((d) => d.subscription),
  setAutoRenew: (subscriptionId, autoRenew) => raw(`/fees/bundles/subscriptions/${subscriptionId}`, { method: "PATCH", body: { autoRenew } }).then((d) => d.subscription),
  cancel: (subscriptionId) => raw(`/fees/bundles/subscriptions/${subscriptionId}/cancel`, { method: "POST" }),
};

/* -------------------------------- support -------------------------------- */

const support = {
  createTicket: (data) => raw("/support/tickets", { method: "POST", body: data }).then((d) => d.ticket),
  listTickets: () => raw("/support/tickets").then((d) => d.tickets),
  getTicket: (id) => raw(`/support/tickets/${id}`).then((d) => d.ticket),
};

/* --------------------------- admin -------------------------------- */

const admin = {
  listUsers: (search = "", page = 1, pageSize = 25) => raw(`/admin/users?${new URLSearchParams({ search, page, pageSize })}`),
  getUserOverview: (userId) => raw(`/admin/users/${userId}/overview`),
  getUserKyc: (userId) => raw(`/admin/users/${userId}/kyc`).then((d) => d.profile),
  listSettings: () => raw("/admin/settings").then((d) => d.settings),
  updateSetting: (key, value) => raw(`/admin/settings/${key}`, { method: "PATCH", body: { value } }),
  listAuditLogs: ({ userId, action, page = 1, pageSize = 25 } = {}) =>
    raw(`/admin/audit-logs?${new URLSearchParams({ ...(userId ? { userId } : {}), ...(action ? { action } : {}), page, pageSize })}`),
};

/* --------------------------- notifications ----------------------------- */

const notifications = {
  list: () => raw("/notifications").then((d) => d.notifications),
  markRead: (id) => raw(`/notifications/${id}/read`, { method: "POST" }),
  markAllRead: () => raw("/notifications/read-all", { method: "POST" }),
  delete: (id) => raw(`/notifications/${id}`, { method: "DELETE" }),
  clearAll: () => raw("/notifications", { method: "DELETE" }),
};

export const api = { auth, categories, wallets, transactions, budgets, kyc, cards, virtualCards, notifications, support, qr, settingsPublic, webauthn, push, bundles, receipts, admin, clearAccessToken };
