import { useEffect, useState } from "react";
import { Plus, X, Search } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, fmtTZS } from "../components/ui.jsx";

const TYPE_LABEL = { bank: "Bank", mno: "Mobile network operator", microfinance: "Microfinance", other: "Other" };
const FEE_LABEL = { none: "No fee", fixed: "Fixed amount", percentage: "Percentage" };

const emptyForm = {
  acquirerId: "", name: "", shortCode: "", swiftCode: "", institutionType: "bank",
  isActive: true, transfersEnabled: true,
  minTransferAmount: 0, maxTransferAmount: "", dailyTransferLimit: "",
  feeType: "none", feeFixedAmount: 0, feePercentage: 0, feeCapAmount: "",
  notes: "",
};

function toFormValues(inst) {
  return {
    ...inst,
    maxTransferAmount: inst.maxTransferAmount ?? "",
    dailyTransferLimit: inst.dailyTransferLimit ?? "",
    feeCapAmount: inst.feeCapAmount ?? "",
    shortCode: inst.shortCode || "",
    swiftCode: inst.swiftCode || "",
    notes: inst.notes || "",
  };
}

function toPayload(form) {
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  return {
    acquirerId: form.acquirerId.trim(),
    name: form.name.trim(),
    shortCode: form.shortCode.trim() || null,
    swiftCode: form.swiftCode.trim() || null,
    institutionType: form.institutionType,
    isActive: !!form.isActive,
    transfersEnabled: !!form.transfersEnabled,
    minTransferAmount: Number(form.minTransferAmount) || 0,
    maxTransferAmount: num(form.maxTransferAmount),
    dailyTransferLimit: num(form.dailyTransferLimit),
    feeType: form.feeType,
    feeFixedAmount: Number(form.feeFixedAmount) || 0,
    feePercentage: Number(form.feePercentage) || 0,
    feeCapAmount: num(form.feeCapAmount),
    notes: form.notes.trim() || null,
  };
}

function InstitutionFormModal({ institution, onClose, onSaved }) {
  const isEdit = !!institution;
  const [form, setForm] = useState(institution ? toFormValues(institution) : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const payload = toPayload(form);
      if (isEdit) await adminApi.institutions.update(institution.id, payload);
      else await adminApi.institutions.create(payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save this institution.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[15px] font-bold font-display text-ink">{isEdit ? "Edit institution" : "Add institution"}</p>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>

        <form onSubmit={save}>
          <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Identification (BOT / TIPS)</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="col-span-2">
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Institution name</label>
              <Input required value={form.name} onChange={set("name")} placeholder="e.g. CRDB Bank PLC" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Acquirer ID (5 digits)</label>
              <Input required value={form.acquirerId} onChange={set("acquirerId")} placeholder="01002" maxLength={5} pattern="\d{5}" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Type</label>
              <Select value={form.institutionType} onChange={set("institutionType")}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Short code</label>
              <Input value={form.shortCode} onChange={set("shortCode")} placeholder="CRDB" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">SWIFT / BIC code</label>
              <Input value={form.swiftCode} onChange={set("swiftCode")} placeholder="CORUTZTZ" />
            </div>
          </div>

          <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Status</p>
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={form.isActive} onChange={set("isActive")} /> Active</label>
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={form.transfersEnabled} onChange={set("transfersEnabled")} /> Transfers enabled</label>
          </div>

          <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Transfer limits (TZS)</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Minimum</label>
              <Input type="number" min="0" value={form.minTransferAmount} onChange={set("minTransferAmount")} />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Maximum</label>
              <Input type="number" min="0" value={form.maxTransferAmount} onChange={set("maxTransferAmount")} placeholder="No cap" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Daily limit</label>
              <Input type="number" min="0" value={form.dailyTransferLimit} onChange={set("dailyTransferLimit")} placeholder="No cap" />
            </div>
          </div>

          <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Transfer fee</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fee type</label>
              <Select value={form.feeType} onChange={set("feeType")}>
                {Object.entries(FEE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
            {form.feeType === "fixed" && (
              <div>
                <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fixed fee (TZS)</label>
                <Input type="number" min="0" value={form.feeFixedAmount} onChange={set("feeFixedAmount")} />
              </div>
            )}
            {form.feeType === "percentage" && (
              <>
                <div>
                  <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Percentage (%)</label>
                  <Input type="number" min="0" max="100" step="0.1" value={form.feePercentage} onChange={set("feePercentage")} />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fee cap (TZS)</label>
                  <Input type="number" min="0" value={form.feeCapAmount} onChange={set("feeCapAmount")} placeholder="No cap" />
                </div>
              </>
            )}
          </div>

          <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Admin notes (optional)</label>
          <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full px-3.5 py-2.5 rounded-lg border border-border bg-white text-[13.5px] text-ink mb-4 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent" placeholder="e.g. Requires manual settlement on weekends" />

          {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
          <Button type="submit" variant="accent" disabled={saving} className="w-full">{saving ? "Saving…" : isEdit ? "Save changes" : "Add institution"}</Button>
        </form>
      </div>
    </div>
  );
}

export default function InstitutionsPage({ user }) {
  const canManage = user.role === "admin_super";
  const [search, setSearch] = useState("");
  const [institutions, setInstitutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...} = edit
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true); setError("");
    adminApi.institutions.list(search).then(setInstitutions).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const remove = async (inst) => {
    if (!confirm(`Remove ${inst.name}? Any off-us transfers to this Acquirer ID will be rejected until it's re-added.`)) return;
    setDeletingId(inst.id);
    try { await adminApi.institutions.remove(inst.id); load(); }
    catch (err) { setError(err.message || "Couldn't remove this institution."); }
    finally { setDeletingId(null); }
  };

  const feeSummary = (inst) => {
    if (inst.feeType === "fixed") return fmtTZS(inst.feeFixedAmount);
    if (inst.feeType === "percentage") return `${inst.feePercentage}%${inst.feeCapAmount ? ` (cap ${fmtTZS(inst.feeCapAmount)})` : ""}`;
    return "Free";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold font-display text-ink">Institutions</h1>
        {canManage && <Button variant="accent" onClick={() => setEditing({})} className="flex items-center gap-1.5"><Plus size={14} /> Add institution</Button>}
      </div>
      <p className="text-[13.5px] text-inkFaint mb-6">Banks and financial institutions for off-us TIPS transfers — identification, status, limits, and fees, all configurable here.</p>

      <div className="flex gap-2 mb-5">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} placeholder="Search by name, Acquirer ID, or short code" className="max-w-sm" />
        <Button variant="ghost" onClick={load}><Search size={15} /></Button>
      </div>

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bgSoft/60">
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Institution</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Acquirer ID</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Fee</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {institutions.map((inst) => (
                <tr key={inst.id} className="border-b border-border last:border-0 hover:bg-bgSoft/40">
                  <td className="px-5 py-3.5">
                    <p className="text-[13px] font-semibold text-ink">{inst.name}</p>
                    <p className="text-[11.5px] text-inkFaint">{TYPE_LABEL[inst.institutionType]}{inst.shortCode ? ` · ${inst.shortCode}` : ""}</p>
                  </td>
                  <td className="px-5 py-3.5 text-[12.5px] font-mono text-inkSoft">{inst.acquirerId}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{feeSummary(inst)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex gap-1.5">
                      <Badge tone={inst.isActive ? "good" : "bad"}>{inst.isActive ? "Active" : "Inactive"}</Badge>
                      {!inst.transfersEnabled && <Badge tone="warn">Transfers off</Badge>}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {canManage && (
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => setEditing(inst)} className="text-[12px] font-semibold text-accent">Edit</button>
                        <button onClick={() => remove(inst)} disabled={deletingId === inst.id} className="text-[12px] font-semibold text-danger">{deletingId === inst.id ? "…" : "Remove"}</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {institutions.length === 0 && <EmptyState title="No institutions configured" sub={canManage ? "Add one to enable off-us transfers to it." : "None configured yet."} />}
        </Card>
      )}

      {editing !== null && <InstitutionFormModal institution={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
