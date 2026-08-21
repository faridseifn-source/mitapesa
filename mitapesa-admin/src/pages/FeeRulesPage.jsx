import { useEffect, useState } from "react";
import { Plus, X, Check, XCircle, Copy, Send, Power, Search } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, fmtTZS } from "../components/ui.jsx";

const STATUS_TONE = { DRAFT: "neutral", PENDING_APPROVAL: "warn", ACTIVE: "good", INACTIVE: "neutral", REJECTED: "bad", ARCHIVED: "neutral" };
const FEE_MODEL_LABEL = { fixed: "Fixed", percentage: "Percentage", tiered: "Tiered", fixed_plus_percentage: "Fixed + %", zero: "Zero (free)", display_only: "Display only (not collected)" };

const emptyTier = () => ({ minAmount: 0, maxAmount: "", feeModel: "fixed", fixedAmount: 0, percentage: 0 });

const emptyRule = {
  name: "", transactionTypeId: "", feeModel: "fixed",
  fixedAmount: 0, percentage: 0, minFee: "", maxFee: "",
  minAmount: "", maxAmount: "", channel: "", onUsOffUs: "", customerSegment: "", accountType: "", merchantCategory: "",
  currency: "TZS", country: "TZ", customerId: "",
  feePayer: "CUSTOMER", taxTreatment: "NONE", vatRate: 0,
  effectiveFrom: new Date().toISOString().slice(0, 10), effectiveTo: "", campaignName: "", priority: 100,
  descriptionEn: "", descriptionSw: "",
  tiers: [emptyTier()],
};

function toFormValues(rule) {
  return {
    ...rule,
    fixedAmount: rule.fixedAmount ?? 0, percentage: rule.percentage ?? 0,
    minFee: rule.minFee ?? "", maxFee: rule.maxFee ?? "",
    minAmount: rule.minAmount ?? "", maxAmount: rule.maxAmount ?? "",
    channel: rule.channel || "", onUsOffUs: rule.onUsOffUs || "", customerSegment: rule.customerSegment || "",
    accountType: rule.accountType || "", merchantCategory: rule.merchantCategory || "", customerId: rule.customerId || "",
    effectiveFrom: rule.effectiveFrom ? rule.effectiveFrom.slice(0, 10) : new Date().toISOString().slice(0, 10),
    effectiveTo: rule.effectiveTo ? rule.effectiveTo.slice(0, 10) : "",
    campaignName: rule.campaignName || "", descriptionEn: rule.descriptionEn || "", descriptionSw: rule.descriptionSw || "",
    tiers: rule.tiers && rule.tiers.length ? rule.tiers.map((t) => ({ ...t, maxAmount: t.maxAmount ?? "" })) : [emptyTier()],
  };
}

function toPayload(form) {
  const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
  const str = (v) => (v === "" ? null : v);
  return {
    name: form.name.trim(), transactionTypeId: form.transactionTypeId, feeModel: form.feeModel,
    fixedAmount: num(form.fixedAmount), percentage: num(form.percentage), minFee: num(form.minFee), maxFee: num(form.maxFee),
    minAmount: num(form.minAmount), maxAmount: num(form.maxAmount),
    channel: str(form.channel), onUsOffUs: str(form.onUsOffUs) || undefined, customerSegment: str(form.customerSegment),
    accountType: str(form.accountType) || undefined, merchantCategory: str(form.merchantCategory), customerId: str(form.customerId),
    currency: form.currency, country: form.country,
    feePayer: form.feePayer, taxTreatment: form.taxTreatment, vatRate: Number(form.vatRate) || 0,
    effectiveFrom: new Date(form.effectiveFrom).toISOString(), effectiveTo: form.effectiveTo ? new Date(form.effectiveTo).toISOString() : null,
    campaignName: str(form.campaignName), priority: Number(form.priority) || 100,
    descriptionEn: str(form.descriptionEn), descriptionSw: str(form.descriptionSw),
    tiers: form.feeModel === "tiered" ? form.tiers.map((t) => ({ minAmount: Number(t.minAmount), maxAmount: num(t.maxAmount), feeModel: t.feeModel, fixedAmount: num(t.fixedAmount), percentage: num(t.percentage) })) : undefined,
  };
}

function RuleFormModal({ rule, transactionTypes, onClose, onSaved }) {
  const isEdit = !!rule;
  const [form, setForm] = useState(rule ? toFormValues(rule) : emptyRule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setTier = (i, key) => (e) => setForm((f) => ({ ...f, tiers: f.tiers.map((t, idx) => (idx === i ? { ...t, [key]: e.target.value } : t)) }));
  const addTier = () => setForm((f) => ({ ...f, tiers: [...f.tiers, emptyTier()] }));
  const removeTier = (i) => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, idx) => idx !== i) }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      const payload = toPayload(form);
      if (isEdit) await adminApi.fees.rules.update(rule.id, payload);
      else await adminApi.fees.rules.create(payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message || "Couldn't save this rule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[15px] font-bold font-display text-ink">{isEdit ? "Edit rule (draft only)" : "New fee rule"}</p>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>

        <form onSubmit={save}>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="col-span-2">
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Rule name</label>
              <Input required value={form.name} onChange={set("name")} placeholder="e.g. QR off-us standard fee" />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Transaction type</label>
              <Select required value={form.transactionTypeId} onChange={set("transactionTypeId")}>
                <option value="">Select…</option>
                {transactionTypes.map((t) => <option key={t.id} value={t.id}>{t.nameEn} ({t.code})</option>)}
              </Select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fee model</label>
              <Select value={form.feeModel} onChange={set("feeModel")}>
                {Object.entries(FEE_MODEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </div>
          </div>

          {form.feeModel === "fixed" && (
            <div className="mb-4"><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fixed fee (TZS)</label><Input type="number" min="0" value={form.fixedAmount} onChange={set("fixedAmount")} /></div>
          )}
          {form.feeModel === "percentage" && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Percentage (%)</label><Input type="number" min="0" max="100" step="0.01" value={form.percentage} onChange={set("percentage")} /></div>
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Min fee</label><Input type="number" min="0" value={form.minFee} onChange={set("minFee")} placeholder="None" /></div>
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Max fee (cap)</label><Input type="number" min="0" value={form.maxFee} onChange={set("maxFee")} placeholder="None" /></div>
            </div>
          )}
          {form.feeModel === "fixed_plus_percentage" && (
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fixed (TZS)</label><Input type="number" min="0" value={form.fixedAmount} onChange={set("fixedAmount")} /></div>
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Plus (%)</label><Input type="number" min="0" max="100" step="0.01" value={form.percentage} onChange={set("percentage")} /></div>
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Min fee</label><Input type="number" min="0" value={form.minFee} onChange={set("minFee")} placeholder="None" /></div>
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Max fee</label><Input type="number" min="0" value={form.maxFee} onChange={set("maxFee")} placeholder="None" /></div>
            </div>
          )}
          {(form.feeModel === "display_only") && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Displayed fixed amount</label><Input type="number" min="0" value={form.fixedAmount} onChange={set("fixedAmount")} /></div>
              <p className="text-[11.5px] text-inkFaint self-end pb-2.5">Shown to the customer, never collected by MitaPesa — e.g. a partner-bank markup.</p>
            </div>
          )}

          {form.feeModel === "tiered" && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-medium text-inkSoft">Tiers (must start at 0, no gaps or overlaps, last tier unbounded)</p>
                <button type="button" onClick={addTier} className="text-[11.5px] font-semibold text-accent">+ Add tier</button>
              </div>
              {form.tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-end">
                  <div className="col-span-2"><Input type="number" min="0" value={t.minAmount} onChange={setTier(i, "minAmount")} placeholder="Min" /></div>
                  <div className="col-span-2"><Input type="number" min="0" value={t.maxAmount} onChange={setTier(i, "maxAmount")} placeholder="Max (blank=∞)" /></div>
                  <div className="col-span-3"><Select value={t.feeModel} onChange={setTier(i, "feeModel")}><option value="fixed">Fixed</option><option value="percentage">Percentage</option></Select></div>
                  <div className="col-span-3">{t.feeModel === "fixed" ? <Input type="number" min="0" value={t.fixedAmount} onChange={setTier(i, "fixedAmount")} placeholder="TZS" /> : <Input type="number" min="0" step="0.01" value={t.percentage} onChange={setTier(i, "percentage")} placeholder="%" />}</div>
                  <div className="col-span-2"><button type="button" onClick={() => removeTier(i)} className="text-[11.5px] font-semibold text-danger">Remove</button></div>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Matching criteria (blank = matches anything)</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Min amount</label><Input type="number" min="0" value={form.minAmount} onChange={set("minAmount")} placeholder="Any" /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Max amount</label><Input type="number" min="0" value={form.maxAmount} onChange={set("maxAmount")} placeholder="Any" /></div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">On-us / off-us</label>
              <Select value={form.onUsOffUs} onChange={set("onUsOffUs")}><option value="">Either</option><option value="ON_US">On-us only</option><option value="OFF_US">Off-us only</option></Select>
            </div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Channel</label>
              <Select value={form.channel} onChange={set("channel")}>
                <option value="">Any channel</option>
                <option value="MOBILE_APP">Mobile app</option>
              </Select>
            </div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Customer segment</label><Input value={form.customerSegment} onChange={set("customerSegment")} placeholder="e.g. RETAIL" /></div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Account type</label>
              <Select value={form.accountType} onChange={set("accountType")}><option value="">Either</option><option value="PERSONAL">Personal</option><option value="SHARED">Shared</option></Select>
            </div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Merchant category (MCC)</label><Input value={form.merchantCategory} onChange={set("merchantCategory")} placeholder="e.g. 5814" /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Individual customer ID (exception)</label><Input value={form.customerId} onChange={set("customerId")} placeholder="Rare — leave blank" /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Priority (lower wins ties)</label><Input type="number" value={form.priority} onChange={set("priority")} /></div>
          </div>

          <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Payer, tax, and schedule</p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Fee payer</label>
              <Select value={form.feePayer} onChange={set("feePayer")}><option value="CUSTOMER">Customer</option><option value="MERCHANT">Merchant</option><option value="PARTNER">Partner</option><option value="MITAPESA">MitaPesa (subsidized)</option></Select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Tax treatment</label>
              <Select value={form.taxTreatment} onChange={set("taxTreatment")}><option value="NONE">None</option><option value="VAT_INCLUSIVE">VAT inclusive</option><option value="VAT_EXCLUSIVE">VAT exclusive</option></Select>
            </div>
            {form.taxTreatment !== "NONE" && <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">VAT rate (%)</label><Input type="number" min="0" max="100" value={form.vatRate} onChange={set("vatRate")} /></div>}
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Effective from</label><Input type="date" required value={form.effectiveFrom} onChange={set("effectiveFrom")} /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Effective to (optional)</label><Input type="date" value={form.effectiveTo} onChange={set("effectiveTo")} /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Campaign name (optional)</label><Input value={form.campaignName} onChange={set("campaignName")} placeholder="e.g. Ramadhani Promo" /></div>
          </div>

          <p className="text-[11px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Customer disclosure</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">English</label><Input value={form.descriptionEn} onChange={set("descriptionEn")} placeholder="Shown to the customer" /></div>
            <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Swahili</label><Input value={form.descriptionSw} onChange={set("descriptionSw")} placeholder="Inaonyeshwa kwa mteja" /></div>
          </div>

          {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
          <Button type="submit" variant="accent" disabled={saving} className="w-full">{saving ? "Saving…" : isEdit ? "Save draft" : "Create draft"}</Button>
          <p className="text-[11px] text-inkFaint text-center mt-2">Saves as a draft — submit for approval afterward to make it live.</p>
        </form>
      </div>
    </div>
  );
}

function RulesTab({ user }) {
  const canEdit = user.role !== "admin_viewer";
  const canApprove = user.role === "admin_super";
  const [types, setTypes] = useState([]);
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setLoading(true); setError("");
    Promise.all([adminApi.fees.transactionTypes.list(), adminApi.fees.rules.list()])
      .then(([t, r]) => { setTypes(t); setRules(r); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const typeName = (id) => types.find((t) => t.id === id)?.nameEn || "—";

  const submit = async (id) => {
    setBusyId(id); setError("");
    try { await adminApi.fees.rules.submit(id); load(); }
    catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };
  const clone = async (id) => {
    setBusyId(id); setError("");
    try { const cloned = await adminApi.fees.rules.clone(id); load(); setEditing(cloned); }
    catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };
  const deactivate = async (id) => {
    if (!confirm("Deactivate this active rule? Transactions will fall back to the next-best rule, or free if none matches.")) return;
    setBusyId(id); setError("");
    try { await adminApi.fees.rules.deactivate(id); load(); }
    catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };

  const feeSummary = (r) => {
    if (r.feeModel === "zero") return "Free";
    if (r.feeModel === "display_only") return `${fmtTZS(r.fixedAmount)} (display only)`;
    if (r.feeModel === "fixed") return fmtTZS(r.fixedAmount);
    if (r.feeModel === "percentage") return `${r.percentage}%${r.maxFee ? ` (cap ${fmtTZS(r.maxFee)})` : ""}`;
    if (r.feeModel === "fixed_plus_percentage") return `${fmtTZS(r.fixedAmount)} + ${r.percentage}%`;
    if (r.feeModel === "tiered") return `${r.tiers?.length || 0} tiers`;
    return "—";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13.5px] text-inkFaint">Every rule starts as a draft and needs approval from a different super admin before it prices real transactions.</p>
        {canEdit && <Button variant="accent" onClick={() => setEditing({})} className="flex items-center gap-1.5"><Plus size={14} /> New rule</Button>}
      </div>
      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-bgSoft/60">
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Rule</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Type</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Fee</th>
                <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bgSoft/40">
                  <td className="px-5 py-3.5"><p className="text-[13px] font-semibold text-ink">{r.name}</p><p className="text-[11.5px] text-inkFaint">v{r.version}{r.campaignName ? ` · ${r.campaignName}` : ""}</p></td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{typeName(r.transactionTypeId)}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{feeSummary(r)}</td>
                  <td className="px-5 py-3.5"><Badge tone={STATUS_TONE[r.status]}>{r.status.replace("_", " ")}</Badge></td>
                  <td className="px-5 py-3.5 text-right">
                    {canEdit && (
                      <div className="flex gap-2 justify-end">
                        {r.status === "DRAFT" && <button onClick={() => setEditing(r)} className="text-[12px] font-semibold text-accent">Edit</button>}
                        {r.status === "DRAFT" && <button onClick={() => submit(r.id)} disabled={busyId === r.id} className="text-[12px] font-semibold text-accent flex items-center gap-1"><Send size={11} /> Submit</button>}
                        {(r.status === "ACTIVE" || r.status === "ARCHIVED") && <button onClick={() => clone(r.id)} disabled={busyId === r.id} className="text-[12px] font-semibold text-inkSoft flex items-center gap-1"><Copy size={11} /> Clone</button>}
                        {r.status === "ACTIVE" && canApprove && <button onClick={() => deactivate(r.id)} disabled={busyId === r.id} className="text-[12px] font-semibold text-danger flex items-center gap-1"><Power size={11} /> Deactivate</button>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rules.length === 0 && <EmptyState title="No fee rules yet" sub={canEdit ? "Create one to start pricing a transaction type." : "None configured yet."} />}
        </Card>
      )}
      {editing !== null && <RuleFormModal rule={editing.id ? editing : null} transactionTypes={types} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function TransactionTypesTab({ user }) {
  const canEdit = user.role === "admin_super";
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", nameEn: "", nameSw: "", isMonetizable: true });
  const [error, setError] = useState("");

  const load = () => { setLoading(true); adminApi.fees.transactionTypes.list().then(setTypes).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const create = async (e) => {
    e.preventDefault(); setError("");
    try {
      await adminApi.fees.transactionTypes.create({ ...form, code: form.code.toUpperCase().replace(/[^A-Z0-9_]/g, "_") });
      setForm({ code: "", nameEn: "", nameSw: "", isMonetizable: true }); setCreating(false); load();
    } catch (err) { setError(err.message); }
  };

  const toggleActive = async (t) => { await adminApi.fees.transactionTypes.update(t.id, { isActive: !t.isActive }); load(); };
  const toggleMonetizable = async (t) => { await adminApi.fees.transactionTypes.update(t.id, { isMonetizable: !t.isMonetizable }); load(); };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13.5px] text-inkFaint">Categories of chargeable transactions — e.g. QR_OFF_US, GEPG, CARD_ISSUANCE_VIRTUAL_ADDON. Fee rules attach to these.</p>
        {canEdit && <Button variant="accent" onClick={() => setCreating(!creating)} className="flex items-center gap-1.5"><Plus size={14} /> New type</Button>}
      </div>

      {creating && (
        <Card className="p-4 mb-4">
          <form onSubmit={create} className="grid grid-cols-4 gap-2 items-end">
            <Input required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="CODE_LIKE_THIS" />
            <Input required value={form.nameEn} onChange={(e) => setForm((f) => ({ ...f, nameEn: e.target.value }))} placeholder="Name (English)" />
            <Input required value={form.nameSw} onChange={(e) => setForm((f) => ({ ...f, nameSw: e.target.value }))} placeholder="Jina (Kiswahili)" />
            <Button type="submit" variant="accent">Create</Button>
          </form>
          {error && <p className="text-[12px] text-danger mt-2">{error}</p>}
        </Card>
      )}

      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead><tr className="border-b border-border bg-bgSoft/60">
              <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Code</th>
              <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Name</th>
              <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Status</th>
            </tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 text-[12.5px] font-mono text-inkSoft">{t.code}</td>
                  <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{t.nameEn} <span className="text-inkFaint font-normal">/ {t.nameSw}</span></td>
                  <td className="px-5 py-3.5">
                    <div className="flex gap-1.5">
                      <button disabled={!canEdit} onClick={() => toggleActive(t)}><Badge tone={t.isActive ? "good" : "bad"}>{t.isActive ? "Active" : "Inactive"}</Badge></button>
                      <button disabled={!canEdit} onClick={() => toggleMonetizable(t)}><Badge tone={t.isMonetizable ? "warn" : "neutral"}>{t.isMonetizable ? "Monetizable" : "Always free"}</Badge></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {types.length === 0 && <EmptyState title="No transaction types yet" sub="Create one to start configuring fees." />}
        </Card>
      )}
    </div>
  );
}

function ExemptionCustomerPicker({ onPick }) {
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
      <div className="flex gap-2 mb-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runSearch())} placeholder="Name, email, or phone" />
        <Button type="button" variant="ghost" onClick={runSearch}><Search size={15} /></Button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : results.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
          {results.map((u) => (
            <button key={u.id} type="button" onClick={() => onPick(u)} className="w-full text-left px-3.5 py-2.5 border-b border-border last:border-0 hover:bg-bgSoft">
              <p className="text-[13px] font-semibold text-ink">{u.firstName} {u.lastName}</p>
              <p className="text-[11.5px] text-inkFaint">{u.email} · {u.phone}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GrantExemptionModal({ transactionTypes, onClose, onSaved }) {
  const [customer, setCustomer] = useState(null);
  const [transactionTypeId, setTransactionTypeId] = useState("");
  const [reason, setReason] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (e) => {
    e.preventDefault();
    if (!customer) return;
    setSaving(true); setError("");
    try {
      await adminApi.fees.exemptions.create({ userId: customer.id, transactionTypeId: transactionTypeId || null, reason: reason.trim(), endDate: endDate || null });
      onSaved(); onClose();
    } catch (err) {
      setError(err.message || "Couldn't grant this exemption.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4"><p className="text-[15px] font-bold font-display text-ink">Grant fee exemption</p><button onClick={onClose}><X size={18} /></button></div>
        {!customer ? (
          <>
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Find the customer</label>
            <ExemptionCustomerPicker onPick={setCustomer} />
          </>
        ) : (
          <form onSubmit={save}>
            <div className="p-3 rounded-lg bg-bgSoft mb-4 flex items-center justify-between">
              <div><p className="text-[13px] font-semibold text-ink">{customer.firstName} {customer.lastName}</p><p className="text-[11.5px] text-inkFaint">{customer.email}</p></div>
              <button type="button" onClick={() => setCustomer(null)} className="text-[11.5px] font-semibold text-accent">Change</button>
            </div>
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Transaction type (blank = every type)</label>
            <Select value={transactionTypeId} onChange={(e) => setTransactionTypeId(e.target.value)} className="mb-3">
              <option value="">All transaction types</option>
              {transactionTypes.map((t) => <option key={t.id} value={t.id}>{t.nameEn} ({t.code})</option>)}
            </Select>
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Reason (required — shown to the customer)</label>
            <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goodwill gesture after service disruption" className="mb-3" />
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Ends on (optional — blank = indefinite)</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mb-4" />
            {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
            <Button type="submit" variant="accent" disabled={saving} className="w-full">{saving ? "Granting…" : "Grant exemption"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}

function ExemptionsTab({ user }) {
  const canManage = user.role === "admin_super";
  const [exemptions, setExemptions] = useState([]);
  const [transactionTypes, setTransactionTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGrant, setShowGrant] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    Promise.all([adminApi.fees.exemptions.list(), adminApi.fees.transactionTypes.list()])
      .then(([ex, types]) => { setExemptions(ex); setTransactionTypes(types); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const revoke = async (ex) => {
    if (!confirm("Revoke this exemption? The customer will start being charged the standard fee again immediately.")) return;
    setBusyId(ex.id); setError("");
    try { await adminApi.fees.exemptions.revoke(ex.id); load(); }
    catch (err) { setError(err.message || "Couldn't revoke this exemption."); }
    finally { setBusyId(null); }
  };

  const typeName = (id) => transactionTypes.find((t) => t.id === id)?.nameEn || "All transaction types";

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13.5px] text-inkFaint">Individual customer waivers — the highest-priority exception in the pricing chain, above any promotion or bundle.</p>
        {canManage && <Button variant="accent" onClick={() => setShowGrant(true)} className="flex items-center gap-1.5 shrink-0"><Plus size={14} /> Grant exemption</Button>}
      </div>
      {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : exemptions.length === 0 ? (
        <EmptyState title="No exemptions granted" sub="Individual customer fee waivers will show up here." />
      ) : (
        <div className="space-y-2.5">
          {exemptions.map((ex) => (
            <Card key={ex.id} className="p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[13px] font-semibold text-ink">{ex.customer ? `${ex.customer.firstName} ${ex.customer.lastName}` : "Unknown customer"}</p>
                <Badge tone={ex.isActive ? "good" : "neutral"}>{ex.isActive ? "Active" : "Revoked"}</Badge>
              </div>
              <p className="text-[11.5px] text-inkFaint mb-1">{ex.customer?.email} · {typeName(ex.transactionTypeId)}</p>
              <p className="text-[12px] text-inkSoft mb-1">"{ex.reason}"</p>
              <p className="text-[11px] text-inkFaint">Granted {new Date(ex.startDate).toLocaleDateString()}{ex.endDate ? ` · ends ${new Date(ex.endDate).toLocaleDateString()}` : " · no end date"}</p>
              {canManage && ex.isActive && (
                <button onClick={() => revoke(ex)} disabled={busyId === ex.id} className="text-[11.5px] font-semibold text-danger mt-2">{busyId === ex.id ? "…" : "Revoke"}</button>
              )}
            </Card>
          ))}
        </div>
      )}
      {showGrant && <GrantExemptionModal transactionTypes={transactionTypes} onClose={() => setShowGrant(false)} onSaved={load} />}
    </div>
  );
}

function ApprovalsTab({ user }) {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const canApprove = user.role === "admin_super";

  const load = () => { setLoading(true); adminApi.fees.approvals.list("PENDING").then(setApprovals).finally(() => setLoading(false)); };
  useEffect(() => { load(); }, []);

  const review = async (id, approve) => {
    setBusyId(id); setError("");
    try { await adminApi.fees.rules.approve(id, approve); load(); }
    catch (err) { setError(err.message); }
    finally { setBusyId(null); }
  };

  return (
    <div>
      <p className="text-[13.5px] text-inkFaint mb-4">Pending pricing changes — a rule cannot go live until approved here by someone other than whoever submitted it.</p>
      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}
      {loading ? <div className="flex justify-center py-16"><Spinner /></div> : approvals.length === 0 ? (
        <EmptyState title="Nothing pending" sub="Submitted rule changes will show up here." />
      ) : (
        <div className="space-y-3">
          {approvals.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-[13.5px] font-bold text-ink">{a.feeRule.name}</p>
                  <p className="text-[11.5px] text-inkFaint">{a.feeRule.transactionType.nameEn} · v{a.feeRule.version} · requested {new Date(a.createdAt).toLocaleString()}</p>
                </div>
                <Badge tone="warn">Pending</Badge>
              </div>
              {a.changeNote && <p className="text-[12.5px] text-inkSoft mb-3">"{a.changeNote}"</p>}
              {canApprove ? (
                <div className="flex gap-2">
                  <Button variant="accent" onClick={() => review(a.feeRuleId, true)} disabled={busyId === a.feeRuleId} className="flex items-center gap-1.5"><Check size={13} /> Approve</Button>
                  <Button variant="danger" onClick={() => review(a.feeRuleId, false)} disabled={busyId === a.feeRuleId} className="flex items-center gap-1.5"><XCircle size={13} /> Reject</Button>
                </div>
              ) : <p className="text-[12px] text-inkFaint">Only a super admin can review this.</p>}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FeeRulesPage({ user }) {
  const [tab, setTab] = useState("rules");
  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Fee rules</h1>
      <div className="flex p-1 rounded-full mb-6 bg-bgSoft border border-border w-fit">
        {[{ key: "rules", label: "Rules" }, { key: "types", label: "Transaction types" }, { key: "exemptions", label: "Exemptions" }, { key: "approvals", label: "Approvals" }].map(({ key, label }) => (
          <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-full text-[12.5px] font-semibold ${tab === key ? "bg-white text-ink shadow-sm" : "text-inkFaint"}`}>{label}</button>
        ))}
      </div>
      {tab === "rules" && <RulesTab user={user} />}
      {tab === "types" && <TransactionTypesTab user={user} />}
      {tab === "exemptions" && <ExemptionsTab user={user} />}
      {tab === "approvals" && <ApprovalsTab user={user} />}
    </div>
  );
}
