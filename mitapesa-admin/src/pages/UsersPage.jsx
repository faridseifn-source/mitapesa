import { useEffect, useState } from "react";
import { Search, X, ShieldAlert, ShieldCheck, FileText, Eye, Download } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, Pagination, EmptyState, fmtTZS, ROLE_LABEL } from "../components/ui.jsx";

function UserDetailPanel({ userId, canManage, canViewFinancials, currentUserId, onClose, onChanged }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kyc, setKyc] = useState(null);
  const [kycLoading, setKycLoading] = useState(false);
  const [statement, setStatement] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [csvDownloading, setCsvDownloading] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    adminApi.users.overview(userId).then(setOverview).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); setKyc(null); setStatement(null); }, [userId]);

  const loadKyc = () => {
    setKycLoading(true);
    adminApi.users.kyc(userId).then((d) => setKyc(d.profile)).catch((err) => setKyc({ error: err.message })).finally(() => setKycLoading(false));
  };
  const loadStatement = () => {
    setStatementLoading(true);
    adminApi.users.statement(userId).then(setStatement).catch((err) => setError(err.message)).finally(() => setStatementLoading(false));
  };
  const downloadCsv = async () => {
    setCsvDownloading(true); setError("");
    try { await adminApi.users.downloadStatementCsv(userId); }
    catch (err) { setError(err.message || "Couldn't download the statement."); }
    finally { setCsvDownloading(false); }
  };
  const changeRole = async (role) => {
    setRoleSaving(true); setError("");
    try { await adminApi.users.setRole(userId, role); load(); onChanged?.(); }
    catch (err) { setError(err.message || "Couldn't change this user's role."); }
    finally { setRoleSaving(false); }
  };

  const doBlock = async () => {
    if (!blockReason.trim()) return;
    setBlocking(true); setError("");
    try { await adminApi.users.block(userId, blockReason.trim()); load(); onChanged?.(); }
    catch (err) { setError(err.message); }
    finally { setBlocking(false); }
  };
  const doUnblock = async () => {
    setBlocking(true); setError("");
    try { await adminApi.users.unblock(userId); load(); onChanged?.(); }
    catch (err) { setError(err.message); }
    finally { setBlocking(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between">
          <p className="text-[15px] font-bold font-display text-ink">Customer detail</p>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : !overview ? (
            <p className="text-[13px] text-danger">Couldn't load this customer.</p>
          ) : (
            <>
              <div className="mb-5">
                <p className="text-[16px] font-bold text-ink">{overview.user.firstName} {overview.user.lastName}</p>
                <p className="text-[13px] text-inkFaint">{overview.user.email}</p>
                <p className="text-[13px] text-inkFaint font-mono">+255 {overview.user.phone}</p>
                <div className="flex gap-1.5 mt-2">
                  <Badge tone={overview.user.kycStatus === "VERIFIED" ? "good" : "warn"}>{overview.user.kycStatus}</Badge>
                  {overview.user.blockedByAdmin && <Badge tone="bad">BLOCKED</Badge>}
                </div>
              </div>

              {canViewFinancials && overview.card && (
                <Card className="p-4 mb-4">
                  <div className="flex justify-between mb-2"><span className="text-[12px] text-inkFaint">Card balance</span><span className="text-[13px] font-semibold font-mono">{fmtTZS(overview.card.balance)}</span></div>
                  <div className="flex justify-between mb-2"><span className="text-[12px] text-inkFaint">Card status</span><span className="text-[13px] font-semibold">{overview.card.frozen ? "Frozen" : "Active"}</span></div>
                  <div className="flex justify-between mb-2"><span className="text-[12px] text-inkFaint">Add-on cards</span><span className="text-[13px] font-semibold">{overview.virtualCardCount}</span></div>
                  <div className="flex justify-between"><span className="text-[12px] text-inkFaint">Wallets</span><span className="text-[13px] font-semibold">{overview.walletCount}</span></div>
                </Card>
              )}

              {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}

              {canViewFinancials && (
                <div className="space-y-2 mb-4">
                  <button onClick={loadStatement} disabled={statementLoading} className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-border text-[13px] font-semibold text-ink hover:bg-bgSoft">
                    <FileText size={14} /> {statementLoading ? "Loading statement…" : "Pull this month's statement"}
                  </button>
                  <button onClick={downloadCsv} disabled={csvDownloading} className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-border text-[13px] font-semibold text-ink hover:bg-bgSoft">
                    <Download size={14} /> {csvDownloading ? "Preparing…" : "Download this month's statement (CSV)"}
                  </button>
                  {overview.kyc && !kyc && (
                    <button onClick={loadKyc} disabled={kycLoading} className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg border border-border text-[13px] font-semibold text-ink hover:bg-bgSoft">
                      <Eye size={14} /> {kycLoading ? "Loading…" : "View NIDA profile (audit-logged)"}
                    </button>
                  )}
                </div>
              )}

              {statement && (
                <Card className="p-4 mb-4">
                  <p className="text-[12px] font-semibold text-inkFaint mb-2">Statement — {new Date(statement.from).toLocaleDateString()} to {new Date(statement.to).toLocaleDateString()}</p>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div><p className="text-[10.5px] text-inkFaint">Opening</p><p className="text-[13px] font-semibold font-mono">{fmtTZS(statement.openingBalance)}</p></div>
                    <div><p className="text-[10.5px] text-inkFaint">Closing</p><p className="text-[13px] font-semibold font-mono">{fmtTZS(statement.closingBalance)}</p></div>
                    <div><p className="text-[10.5px] text-inkFaint">In</p><p className="text-[13px] font-semibold font-mono text-accent">+{fmtTZS(statement.totalCredits)}</p></div>
                    <div><p className="text-[10.5px] text-inkFaint">Out</p><p className="text-[13px] font-semibold font-mono text-danger">-{fmtTZS(statement.totalDebits)}</p></div>
                  </div>
                  <div className="max-h-52 overflow-y-auto border-t border-border pt-2">
                    {statement.entries.length ? statement.entries.map((e, i) => (
                      <div key={i} className="flex justify-between py-1.5 text-[12px]">
                        <span className="text-inkSoft">{e.label}</span>
                        <span className={`font-mono font-semibold ${e.amount > 0 ? "text-accent" : "text-ink"}`}>{e.amount > 0 ? "+" : ""}{fmtTZS(e.amount)}</span>
                      </div>
                    )) : <p className="text-[12px] text-inkFaint text-center py-3">No transactions this period.</p>}
                  </div>
                </Card>
              )}

              {kyc && (
                <Card className="p-4 mb-4">
                  <p className="text-[12px] font-semibold text-inkFaint mb-2">NIDA profile</p>
                  {kyc.error ? <p className="text-[12.5px] text-danger">{kyc.error}</p> : (
                    <div className="space-y-1">
                      {Object.entries(kyc).filter(([k]) => !["sourceProvider", "syncStatus", "syncError", "syncedAt", "lastAttemptAt", "photoUrl"].includes(k)).map(([k, v]) => (
                        <div key={k} className="flex justify-between text-[11.5px]"><span className="text-inkFaint">{k}</span><span className="font-semibold text-ink">{v || "—"}</span></div>
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {canManage && (
                <Card className="p-4 mb-4">
                  <p className="text-[12px] font-semibold text-inkFaint mb-3">Role</p>
                  {userId === currentUserId ? (
                    <p className="text-[12.5px] text-inkFaint">You can't change your own role here — ask another super admin.</p>
                  ) : (
                    <Select value={overview.user.role} disabled={roleSaving} onChange={(e) => changeRole(e.target.value)}>
                      <option value="customer">Customer (no admin access)</option>
                      <option value="admin_viewer">{ROLE_LABEL.admin_viewer}</option>
                      <option value="admin_support">{ROLE_LABEL.admin_support}</option>
                      <option value="admin_super">{ROLE_LABEL.admin_super}</option>
                    </Select>
                  )}
                </Card>
              )}

              {canManage && (
                <Card className="p-4">
                  <p className="text-[12px] font-semibold text-inkFaint mb-3">Account access</p>
                  {overview.user.blockedByAdmin ? (
                    <>
                      <p className="text-[12.5px] text-ink mb-3">Blocked: {overview.user.blockedReason}</p>
                      <Button variant="accent" disabled={blocking} onClick={doUnblock} className="w-full flex items-center justify-center gap-2"><ShieldCheck size={14} /> Unblock account</Button>
                    </>
                  ) : (
                    <>
                      <Input placeholder="Reason for blocking (required)" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="mb-3" />
                      <Button variant="danger" disabled={blocking || !blockReason.trim()} onClick={doBlock} className="w-full flex items-center justify-center gap-2"><ShieldAlert size={14} /> Block this account</Button>
                    </>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function UsersPage({ user }) {
  const pageSize = 20;
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  const canManage = user.role === "admin_super";
  const canViewFinancials = user.role !== "admin_viewer";

  const load = () => {
    setLoading(true);
    adminApi.users.list(search, page, pageSize).then((r) => { setUsers(r.users); setTotal(r.total); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [page]);

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Mobile app users</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">{canViewFinancials ? "Search, review, and manage customer accounts." : "Limited view — contact a support agent or super admin for account details."}</p>

      <div className="flex gap-2 mb-5">
        <Input placeholder="Search by name, email, or phone" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())} className="max-w-sm" />
        <Button variant="ghost" onClick={() => { setPage(1); load(); }}><Search size={15} /></Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bgSoft/60">
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Name</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Contact</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">KYC</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} onClick={() => setSelectedId(u.id)} className="border-b border-border last:border-0 hover:bg-bgSoft/50 cursor-pointer">
                  <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{u.firstName} {u.lastName} {u.blockedByAdmin && <Badge tone="bad">BLOCKED</Badge>}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{u.email}<br /><span className="font-mono text-[11.5px] text-inkFaint">{u.phone}</span></td>
                  <td className="px-5 py-3.5"><Badge tone={u.kycStatus === "VERIFIED" ? "good" : "warn"}>{u.kycStatus}</Badge></td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkFaint">{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <EmptyState title="No matching users" sub="Try a different search." />}
        </Card>
      )}
      {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}

      {selectedId && (
        <UserDetailPanel userId={selectedId} canManage={canManage} canViewFinancials={canViewFinancials} currentUserId={user.id} onClose={() => setSelectedId(null)} onChanged={load} />
      )}
    </div>
  );
}
