import { useEffect, useState } from "react";
import { Plus, X, RefreshCw } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, fmtTZS } from "../components/ui.jsx";

const emptyForm = {
  nameEn: "", nameSw: "", descriptionEn: "", descriptionSw: "",
  validity: "MONTHLY", price: 0, taxTreatment: "NONE", vatRate: 0, includedTransactionTypeIds: [],
  includedTransactionCount: "", customerSegment: "", maxTransactionValue: "", fairUsageLimit: "",
  autoRenewDefault: false, gracePeriodDays: 0, rolloverUnused: false, cancellable: true, refundable: false, isActive: true,
};

function toFormValues(b) {
  return {
    ...b,
    taxTreatment: b.taxTreatment || "NONE", vatRate: b.vatRate ?? 0,
    includedTransactionCount: b.includedTransactionCount ?? "",
    maxTransactionValue: b.maxTransactionValue ?? "",
    fairUsageLimit: b.fairUsageLimit ?? "",
    customerSegment: b.customerSegment || "",
    descriptionEn: b.descriptionEn || "", descriptionSw: b.descriptionSw || "",
    includedTransactionTypeIds: Array.isArray(b.includedTransactionTypeIds) ? b.includedTransactionTypeIds : [],
  };
}

function toPayload(form) {
  const num = (v) => (v === "" || v === null ? null : Number(v));
  return {
    nameEn: form.nameEn.trim(), nameSw: form.nameSw.trim(),
    descriptionEn: form.descriptionEn.trim() || null, descriptionSw: form.descriptionSw.trim() || null,
    validity: form.validity, price: Number(form.price) || 0,
    taxTreatment: form.taxTreatment, vatRate: Number(form.vatRate) || 0,
    includedTransactionTypeIds: form.includedTransactionTypeIds,
    includedTransactionCount: num(form.includedTransactionCount),
    customerSegment: form.customerSegment.trim() || null,
    maxTransactionValue: num(form.maxTransactionValue),
    fairUsageLimit: num(form.fairUsageLimit),
    autoRenewDefault: !!form.autoRenewDefault, gracePeriodDays: Number(form.gracePeriodDays) || 0,
    rolloverUnused: !!form.rolloverUnused, cancellable: !!form.cancellable, refundable: !!form.refundable, isActive: !!form.isActive,
  };
}

function BundleFormModal({ bundle, transactionTypes, onClose, onSaved }) {
  const isEdit = !!bundle;
  const [form, setForm] = useState(bundle ? toFormValues(bundle) : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const toggleType = (id) => setForm((f) => ({ ...f, includedTransactionTypeIds: f.includedTransactionTypeIds.includes(id) ? f.includedTransactionTypeIds.filter((x) => x !== id) : [...f.includedTransactionTypeIds, id] }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.includedTransactionTypeIds.length) { setError("Select at least one included transaction type."); return; }
    setSaving(true); setError("");
    try {
      const payload = toPayload(form);
      if (isEdit) await adminApi.fees.bundles.update(bundle.id, payload);
      else await adminApi.fees.bundles.create(payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save this bundle.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[15px] font-bold font-display text-ink">{isEdit ? "Edit bundle" : "New bundle"}</p>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>
        <form onSubmit={save}>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Name (English)</label><Input required value={form.nameEn} onChange={set("nameEn")} placeholder="e.g. Monthly Unlimited Lipa" /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Name (Swahili)</label><Input required value={form.nameSw} onChange={set("nameSw")} placeholder="e.g. Kifurushi cha Mwezi" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Description (English)</label><Input value={form.descriptionEn} onChange={set("descriptionEn")} /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Description (Swahili)</label><Input value={form.descriptionSw} onChange={set("descriptionSw")} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Validity</label>
              <Select value={form.validity} onChange={set("validity")}><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></Select>
            </div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Price (TZS)</label><Input type="number" min="0" required value={form.price} onChange={set("price")} /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Included count</label><Input type="number" min="1" value={form.includedTransactionCount} onChange={set("includedTransactionCount")} placeholder="Unlimited" /></div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-1">
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Tax treatment</label>
              <Select value={form.taxTreatment} onChange={set("taxTreatment")}>
                <option value="NONE">No VAT</option>
                <option value="VAT_EXCLUSIVE">VAT added on top of price</option>
                <option value="VAT_INCLUSIVE">Price already includes VAT</option>
              </Select>
            </div>
            {form.taxTreatment !== "NONE" && (
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">VAT rate (%)</label><Input type="number" min="0" max="100" step="0.01" value={form.vatRate} onChange={set("vatRate")} /></div>
            )}
          </div>
          {form.taxTreatment !== "NONE" && Number(form.vatRate) > 0 && (() => {
            const price = Number(form.price) || 0;
            const rate = Number(form.vatRate) || 0;
            const vatAmount = form.taxTreatment === "VAT_EXCLUSIVE" ? Math.round(price * (rate / 100) * 100) / 100 : Math.round((price - price / (1 + rate / 100)) * 100) / 100;
            const total = form.taxTreatment === "VAT_EXCLUSIVE" ? price + vatAmount : price;
            return <p className="text-[11.5px] text-inkFaint mb-3">Customer pays {fmtTZS(total)} total (incl. {fmtTZS(vatAmount)} VAT). Refunded proportionally on cancellation if this bundle is refundable.</p>;
          })()}

          <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Included transaction types</label>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {transactionTypes.map((t) => (
              <button type="button" key={t.id} onClick={() => toggleType(t.id)} className={`px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold border ${form.includedTransactionTypeIds.includes(t.id) ? "bg-accent text-white border-accent" : "bg-white text-inkSoft border-border"}`}>{t.nameEn}</button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Max transaction value</label><Input type="number" min="0" value={form.maxTransactionValue} onChange={set("maxTransactionValue")} placeholder="No limit" /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fair-usage limit</label><Input type="number" min="0" value={form.fairUsageLimit} onChange={set("fairUsageLimit")} placeholder="None" /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Grace period (days)</label><Input type="number" min="0" value={form.gracePeriodDays} onChange={set("gracePeriodDays")} /></div>
          </div>

          <div className="flex flex-wrap gap-4 mb-4">
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={form.autoRenewDefault} onChange={set("autoRenewDefault")} /> Auto-renew by default</label>
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={form.rolloverUnused} onChange={set("rolloverUnused")} /> Unused rolls over</label>
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={form.cancellable} onChange={set("cancellable")} /> Cancellable</label>
            <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={form.refundable} onChange={set("refundable")} /> Refundable</label>
          </div>

          {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
          <Button type="submit" variant="accent" disabled={saving} className="w-full">{saving ? "Saving…" : isEdit ? "Save changes" : "Create bundle"}</Button>
        </form>
      </div>
    </div>
  );
}

export default function FeeBundlesPage({ user }) {
  const canManage = user.role === "admin_super";
  const [bundles, setBundles] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [renewing, setRenewing] = useState(false);
  const [renewalResult, setRenewalResult] = useState(null);

  const runRenewals = async () => {
    setRenewing(true); setError("");
    try {
      const r = await adminApi.fees.bundles.processRenewals();
      setRenewalResult(r);
      load();
    } catch (err) {
      setError(err.message || "Renewal run failed.");
    } finally {
      setRenewing(false);
    }
  };

  const load = () => {
    setLoading(true); setError("");
    Promise.all([adminApi.fees.bundles.list(), adminApi.fees.transactionTypes.list()])
      .then(([b, t]) => { setBundles(b); setTypes(t); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const remove = async (b) => {
    if (!confirm(`Deactivate ${b.nameEn}? Existing subscribers keep their benefits until expiry; no new purchases after this.`)) return;
    try { await adminApi.fees.bundles.remove(b.id); load(); } catch (err) { setError(err.message); }
  };

  const typeNames = (ids) => (ids || []).map((id) => types.find((t) => t.id === id)?.nameEn).filter(Boolean).join(", ");

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold font-display text-ink">Bundles</h1>
        <div className="flex gap-2">
          {canManage && <Button variant="ghost" onClick={runRenewals} disabled={renewing} className="flex items-center gap-1.5"><RefreshCw size={14} className={renewing ? "animate-spin" : ""} /> {renewing ? "Running…" : "Run renewals now"}</Button>}
          {canManage && <Button variant="accent" onClick={() => setEditing({})} className="flex items-center gap-1.5"><Plus size={14} /> New bundle</Button>}
        </div>
      </div>
      <p className="text-[13.5px] text-inkFaint mb-2">Daily, weekly, or monthly packages customers can buy for unlimited or discounted eligible transactions. Auto-renewal runs automatically every 30 minutes — "Run renewals now" is for testing without waiting.</p>
      {renewalResult && <p className="text-[12.5px] text-inkSoft mb-4">Last run: checked {renewalResult.checked}, renewed {renewalResult.renewed}, failed {renewalResult.failed}.</p>}
      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bundles.map((b) => (
            <Card key={b.id} className="p-5">
              <div className="flex items-start justify-between mb-2">
                <div><p className="text-[14px] font-bold text-ink">{b.nameEn}</p><p className="text-[11.5px] text-inkFaint">{b.nameSw}</p></div>
                <Badge tone={b.isActive ? "good" : "bad"}>{b.isActive ? "Active" : "Inactive"}</Badge>
              </div>
              <p className="text-[20px] font-bold font-display text-ink mb-1">{fmtTZS(b.price)}<span className="text-[12px] font-normal text-inkFaint"> / {b.validity.toLowerCase()}</span></p>
              <p className="text-[12px] text-inkSoft mb-3">{b.includedTransactionCount ? `${b.includedTransactionCount} transactions` : "Unlimited"} · {typeNames(b.includedTransactionTypeIds)}</p>
              {canManage && (
                <div className="flex gap-2">
                  <button onClick={() => setEditing(b)} className="text-[12px] font-semibold text-accent">Edit</button>
                  <button onClick={() => remove(b)} className="text-[12px] font-semibold text-danger">Deactivate</button>
                </div>
              )}
            </Card>
          ))}
          {bundles.length === 0 && <div className="col-span-2"><EmptyState title="No bundles yet" sub={canManage ? "Create one to let customers pre-pay for transactions." : "None configured yet."} /></div>}
        </div>
      )}

      {editing !== null && <BundleFormModal bundle={editing.id ? editing : null} transactionTypes={types} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
