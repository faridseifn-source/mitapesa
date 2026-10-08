import { useEffect, useState } from "react";
import { Search, X, Download, RotateCcw, Trash2 } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, StatCard, Pagination, EmptyState, fmtTZS } from "../components/ui.jsx";

const REASON_LABEL = {
  not_using: "Not using the app",
  privacy: "Privacy concerns",
  found_alternative: "Found another app",
  too_complicated: "Too complicated",
  other: "Other",
  not_given: "No reason given",
};
const STATUS_TONE = { archived: "warn", restored: "good", purged: "neutral" };
const STATUS_LABEL = { archived: "In archive", restored: "Restored", purged: "Erased" };
const RANK = { admin_viewer: 0, admin_support: 1, admin_super: 2 };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : "—");
const monthLabel = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

/* ------------------------------ statistics ------------------------------ */
function StatsSection({ stats }) {
  const maxMonth = Math.max(1, ...stats.byMonth.map((m) => m.count));
  const maxReason = Math.max(1, ...stats.byReason.map((r) => r.count));
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard label="Accounts closed" value={stats.totals.all} hint={`${stats.last30Days} in the last 30 days`} />
        <StatCard label="Held in archive" value={stats.totals.archived} hint={stats.retentionDays ? `Erased automatically after ${stats.retentionDays} days` : "Kept until erased by hand"} tone="gold" />
        <StatCard label="Restored" value={stats.totals.restored} tone="accent" />
        <StatCard label="Permanently erased" value={stats.totals.purged} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Average account age" value={stats.avgTenureDays === null ? "—" : `${stats.avgTenureDays} days`} hint="From sign-up to deletion" />
        <StatCard label="Had a card" value={stats.withCard} />
        <StatCard label="Erasing within 7 days" value={stats.expiringIn7Days} tone={stats.expiringIn7Days ? "danger" : "ink"} />
        <StatCard label="Open card closures" value={stats.openClosureRequests} tone={stats.openClosureRequests ? "danger" : "ink"} hint="Deletions waiting on funds" />
      </div>
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-5">
          <p className="text-[13px] font-semibold text-ink mb-4">Closures by month</p>
          <div className="flex items-end gap-1.5 h-32">
            {stats.byMonth.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end h-full" title={`${monthLabel(m.month)}: ${m.count}`}>
                <span className="text-[10px] text-inkFaint mb-1">{m.count || ""}</span>
                <div className="w-full rounded-t bg-accent" style={{ height: `${(m.count / maxMonth) * 100}%`, minHeight: m.count ? 4 : 2, opacity: m.count ? 1 : 0.2 }} />
                <span className="text-[9.5px] text-inkFaint mt-1">{monthLabel(m.month).split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-semibold text-ink mb-4">Why customers leave</p>
          {stats.byReason.length === 0 ? (
            <p className="text-[12.5px] text-inkFaint">No closures yet.</p>
          ) : (
            <div className="space-y-2.5">
              {stats.byReason.map((r) => (
                <div key={r.reason}>
                  <div className="flex justify-between text-[12px] mb-1"><span className="text-inkSoft">{REASON_LABEL[r.reason] || r.reason}</span><span className="font-semibold text-ink">{r.count}</span></div>
                  <div className="h-1.5 rounded-full bg-bgSoft"><div className="h-1.5 rounded-full bg-accent" style={{ width: `${(r.count / maxReason) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/* ------------------------------ detail panel ------------------------------ */
function ArchiveDetailPanel({ archiveId, rank, onClose, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [tx, setTx] = useState(null);
  const [txPage, setTxPage] = useState(1);
  const [txSearch, setTxSearch] = useState("");
  const canManage = rank >= RANK.admin_super;

  const loadDetail = () => {
    setError("");
    adminApi.accountLifecycle.archive(archiveId).then(setDetail).catch((e) => setError(e.message));
  };
  const loadTx = (page = txPage, search = txSearch) => {
    adminApi.accountLifecycle.archiveTransactions(archiveId, { page, pageSize: 15, search }).then(setTx).catch((e) => setTx({ error: e.message, transactions: [], total: 0 }));
  };
  useEffect(() => { loadDetail(); }, [archiveId]);
  useEffect(() => { if (detail?.summary) loadTx(txPage, txSearch); }, [archiveId, txPage, detail?.summary ? 1 : 0]);

  const a = detail?.archive;
  const run = async (key, fn) => {
    setBusy(key); setError("");
    try { await fn(); } catch (e) { setError(e.message || "That didn't work."); } finally { setBusy(""); }
  };

  const doExport = () => run("export", () => adminApi.accountLifecycle.exportArchive(archiveId, a.userId));
  const doRestore = () => {
    const note = window.prompt("Why is this account being restored? This is recorded in the audit log, and the customer is emailed.");
    if (!note || note.trim().length < 3) return;
    run("restore", async () => { await adminApi.accountLifecycle.restore(archiveId, note.trim()); loadDetail(); onChanged(); });
  };
  const doPurge = () => {
    if (!window.confirm("Permanently erase this account's archived data? This cannot be undone — the data and the customer's name, email and phone are deleted. Only the statistics remain.")) return;
    run("purge", async () => { await adminApi.accountLifecycle.purge(archiveId); loadDetail(); onChanged(); });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <p className="text-[15px] font-bold font-display text-ink">Closed account</p>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>
        <div className="p-6">
          {!detail && !error && <div className="flex justify-center py-16"><Spinner /></div>}
          {error && <p className="text-[13px] text-danger mb-4">{error}</p>}
          {detail && (
            <>
              <div className="flex items-start justify-between mb-1">
                <p className="text-[18px] font-bold text-ink">{a.fullName || "Personal details erased"}</p>
                <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
              </div>
              <p className="text-[12.5px] text-inkSoft mb-4">{a.email || "—"}{a.phone ? ` · ${a.phone}` : ""}</p>

              <div className="grid grid-cols-2 gap-3 mb-5">
                <Card className="p-3.5"><p className="text-[10.5px] text-inkFaint">Signed up</p><p className="text-[13px] font-semibold text-ink">{fmtDate(a.accountCreatedAt)}</p></Card>
                <Card className="p-3.5"><p className="text-[10.5px] text-inkFaint">Closed</p><p className="text-[13px] font-semibold text-ink">{fmtDate(a.archivedAt)}</p></Card>
                <Card className="p-3.5"><p className="text-[10.5px] text-inkFaint">Reason</p><p className="text-[13px] font-semibold text-ink">{REASON_LABEL[a.reason || "not_given"]}</p></Card>
                <Card className="p-3.5">
                  <p className="text-[10.5px] text-inkFaint">{a.status === "archived" ? "Erased automatically on" : a.status === "restored" ? "Restored on" : "Erased on"}</p>
                  <p className="text-[13px] font-semibold text-ink">{a.status === "archived" ? (a.purgeAfter ? fmtDate(a.purgeAfter) : "Never (manual)") : fmtDate(a.status === "restored" ? a.restoredAt : a.purgedAt)}</p>
                </Card>
              </div>

              {detail.summary ? (
                <>
                  <p className="text-[12px] font-semibold text-inkFaint uppercase tracking-wide mb-2">What the archive holds</p>
                  <div className="grid grid-cols-3 gap-3 mb-5">
                    {[["Transactions", detail.summary.transactions], ["Budgets", detail.summary.budgets], ["Categories", detail.summary.categories], ["Wallets", detail.summary.wallets], ["Support tickets", detail.summary.supportTickets], ["Entries in shared wallets", detail.summary.loggedInSharedWallets]].map(([l, v]) => (
                      <Card key={l} className="p-3"><p className="text-[10.5px] text-inkFaint">{l}</p><p className="text-[15px] font-bold text-ink">{v}</p></Card>
                    ))}
                  </div>
                  {detail.profile && (
                    <p className="text-[12px] text-inkSoft mb-5">Language {detail.profile.language || "—"} · Currency {detail.profile.preferredCurrency || "—"} · KYC {detail.profile.kycStatus || "—"} · Terms {detail.profile.termsVersion || "—"}</p>
                  )}
                </>
              ) : (
                <p className="text-[12.5px] text-inkFaint mb-5">{a.status === "restored" ? "This account was restored, so its data is live again." : "This archive has been permanently erased. Only the figures above remain."}</p>
              )}

              {detail.card && (
                <p className="text-[12px] text-inkSoft mb-2">Card •••• {detail.card.last4} · {detail.card.frozen ? "locked" : "active"} · balance {fmtTZS(detail.card.balance)}</p>
              )}
              {detail.closureRequests.length > 0 && (
                <p className="text-[12px] text-inkSoft mb-5">Card closure: {detail.closureRequests[0].status} (requested {fmtDate(detail.closureRequests[0].requestedAt)})</p>
              )}

              {a.status === "archived" && (
                <div className="flex flex-wrap gap-2 mb-6">
                  <Button variant="ghost" onClick={doExport} disabled={!!busy}><Download size={14} className="inline mr-1.5 -mt-0.5" />{busy === "export" ? "Preparing…" : "Export all data (JSON)"}</Button>
                  {canManage && <Button variant="accent" onClick={doRestore} disabled={!!busy}><RotateCcw size={14} className="inline mr-1.5 -mt-0.5" />{busy === "restore" ? "Restoring…" : "Restore account"}</Button>}
                  {canManage && <Button variant="danger" onClick={doPurge} disabled={!!busy}><Trash2 size={14} className="inline mr-1.5 -mt-0.5" />{busy === "purge" ? "Erasing…" : "Erase permanently"}</Button>}
                </div>
              )}
              {a.status === "archived" && !canManage && <p className="text-[11.5px] text-inkFaint -mt-3 mb-6">Restoring or erasing needs a super admin.</p>}

              {detail.summary && (
                <>
                  <p className="text-[12px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Archived transactions</p>
                  <div className="flex gap-2 mb-3">
                    <Input placeholder="Search merchant, note or category" value={txSearch} onChange={(e) => setTxSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setTxPage(1), loadTx(1, txSearch))} />
                    <Button variant="ghost" onClick={() => { setTxPage(1); loadTx(1, txSearch); }}><Search size={15} /></Button>
                  </div>
                  {!tx ? <div className="flex justify-center py-6"><Spinner /></div> : tx.error ? <p className="text-[12.5px] text-danger">{tx.error}</p> : (
                    <>
                      <Card className="overflow-hidden">
                        <table className="w-full text-left">
                          <thead><tr className="border-b border-border bg-bgSoft/60">
                            {["Date", "Merchant", "Category", "Amount"].map((h) => <th key={h} className="px-4 py-2.5 text-[10.5px] font-semibold text-inkFaint uppercase tracking-wide">{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {tx.transactions.map((t) => (
                              <tr key={t.id} className="border-b border-border last:border-0">
                                <td className="px-4 py-2.5 text-[12px] text-inkFaint">{fmtDate(t.date)}</td>
                                <td className="px-4 py-2.5 text-[12.5px] text-ink">{t.merchant}{t.note ? <span className="block text-[11px] text-inkFaint">{t.note}</span> : null}{t.hasPhoto ? <span className="text-[10.5px] text-inkFaint"> · receipt photo (in export)</span> : null}</td>
                                <td className="px-4 py-2.5 text-[12px] text-inkSoft">{t.category}</td>
                                <td className={`px-4 py-2.5 text-[12.5px] font-mono font-semibold text-right ${t.amount > 0 ? "text-accent" : "text-ink"}`}>{t.amount > 0 ? "+" : ""}{fmtTZS(t.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {tx.transactions.length === 0 && <EmptyState title="No transactions" sub="Nothing matches this search." />}
                      </Card>
                      {tx.total > 0 && <Pagination page={txPage} pageSize={15} total={tx.total} onPageChange={setTxPage} />}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------- archived accounts tab --------------------------- */
function AccountsTab({ rank }) {
  const [stats, setStats] = useState(null);
  const [list, setList] = useState(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");
  const canOpen = rank >= RANK.admin_support;
  const pageSize = 20;

  const loadStats = () => adminApi.accountLifecycle.stats().then(setStats).catch((e) => setError(e.message));
  const loadList = (p = page, s = search, st = status) =>
    adminApi.accountLifecycle.archives({ page: p, pageSize, search: s, status: st }).then(setList).catch((e) => setError(e.message));
  useEffect(() => { loadStats(); }, []);
  useEffect(() => { loadList(page, search, status); }, [page, status]);
  const refresh = () => { loadStats(); loadList(); };

  return (
    <div>
      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}
      {stats ? <StatsSection stats={stats} /> : <div className="flex justify-center py-10"><Spinner /></div>}

      <div className="flex gap-2 mb-4">
        <Input placeholder="Search by name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), loadList(1, search, status))} className="max-w-sm" />
        <Button variant="ghost" onClick={() => { setPage(1); loadList(1, search, status); }}><Search size={15} /></Button>
        <div className="w-44"><Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option><option value="archived">In archive</option><option value="restored">Restored</option><option value="purged">Erased</option>
        </Select></div>
      </div>

      {!list ? <div className="flex justify-center py-12"><Spinner /></div> : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead><tr className="border-b border-border bg-bgSoft/60">
              {["Customer", "Closed", "Reason", "Status", "Erased on", "Entries"].map((h) => <th key={h} className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">{h}</th>)}
            </tr></thead>
            <tbody>
              {list.archives.map((a) => (
                <tr key={a.id} onClick={() => canOpen && setSelectedId(a.id)} className={`border-b border-border last:border-0 ${canOpen ? "hover:bg-bgSoft/50 cursor-pointer" : ""}`}>
                  <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{a.fullName || <span className="text-inkFaint font-normal">Details erased</span>}<span className="block text-[11.5px] font-normal text-inkFaint">{a.email || ""}</span></td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkFaint">{fmtDate(a.archivedAt)}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{REASON_LABEL[a.reason || "not_given"]}</td>
                  <td className="px-5 py-3.5"><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge></td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkFaint">{a.status === "archived" ? (a.purgeAfter ? fmtDate(a.purgeAfter) : "Manual") : "—"}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkFaint">{a.transactionCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.archives.length === 0 && <EmptyState title="No closed accounts" sub="Accounts customers delete will appear here." />}
        </Card>
      )}
      {list && list.total > 0 && <Pagination page={page} pageSize={pageSize} total={list.total} onPageChange={setPage} />}
      {!canOpen && <p className="text-[11.5px] text-inkFaint mt-3">Opening an account's archived data needs a support-level role or higher.</p>}
      {selectedId && <ArchiveDetailPanel archiveId={selectedId} rank={rank} onClose={() => setSelectedId(null)} onChanged={refresh} />}
    </div>
  );
}

/* --------------------------- card closure requests tab --------------------------- */
function ClosuresTab() {
  const [status, setStatus] = useState("pending");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = (s = status) => adminApi.accountLifecycle.closureRequests(s).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(status); }, [status]);

  const resolve = async (r, outcome) => {
    const note = window.prompt(outcome === "closed" ? "Optional note (e.g. the bank's settlement reference):" : "Why is this request declined? The customer will see this.");
    if (note === null) return;
    if (outcome === "rejected" && note.trim().length < 3) { setError("A reason is required to decline."); return; }
    setBusyId(r.id); setError("");
    try { await adminApi.accountLifecycle.resolveClosure(r.id, outcome, note.trim() || undefined); await load(); }
    catch (e) { setError(e.message); } finally { setBusyId(""); }
  };

  return (
    <div>
      <p className="text-[13px] text-inkFaint mb-4 max-w-3xl">
        Raised when a customer tried to delete their account while a card still held money. The card is locked and a closure request has gone to the card issuer. Settle the balance with the bank, then mark the request closed — the customer is notified and can finish deleting their account. A request can't be closed while any funds remain.
      </p>
      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}
      <div className="w-44 mb-4"><Select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="pending">Open</option><option value="closed">Closed</option><option value="rejected">Declined</option><option value="all">All</option>
      </Select></div>
      {!data ? <div className="flex justify-center py-12"><Spinner /></div> : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead><tr className="border-b border-border bg-bgSoft/60">
              {["Customer", "Requested", "Funds at request", "Funds now", "Status", ""].map((h) => <th key={h} className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">{h}</th>)}
            </tr></thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{r.customerName}<span className="block text-[11.5px] font-normal text-inkFaint">{r.email} {r.phone ? `· ${r.phone}` : ""}</span>{r.providerReference && <span className="block text-[10.5px] font-mono text-inkFaint">{r.providerReference}</span>}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkFaint">{fmtDate(r.requestedAt)}</td>
                  <td className="px-5 py-3.5 text-[12.5px] font-mono text-ink">{fmtTZS(r.balance)}</td>
                  <td className="px-5 py-3.5 text-[12.5px] font-mono">{r.currentFunds === null ? "—" : <span className={r.currentFunds > 0 ? "text-danger font-semibold" : "text-accent font-semibold"}>{fmtTZS(r.currentFunds)}</span>}</td>
                  <td className="px-5 py-3.5"><Badge tone={r.status === "pending" ? "warn" : r.status === "closed" ? "good" : "bad"}>{r.status === "pending" ? "Open" : r.status === "closed" ? "Closed" : "Declined"}</Badge>{r.note && <span className="block text-[11px] text-inkFaint mt-1 max-w-[180px]">{r.note}</span>}</td>
                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                    {r.status === "pending" && (
                      <>
                        <Button variant="accent" disabled={busyId === r.id} onClick={() => resolve(r, "closed")} className="mr-2">Mark closed</Button>
                        <Button variant="ghost" disabled={busyId === r.id} onClick={() => resolve(r, "rejected")}>Decline</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.requests.length === 0 && <EmptyState title="No requests" sub={status === "pending" ? "No deletions are waiting on a card closure." : "Nothing here."} />}
        </Card>
      )}
    </div>
  );
}

/* ----------------------------------- page ----------------------------------- */
export default function ClosedAccountsPage({ user }) {
  const rank = RANK[user.role] ?? 0;
  const [tab, setTab] = useState("accounts");
  const canSeeClosures = rank >= RANK.admin_support;

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Closed accounts</h1>
      <p className="text-[13.5px] text-inkFaint mb-5 max-w-3xl">
        When a customer deletes their account, their personal data leaves the app straight away and one copy is held here for a limited time, then permanently erased. Money records (card and payment ledgers, identity checks, fees, audit log) are never part of this archive and are kept separately.
      </p>
      <div className="flex gap-1 mb-6 border-b border-border">
        {[["accounts", "Closed accounts"], ...(canSeeClosures ? [["closures", "Card closure requests"]] : [])].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2.5 text-[13px] font-semibold -mb-px border-b-2 ${tab === k ? "border-accent text-accent" : "border-transparent text-inkFaint hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      {tab === "accounts" ? <AccountsTab rank={rank} /> : <ClosuresTab />}
    </div>
  );
}
