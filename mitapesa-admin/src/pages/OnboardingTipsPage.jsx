import { useEffect, useState } from "react";
import { adminApi } from "../api.js";
import { Card, Button, Badge, Spinner, EmptyState } from "../components/ui.jsx";

const textareaClass = "w-full px-3.5 py-2.5 rounded-lg border border-border bg-white text-[13px] text-ink placeholder:text-inkFaint focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent resize-none";

function TipEditorCard({ tip, canEdit, onSave, onDelete }) {
  const [textEn, setTextEn] = useState(tip.textEn);
  const [textSw, setTextSw] = useState(tip.textSw);
  const [tourStep, setTourStep] = useState(tip.tourStep ?? "");
  const [active, setActive] = useState(tip.active);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const dirty = textEn !== tip.textEn || textSw !== tip.textSw || active !== tip.active || String(tourStep) !== String(tip.tourStep ?? "");

  const save = async () => {
    setSaving(true); setError("");
    try {
      await adminApi.onboardingTips.update(tip.key, {
        textEn, textSw, active,
        tourStep: tip.tourStep != null ? (tourStep === "" ? null : Number(tourStep)) : undefined,
      });
      onSave();
    } catch (err) { setError(err.message || "Couldn't save."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete the "${tip.key}" tip? Customers who've already seen it are unaffected; it just stops showing to anyone new.`)) return;
    setDeleting(true); setError("");
    try { await adminApi.onboardingTips.remove(tip.key); onDelete(); }
    catch (err) { setError(err.message || "Couldn't delete."); setDeleting(false); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[12.5px] font-mono font-semibold text-ink">{tip.key}</p>
          {tip.tourStep != null && <Badge tone="good">Tour step {tip.tourStep}</Badge>}
          {!active && <Badge tone="bad">Inactive</Badge>}
        </div>
        {canEdit && <button onClick={remove} disabled={deleting} className="text-[12px] text-danger hover:underline">{deleting ? "…" : "Delete"}</button>}
      </div>

      <label className="text-[11px] font-semibold text-inkFaint mb-1 block">English</label>
      <textarea className={`${textareaClass} mb-3`} rows={2} value={textEn} onChange={(e) => setTextEn(e.target.value)} disabled={!canEdit} maxLength={500} />

      <label className="text-[11px] font-semibold text-inkFaint mb-1 block">Swahili</label>
      <textarea className={`${textareaClass} mb-3`} rows={2} value={textSw} onChange={(e) => setTextSw(e.target.value)} disabled={!canEdit} maxLength={500} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-[12px] text-inkSoft">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!canEdit} /> Active
          </label>
          {tip.tourStep != null && (
            <label className="flex items-center gap-1.5 text-[12px] text-inkSoft">
              Order:
              <input type="number" className="w-14 px-2 py-1 rounded border border-border text-[12px]" value={tourStep} onChange={(e) => setTourStep(e.target.value)} disabled={!canEdit} min={1} />
            </label>
          )}
        </div>
        {canEdit && <Button variant="accent" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>}
      </div>
      {error && <p className="text-[12px] text-danger mt-2">{error}</p>}
    </Card>
  );
}

function NewTipForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [textEn, setTextEn] = useState("");
  const [textSw, setTextSw] = useState("");
  const [isTourStep, setIsTourStep] = useState(false);
  const [tourStep, setTourStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    if (!key.trim() || !textEn.trim() || !textSw.trim()) { setError("Key, English, and Swahili text are all required."); return; }
    setSaving(true); setError("");
    try {
      await adminApi.onboardingTips.create({ key: key.trim(), textEn: textEn.trim(), textSw: textSw.trim(), tourStep: isTourStep ? Number(tourStep) : null });
      setKey(""); setTextEn(""); setTextSw(""); setIsTourStep(false); setTourStep(1); setOpen(false);
      onCreated();
    } catch (err) { setError(err.message || "Couldn't create tip."); }
    finally { setSaving(false); }
  };

  if (!open) return <Button variant="accent" onClick={() => setOpen(true)} className="mb-6">+ New tip</Button>;

  return (
    <Card className="p-4 mb-6">
      <p className="text-[13px] font-semibold text-ink mb-3">New onboarding tip</p>
      <label className="text-[11px] font-semibold text-inkFaint mb-1 block">Key (matches a screen in the app exactly — e.g. "insights", "voiceLog")</label>
      <input className={`${textareaClass} mb-3`} value={key} onChange={(e) => setKey(e.target.value)} placeholder="screenKey" />
      <label className="text-[11px] font-semibold text-inkFaint mb-1 block">English</label>
      <textarea className={`${textareaClass} mb-3`} rows={2} value={textEn} onChange={(e) => setTextEn(e.target.value)} maxLength={500} />
      <label className="text-[11px] font-semibold text-inkFaint mb-1 block">Swahili</label>
      <textarea className={`${textareaClass} mb-3`} rows={2} value={textSw} onChange={(e) => setTextSw(e.target.value)} maxLength={500} />
      <label className="flex items-center gap-1.5 text-[12px] text-inkSoft mb-3">
        <input type="checkbox" checked={isTourStep} onChange={(e) => setIsTourStep(e.target.checked)} />
        Part of the welcome tour (shown once, right after signup)
      </label>
      {isTourStep && (
        <label className="flex items-center gap-1.5 text-[12px] text-inkSoft mb-3">
          Order in tour:
          <input type="number" className="w-14 px-2 py-1 rounded border border-border text-[12px]" value={tourStep} onChange={(e) => setTourStep(e.target.value)} min={1} />
        </label>
      )}
      {error && <p className="text-[12px] text-danger mb-3">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="accent" disabled={saving} onClick={create}>{saving ? "Creating…" : "Create tip"}</Button>
      </div>
    </Card>
  );
}

export default function OnboardingTipsPage({ user }) {
  const canEdit = user.role === "admin_super" || user.role === "admin_support";
  const [tips, setTips] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true); setError("");
    adminApi.onboardingTips.list().then(setTips).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const tourTips = (tips || []).filter((t) => t.tourStep != null).sort((a, b) => a.tourStep - b.tourStep);
  const screenTips = (tips || []).filter((t) => t.tourStep == null).sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Onboarding tips</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">
        First-use education shown to customers in the app — the welcome tour after signup, and a small dismissible banner the first time they open each screen. Edits take effect immediately, for every customer, with no app update.
        {!canEdit && " Read-only for your access level."}
      </p>

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <>
          {canEdit && <NewTipForm onCreated={load} />}

          <p className="text-[15px] font-bold font-display text-ink mb-3">Welcome tour</p>
          <p className="text-[12px] text-inkFaint mb-3">Shown once, in order, the first time a customer logs in.</p>
          {tourTips.length === 0 ? (
            <EmptyState title="No welcome tour steps" sub="Nothing will be shown to a new customer after signup." />
          ) : (
            <div className="space-y-3 mb-8">
              {tourTips.map((tip) => <TipEditorCard key={tip.key} tip={tip} canEdit={canEdit} onSave={load} onDelete={load} />)}
            </div>
          )}

          <p className="text-[15px] font-bold font-display text-ink mb-3">Per-screen tips</p>
          <p className="text-[12px] text-inkFaint mb-3">Each shown once, the first time a customer opens that specific screen or feature.</p>
          {screenTips.length === 0 ? (
            <EmptyState title="No per-screen tips" />
          ) : (
            <div className="space-y-3">
              {screenTips.map((tip) => <TipEditorCard key={tip.key} tip={tip} canEdit={canEdit} onSave={load} onDelete={load} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
