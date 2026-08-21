// Same backend as the customer app — the admin API is just a different,
// role-gated set of routes on it, not a separate service.
const BASE_URL = import.meta?.env?.VITE_API_URL || "https://mitapesa-api.dugapay.com";

let accessToken = null;
export function setAccessToken(token) { accessToken = token; }
export function clearAccessToken() { accessToken = null; }

let refreshPromise = null;
async function tryRefresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch(`${BASE_URL}/admin/auth/refresh`, { method: "POST", credentials: "include" })
    .then(async (r) => {
      if (!r.ok) return false;
      const data = await r.json();
      setAccessToken(data.accessToken);
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

const NO_RETRY_PATHS = ["/admin/auth/refresh", "/admin/auth/login", "/admin/auth/verify"];

async function raw(path, { method = "GET", body, retried = false } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    credentials: "include", // sends the httpOnly admin refresh cookie
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && !retried && !NO_RETRY_PATHS.includes(path)) {
    const refreshed = await tryRefresh();
    if (refreshed) return raw(path, { method, body, retried: true });
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      message = data.error || data.message || message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const qs = (params = {}) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return new URLSearchParams(clean).toString();
};

// Fetches a file with proper auth headers and triggers a browser download —
// a plain <a href> can't carry the Authorization header this needs.
async function downloadFile(path, filename) {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
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

export const adminApi = {
  auth: {
    login: (email, password) => raw("/admin/auth/login", { method: "POST", body: { email, password } }),
    verify: (challengeId, code) => raw("/admin/auth/verify", { method: "POST", body: { challengeId, code } }).then((d) => { setAccessToken(d.accessToken); return d; }),
    me: () => raw("/admin/auth/me"),
    logout: async () => { try { await raw("/admin/auth/logout", { method: "POST" }); } finally { clearAccessToken(); } },
    restoreSession: tryRefresh,
  },

  dashboard: () => raw("/admin/dashboard"),
  dashboardTrends: (days = 30) => raw(`/admin/dashboard/trends?days=${days}`).then((d) => d.days),

  users: {
    list: (search, page = 1, pageSize = 25) => raw(`/admin/users?${qs({ search, page, pageSize })}`),
    get: (id) => raw(`/admin/users/${id}`),
    overview: (id) => raw(`/admin/users/${id}/overview`),
    kyc: (id) => raw(`/admin/users/${id}/kyc`),
    transactions: (id, search, limit = 30) => raw(`/admin/users/${id}/transactions?${qs({ search, limit })}`).then((d) => d.transactions),
    statement: (id, from, to) => raw(`/admin/users/${id}/statement?${qs({ from, to })}`),
    downloadStatementCsv: (id, from, to) => downloadFile(`/admin/users/${id}/statement?${qs({ from, to, format: "csv" })}`, `mitapesa-statement-${id}.csv`),
    block: (id, reason) => raw(`/admin/users/${id}/block`, { method: "POST", body: { reason } }),
    unblock: (id) => raw(`/admin/users/${id}/unblock`, { method: "POST" }),
    setRole: (id, role) => raw(`/admin/users/${id}/role`, { method: "POST", body: { role } }),
  },

  staff: {
    list: () => raw("/admin/staff").then((d) => d.staff),
    create: (data) => raw("/admin/staff", { method: "POST", body: data }).then((d) => d.user),
    remove: (id) => raw(`/admin/staff/${id}`, { method: "DELETE" }),
  },

  tickets: {
    list: (filters = {}, page = 1, pageSize = 25) => raw(`/admin/tickets?${qs({ ...filters, page, pageSize })}`),
    create: (data) => raw("/admin/tickets", { method: "POST", body: data }),
    update: (id, data) => raw(`/admin/tickets/${id}`, { method: "PATCH", body: data }),
  },

  settings: {
    list: () => raw("/admin/settings").then((d) => d.settings),
    update: (key, value) => raw(`/admin/settings/${key}`, { method: "PATCH", body: { value } }),
  },

  auditLogs: (filters = {}, page = 1, pageSize = 25) => raw(`/admin/audit-logs?${qs({ ...filters, page, pageSize })}`),

  broadcasts: {
    send: (title, message, url) => raw("/admin/broadcast", { method: "POST", body: { title, message, url } }),
    list: (page = 1, pageSize = 25) => raw(`/admin/broadcasts?${qs({ page, pageSize })}`),
  },

  institutions: {
    list: (search, active) => raw(`/admin/institutions?${qs({ search, active })}`).then((d) => d.institutions),
    get: (id) => raw(`/admin/institutions/${id}`).then((d) => d.institution),
    create: (data) => raw("/admin/institutions", { method: "POST", body: data }).then((d) => d.institution),
    update: (id, data) => raw(`/admin/institutions/${id}`, { method: "PATCH", body: data }).then((d) => d.institution),
    remove: (id) => raw(`/admin/institutions/${id}`, { method: "DELETE" }),
  },

  fees: {
    transactionTypes: {
      list: () => raw("/admin/fees/transaction-types").then((d) => d.transactionTypes),
      create: (data) => raw("/admin/fees/transaction-types", { method: "POST", body: data }).then((d) => d.transactionType),
      update: (id, data) => raw(`/admin/fees/transaction-types/${id}`, { method: "PATCH", body: data }).then((d) => d.transactionType),
    },
    rules: {
      list: (filters = {}) => raw(`/admin/fees/rules?${qs(filters)}`).then((d) => d.rules),
      get: (id) => raw(`/admin/fees/rules/${id}`).then((d) => d.rule),
      create: (data) => raw("/admin/fees/rules", { method: "POST", body: data }).then((d) => d.rule),
      update: (id, data) => raw(`/admin/fees/rules/${id}`, { method: "PATCH", body: data }).then((d) => d.rule),
      clone: (id) => raw(`/admin/fees/rules/${id}/clone`, { method: "POST" }).then((d) => d.rule),
      submit: (id, changeNote) => raw(`/admin/fees/rules/${id}/submit`, { method: "POST", body: { changeNote } }),
      approve: (id, approve, reviewNote) => raw(`/admin/fees/rules/${id}/approve`, { method: "POST", body: { approve, reviewNote } }),
      deactivate: (id) => raw(`/admin/fees/rules/${id}/deactivate`, { method: "POST" }),
    },
    approvals: {
      list: (status) => raw(`/admin/fees/approvals?${qs({ status })}`).then((d) => d.approvals),
    },
    bundles: {
      list: () => raw("/admin/fees/bundles").then((d) => d.bundles),
      create: (data) => raw("/admin/fees/bundles", { method: "POST", body: data }).then((d) => d.bundle),
      update: (id, data) => raw(`/admin/fees/bundles/${id}`, { method: "PATCH", body: data }).then((d) => d.bundle),
      remove: (id) => raw(`/admin/fees/bundles/${id}`, { method: "DELETE" }),
      processRenewals: () => raw("/admin/fees/bundles/process-renewals", { method: "POST" }),
    },
    exemptions: {
      list: (userId) => raw(`/admin/fees/exemptions?${qs({ userId })}`).then((d) => d.exemptions),
      create: (data) => raw("/admin/fees/exemptions", { method: "POST", body: data }).then((d) => d.exemption),
      revoke: (id) => raw(`/admin/fees/exemptions/${id}/revoke`, { method: "POST" }),
    },
    report: (from, to) => raw(`/admin/fees/report?${qs({ from, to })}`),
    downloadReportCsv: (from, to) => downloadFile(`/admin/fees/report?${qs({ from, to, format: "csv" })}`, "mitapesa-fee-revenue.csv"),
    downloadReportDetailCsv: (from, to) => downloadFile(`/admin/fees/report/detail?${qs({ from, to, format: "csv" })}`, "mitapesa-fee-transactions.csv"),
  },

  reconciliation: {
    run: (date) => raw("/admin/reconciliation/run", { method: "POST", body: { date } }),
    exceptions: (status, page = 1, pageSize = 25) => raw(`/admin/reconciliation/exceptions?${qs({ status, page, pageSize })}`),
    updateException: (id, data) => raw(`/admin/reconciliation/exceptions/${id}`, { method: "PATCH", body: data }),
  },

  exchangeRates: {
    list: () => raw("/admin/exchange-rates").then((d) => d.rates),
    upsert: (currency, rateToTZS) => raw(`/admin/exchange-rates/${currency}`, { method: "PUT", body: { rateToTZS } }).then((d) => d.rate),
    remove: (currency) => raw(`/admin/exchange-rates/${currency}`, { method: "DELETE" }),
  },
};
