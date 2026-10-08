import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Card, Button, Input, Spinner, Pagination, EmptyState, fmtTZS } from "../components/ui.jsx";
import { adminApi } from "../api.js";

export default function AuditLogPage() {
  const pageSize = 30;
  const [actionFilter, setActionFilter] = useState("");
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    adminApi.auditLogs({ action: actionFilter }, page, pageSize).then((r) => { setLogs(r.logs); setTotal(r.total); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [page]);

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Audit log</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">Every sensitive action taken in MitaPesa — who, what, and when.</p>

      <div className="flex gap-2 mb-5">
        <Input placeholder="Filter by action (e.g. virtualcard, admin.user.blocked)" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (setPage(1), load())} className="max-w-sm" />
        <Button variant="ghost" onClick={() => { setPage(1); load(); }}><Search size={15} /></Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bgSoft/60">
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Action</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">User</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Amount</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">IP</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">When</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 text-[12.5px] font-semibold text-ink font-mono">{l.action}</td>
                  <td className="px-5 py-3 text-[12px] text-inkFaint font-mono">{l.userId ? `${l.userId.slice(0, 10)}…` : "system"}</td>
                  <td className="px-5 py-3 text-[12px] text-inkFaint font-mono">{l.amount !== null ? fmtTZS(l.amount) : "—"}</td>
                  <td className="px-5 py-3 text-[12px] text-inkFaint font-mono">{l.ip || "—"}</td>
                  <td className="px-5 py-3 text-[12px] text-inkFaint">{new Date(l.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <EmptyState title="No matching entries" sub="Try a different filter." />}
        </Card>
      )}
      {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}
    </div>
  );
}
