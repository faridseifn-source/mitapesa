import { useEffect, useState } from "react";
import { Plus, X, Search, ArrowLeft } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, Pagination, EmptyState, fmtTZS } from "../components/ui.jsx";

const STATUS_TONE = { open: "bad", in_progress: "warn", resolved: "good", closed: "neutral" };
const CATEGORY_LABEL = { dispute: "Dispute", inquiry: "Inquiry", complaint: "Complaint", fraud: "Fraud" };
const TX_CATEGORIES = ["dispute", "fraud"]; // categories where "which transaction?" applies

function CustomerPicker({ onPick }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const runSearch = () => {
    if (!search.trim()) return;
    setLoading(true);
    adminApi.users.list(search, 1, 10).then((r) => setResults(r.users)).finally(() => setLoading(false));
  };

  return (
    <div>
      <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Find the customer</label>
      <div className="flex gap-2 mb-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())} placeholder="Name, email, or phone" />
        <Button type="button" variant="ghost" onClick={runSearch}><Search size={15} /></Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : results.length > 0 ? (
        <div className="border border-border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
          {results.map((u) => (
            <button key={u.id} type="button" onClick={() => onPick(u)} className="w-full text-left px-3.5 py-2.5 border-b border-border last:border-0 hover:bg-bgSoft">
              <p className="text-[13px] font-semibold text-ink">{u.firstName} {u.lastName}</p>
              <p className="text-[11.5px] text-inkFaint">{u.email} · {u.phone}</p>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-inkFaint">Search by name, email, or phone to find the customer this request is about.</p>
      )}
    </div>
  );
}

function TransactionPicker({ userId, onPick, onCancel }) {
  const [search, setSearch] = useState("");
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = (q) => {
    setLoading(true);
    adminApi.users.transactions(userId, q, 30).then(setTxs).finally(() => setLoading(false));
  };
  useEffect(() => { load(""); }, [userId]);

  return (
    <div className="mb-3">
      <div className="flex gap-2 mb-2">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), load(search))} placeholder="Filter by merchant" />
        <Button type="button" variant="ghost" onClick={() => load(search)}><Search size={14} /></Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
          {txs.length ? txs.map((tx) => (
            <button key={tx.id} type="button" onClick={() => onPick(tx)} className="w-full flex items-center justify-between text-left px-3.5 py-2.5 border-b border-border last:border-0 hover:bg-bgSoft">
              <div><p className="text-[12.5px] font-semibold text-ink">{tx.merchant}</p><p className="text-[11px] text-inkFaint">{new Date(tx.date).toLocaleDateString()}{tx.reference ? ` · ${tx.reference}` : ""}</p></div>
              <p className="text-[12.5px] font-semibold font-mono">{fmtTZS(tx.amount)}</p>
            </button>
          )) : <p className="text-[12px] text-inkFaint text-center py-4">No transactions found for this customer.</p>}
        </div>
      )}
      <button type="button" onClick={onCancel} className="text-[12px] font-semibold text-inkFaint mt-2">Cancel</button>
    </div>
  );
}

function NewTicketModal({ onClose, onCreated }) {
  const [customer, setCustomer] = useState(null);
  const [category, setCategory] = useState("dispute");
  const [txMode, setTxMode] = useState(null); // null | "none" | "pick" | "manual"
  const [selectedTx, setSelectedTx] = useState(null);
  const [manualRef, setManualRef] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualMerchant, setManualMerchant] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isTxCategory = TX_CATEGORIES.includes(category);
  const canSubmit = subject.trim().length >= 3 && description.trim().length >= 3 &&
    (!isTxCategory || txMode === "none" || (txMode === "pick" && selectedTx) || (txMode === "manual" && manualAmount));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const body = { userId: customer.id, category, subject: subject.trim(), description: description.trim() };
      if (isTxCategory && txMode === "pick" && selectedTx) {
        body.relatedTransactionId = selectedTx.id;
      } else if (isTxCategory && txMode === "manual") {
        if (manualRef) body.disputedReference = manualRef;
        if (manualDate) body.disputedDate = new Date(manualDate).toISOString();
        if (manualAmount) body.disputedAmount = parseFloat(manualAmount);
        if (manualMerchant) body.disputedMerchant = manualMerchant;
      }
      await adminApi.tickets.create(body);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't log this request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[15px] font-bold font-display text-ink">Log a customer request</p>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>

        {!customer ? (
          <CustomerPicker onPick={setCustomer} />
        ) : (
          <form onSubmit={submit}>
            <div className="flex items-center justify-between p-3 rounded-lg bg-bgSoft mb-4">
              <div><p className="text-[13px] font-semibold text-ink">{customer.firstName} {customer.lastName}</p><p className="text-[11.5px] text-inkFaint">{customer.email}</p></div>
              <button type="button" onClick={() => { setCustomer(null); setTxMode(null); setSelectedTx(null); }} className="text-[11.5px] font-semibold text-accent flex items-center gap-1"><ArrowLeft size={12} /> Change</button>
            </div>

            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Category</label>
            <Select value={category} onChange={(e) => { setCategory(e.target.value); setTxMode(null); setSelectedTx(null); }} className="mb-3">
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>

            {isTxCategory && (
              <div className="mb-3">
                <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Is this about a specific transaction?</label>
                {!txMode && (
                  <div className="flex gap-2 mb-1">
                    <Button type="button" variant="ghost" onClick={() => setTxMode("pick")} className="flex-1">Pick from their transactions</Button>
                    <Button type="button" variant="ghost" onClick={() => setTxMode("manual")} className="flex-1">Enter from a statement</Button>
                  </div>
                )}
                {!txMode && <button type="button" onClick={() => setTxMode("none")} className="text-[11.5px] text-inkFaint">Not about a specific transaction →</button>}

                {txMode === "pick" && !selectedTx && (
                  <TransactionPicker userId={customer.id} onPick={setSelectedTx} onCancel={() => setTxMode(null)} />
                )}
                {txMode === "pick" && selectedTx && (
                  <div className="p-3 rounded-lg bg-accentSoft mb-2">
                    <div className="flex items-center justify-between mb-0.5"><p className="text-[12.5px] font-semibold text-ink">{selectedTx.merchant}</p><button type="button" onClick={() => setSelectedTx(null)} className="text-[11px] font-semibold text-accent">Change</button></div>
                    <p className="text-[11.5px] text-inkSoft">{new Date(selectedTx.date).toLocaleDateString()} · {fmtTZS(selectedTx.amount)}{selectedTx.reference ? ` · Ref ${selectedTx.reference}` : ""}</p>
                  </div>
                )}
                {txMode === "manual" && (
                  <div className="space-y-2 mb-2">
                    <Input value={manualRef} onChange={(e) => setManualRef(e.target.value)} placeholder="Reference (if known)" />
                    <Input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
                    <Input type="number" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="Amount" />
                    <Input value={manualMerchant} onChange={(e) => setManualMerchant(e.target.value)} placeholder="Merchant / description (optional)" />
                    <button type="button" onClick={() => { setTxMode(null); setManualRef(""); setManualDate(""); setManualAmount(""); setManualMerchant(""); }} className="text-[11.5px] font-semibold text-inkFaint">Change</button>
                  </div>
                )}
                {txMode === "none" && <p className="text-[11.5px] text-inkFaint">Not tied to a specific transaction. <button type="button" onClick={() => setTxMode(null)} className="text-accent font-semibold">Change</button></p>}
              </div>
            )}

            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Subject</label>
            <Input required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" className="mb-3" />
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Details</label>
            <textarea required value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-white text-[13.5px] text-ink mb-4 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent" placeholder="What did the customer report?" />
            {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
            <Button type="submit" variant="accent" disabled={busy || !canSubmit} className="w-full">{busy ? "Logging…" : "Log request"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function TicketDetail({ ticket, canManage, onClose, onUpdated }) {
  const [status, setStatus] = useState(ticket.status);
  const [notes, setNotes] = useState(ticket.resolutionNotes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true); setError("");
    try {
      await adminApi.tickets.update(ticket.id, { status, resolutionNotes: notes });
      onUpdated();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't update this request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-border px-6 py-4 flex items-center justify-between">
          <p className="text-[15px] font-bold font-display text-ink">Request detail</p>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>
        <div className="p-6">
          <Badge tone={STATUS_TONE[ticket.status]}>{ticket.status.replace("_", " ")}</Badge>
          <p className="text-[16px] font-bold text-ink mt-3">{ticket.subject}</p>
          <p className="text-[12.5px] text-inkFaint mb-1">{CATEGORY_LABEL[ticket.category]} · {ticket.user?.firstName} {ticket.user?.lastName} · +255 {ticket.user?.phone}</p>
          <p className="text-[12px] text-inkFaint mb-4">Logged {new Date(ticket.createdAt).toLocaleString()}</p>
          <Card className="p-4 mb-4">
            <p className="text-[13px] text-ink whitespace-pre-wrap">{ticket.description}</p>
          </Card>

          {(ticket.disputedAmount !== null && ticket.disputedAmount !== undefined) && (
            <Card className="p-4 mb-4">
              <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Disputed transaction</p>
              <div className="space-y-1.5">
                <div className="flex justify-between"><span className="text-[12px] text-inkFaint">Merchant</span><span className="text-[12.5px] font-semibold text-ink">{ticket.disputedMerchant || "—"}</span></div>
                <div className="flex justify-between"><span className="text-[12px] text-inkFaint">Amount</span><span className="text-[12.5px] font-semibold font-mono text-ink">{fmtTZS(ticket.disputedAmount)}</span></div>
                <div className="flex justify-between"><span className="text-[12px] text-inkFaint">Date</span><span className="text-[12.5px] font-semibold text-ink">{ticket.disputedDate ? new Date(ticket.disputedDate).toLocaleDateString() : "—"}</span></div>
                <div className="flex justify-between"><span className="text-[12px] text-inkFaint">Reference</span><span className="text-[12.5px] font-semibold font-mono text-ink">{ticket.disputedReference || "—"}</span></div>
                <div className="flex justify-between"><span className="text-[12px] text-inkFaint">Source</span><span className="text-[12.5px] font-semibold text-ink">{ticket.relatedTransactionId ? "Verified transaction" : "Entered manually"}</span></div>
              </div>
            </Card>
          )}

          {canManage ? (
            <>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Status</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="mb-3">
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </Select>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Resolution notes</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-white text-[13.5px] text-ink mb-4 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent" placeholder="What was done to resolve this?" />
              {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
              <Button variant="accent" disabled={busy} onClick={save} className="w-full">{busy ? "Saving…" : "Save changes"}</Button>
            </>
          ) : (
            ticket.resolutionNotes && (
              <>
                <p className="text-[12px] font-medium text-inkSoft mb-1.5">Resolution notes</p>
                <p className="text-[13px] text-ink whitespace-pre-wrap">{ticket.resolutionNotes}</p>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default function TicketsPage({ user }) {
  const pageSize = 20;
  const canManage = user.role !== "admin_viewer";
  const [statusFilter, setStatusFilter] = useState("");
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const load = () => {
    setLoading(true);
    adminApi.tickets.list({ status: statusFilter }, page, pageSize).then((r) => { setTickets(r.tickets); setTotal(r.total); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [page, statusFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold font-display text-ink">Requests & disputes</h1>
        {canManage && <Button variant="accent" onClick={() => setShowNew(true)} className="flex items-center gap-1.5"><Plus size={14} /> Log a request</Button>}
      </div>
      <p className="text-[13.5px] text-inkFaint mb-6">Customer-raised issues, plus anything logged after a support call.</p>

      <div className="flex gap-2 mb-5">
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="max-w-[200px]">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bgSoft/60">
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Subject</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Customer</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Category</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Logged</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} onClick={() => setSelected(t)} className="border-b border-border last:border-0 hover:bg-bgSoft/50 cursor-pointer">
                  <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{t.subject}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{t.user?.firstName} {t.user?.lastName}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{CATEGORY_LABEL[t.category]}</td>
                  <td className="px-5 py-3.5"><Badge tone={STATUS_TONE[t.status]}>{t.status.replace("_", " ")}</Badge></td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkFaint">{new Date(t.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {tickets.length === 0 && <EmptyState title="Nothing here" sub="No requests match this filter." />}
        </Card>
      )}
      {!loading && total > 0 && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />}

      {selected && <TicketDetail ticket={selected} canManage={canManage} onClose={() => setSelected(null)} onUpdated={load} />}
      {showNew && <NewTicketModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  );
}
