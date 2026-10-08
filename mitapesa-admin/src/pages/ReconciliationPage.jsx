import { useEffect, useState } from "react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, Pagination, EmptyState, fmtTZS } from "../components/ui.jsx";

const STATUS_TONE = { open: "bad", investigating: "warn", resolved: "good" };

function RunReconciliationCard({ onRun, canRun }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true); setError(""); setResult(null);
    try {
      const r = await adminApi.reconciliation.run(date);
      setResult(r);
      onRun();
    } catch (err) {
      setError(err.message || "Reconciliation run failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card className="p-5 mb-6">
      <p className="text-[15px] font-bold font-display text-ink mb-1">Run reconciliation</p>
      <p className="text-[13px] text-inkFaint mb-4">Compares the wallet ledger against simulated CBS settlement and TIPS entries for a given day. Safe to re-run — it never duplicates an exception already open for the same payment and reason.</p>
      {canRun ? (
        <div className="flex gap-2 mb-4">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[180px]" />
          <Button variant="accent" onClick={run} disabled={running} className="flex items-center gap-1.5"><RefreshCw size={14} className={running ? "animate-spin" : ""} /> {running ? "Running…" : "Run"}</Button>
        </div>
      ) : (
        <p className="text-[12.5px] text-inkFaint mb-4">Only a super admin can run reconciliation. You can still view and work the exception queue below.</p>
      )}

      {error && <p className="text-[13px] text-danger mb-3">{error}</p>}

      {result && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg bg-bgSoft"><p className="text-[10.5px] text-inkFaint mb-0.5">Payments checked</p><p className="text-[16px] font-bold text-ink">{result.paymentsChecked}</p></div>
          <div className="p-3 rounded-lg bg-bgSoft"><p className="text-[10.5px] text-inkFaint mb-0.5">Wallet total</p><p className="text-[16px] font-bold text-ink">{fmtTZS(result.walletTotal)}</p></div>
          <div className="p-3 rounded-lg bg-bgSoft"><p className="text-[10.5px] text-inkFaint mb-0.5">CBS settlement total</p><p className="text-[16px] font-bold text-ink">{fmtTZS(result.cbsSettlementTotal)}</p></div>
          <div className={`p-3 rounded-lg ${result.balanced ? "bg-accentSoft" : "bg-dangerSoft"}`}>
            <p className="text-[10.5px] text-inkFaint mb-0.5">Balanced</p>
            <p className={`text-[16px] font-bold flex items-center gap-1 ${result.balanced ? "text-accent" : "text-danger"}`}>
              {result.balanced ? <Check size={16} /> : <AlertTriangle size={16} />} {result.balanced ? "Yes" : "No"}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-bgSoft col-span-2"><p className="text-[10.5px] text-inkFaint mb-0.5">TIPS total (off-us)</p><p className="text-[16px] font-bold text-ink">{fmtTZS(result.tipsTotal)}</p></div>
          <div className="p-3 rounded-lg bg-bgSoft col-span-2"><p className="text-[10.5px] text-inkFaint mb-0.5">New exceptions raised</p><p className="text-[16px] font-bold text-ink">{result.newExceptions} <span className="text-[12px] font-normal text-inkFaint">({result.totalExceptions} found this run)</span></p></div>
        </div>
      )}
    </Card>
  );
}

function ExceptionCard({ exception, onUpdated }) {
  const [notes, setNotes] = useState(exception.resolutionNotes || "");
  const [saving, setSaving] = useState(false);

  const setStatus = async (status) => {
    setSaving(true);
    try { await adminApi.reconciliation.updateException(exception.id, { status, resolutionNotes: notes }); onUpdated(); }
    finally { setSaving(false); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[13px] font-semibold text-ink">{exception.reference}</p>
        <Badge tone={STATUS_TONE[exception.status]}>{exception.status}</Badge>
      </div>
      <p className="text-[13px] text-inkSoft mb-2">{exception.reason}</p>
      {exception.detail && Object.keys(exception.detail).length > 0 && (
        <pre className="text-[11px] text-inkFaint bg-bgSoft rounded-lg p-2.5 mb-3 overflow-x-auto">{JSON.stringify(exception.detail, null, 2)}</pre>
      )}
      <p className="text-[11px] text-inkFaint mb-3">Raised {new Date(exception.createdAt).toLocaleString()}{exception.resolvedAt ? ` · resolved ${new Date(exception.resolvedAt).toLocaleString()}` : ""}</p>

      {exception.status !== "resolved" && (
        <>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Investigation notes (optional)" className="mb-2" />
          <div className="flex gap-2">
            {exception.status === "open" && <Button variant="ghost" onClick={() => setStatus("investigating")} disabled={saving}>Mark investigating</Button>}
            <Button variant="accent" onClick={() => setStatus("resolved")} disabled={saving}>Mark resolved</Button>
          </div>
        </>
      )}
      {exception.status === "resolved" && exception.resolutionNotes && (
        <p className="text-[12px] text-inkSoft italic">"{exception.resolutionNotes}"</p>
      )}
    </Card>
  );
}

export default function ReconciliationPage({ user }) {
  const [statusFilter, setStatusFilter] = useState("open");
  const [exceptions, setExceptions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 20;

  const load = () => {
    setLoading(true);
    adminApi.reconciliation.exceptions(statusFilter, page, pageSize)
      .then((r) => { setExceptions(r.exceptions); setTotal(r.total); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [statusFilter, page]);

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Reconciliation</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">Daily check between the wallet ledger and simulated CBS/TIPS settlement — catches anything that completed on one side but not the other.</p>

      <RunReconciliationCard onRun={load} canRun={user.role === "admin_super"} />

      <div className="flex items-center justify-between mb-4">
        <p className="text-[15px] font-bold font-display text-ink">Exception queue</p>
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-auto">
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
          <option value="">All</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : exceptions.length === 0 ? (
        <EmptyState title="Nothing here" sub="No exceptions match this filter." />
      ) : (
        <div className="space-y-3">
          {exceptions.map((ex) => <ExceptionCard key={ex.id} exception={ex} onUpdated={load} />)}
        </div>
      )}
      {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}
    </div>
  );
}
