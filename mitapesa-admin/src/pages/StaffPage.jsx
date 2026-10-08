import { useEffect, useState } from "react";
import { Plus, X, ShieldCheck } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Badge, Button, Input, Select, Spinner, EmptyState, ROLE_LABEL } from "../components/ui.jsx";

function AddStaffModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", role: "admin_support" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError("");
    try {
      await adminApi.staff.create(form);
      setDone(true);
      onSaved();
    } catch (err) {
      setError(err.message || "Couldn't create this admin account.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[15px] font-bold font-display text-ink">Add admin</p>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-bgSoft"><X size={18} /></button>
        </div>

        {done ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-accentSoft flex items-center justify-center mx-auto mb-3"><ShieldCheck size={22} className="text-accent" /></div>
            <p className="text-[13.5px] font-semibold text-ink mb-1">Account created</p>
            <p className="text-[12.5px] text-inkFaint mb-4">We've emailed {form.email} a link to set their password. It expires in 48 hours.</p>
            <Button variant="accent" onClick={onClose} className="w-full">Done</Button>
          </div>
        ) : (
          <form onSubmit={save}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">First name</label><Input required value={form.firstName} onChange={set("firstName")} /></div>
              <div><label className="block text-[12px] font-medium text-inkSoft mb-1.5">Last name</label><Input required value={form.lastName} onChange={set("lastName")} /></div>
            </div>
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Email</label>
            <Input type="email" required value={form.email} onChange={set("email")} className="mb-3" />
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Phone</label>
            <Input required value={form.phone} onChange={set("phone")} placeholder="712345678" className="mb-3" />
            <label className="block text-[12px] font-medium text-inkSoft mb-1.5">Role</label>
            <Select value={form.role} onChange={set("role")} className="mb-4">
              <option value="admin_viewer">{ROLE_LABEL.admin_viewer}</option>
              <option value="admin_support">{ROLE_LABEL.admin_support}</option>
              <option value="admin_super">{ROLE_LABEL.admin_super}</option>
            </Select>
            <p className="text-[11.5px] text-inkFaint mb-4">They'll get an email to set their own password — no password is set here, and the account can't log in until they do.</p>
            {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}
            <Button type="submit" variant="accent" disabled={saving} className="w-full">{saving ? "Creating…" : "Create admin account"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function StaffPage({ user }) {
  const canManage = user.role === "admin_super";
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const load = () => {
    setLoading(true);
    adminApi.staff.list().then(setStaff).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const remove = async (s) => {
    if (!confirm(`Remove admin access for ${s.firstName} ${s.lastName}? This permanently deletes the account.`)) return;
    setDeletingId(s.id); setError("");
    try { await adminApi.staff.remove(s.id); load(); }
    catch (err) { setError(err.message || "Couldn't remove this account."); }
    finally { setDeletingId(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold font-display text-ink">Admin users</h1>
        {canManage && <Button variant="accent" onClick={() => setShowAdd(true)} className="flex items-center gap-1.5"><Plus size={14} /> Add admin</Button>}
      </div>
      <p className="text-[13.5px] text-inkFaint mb-6">
        Staff accounts created here never have a wallet or card, which is what makes full deletion safe. An admin promoted from an
        existing customer (via Mobile app users → Role) keeps their financial history and can only be demoted back to customer, not deleted.
      </p>

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-left">
            <thead><tr className="border-b border-border bg-bgSoft/60">
              <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Name</th>
              <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Contact</th>
              <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Role</th>
              <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Joined</th>
              <th className="px-5 py-3" />
            </tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{s.firstName} {s.lastName}{s.id === user.id && <span className="text-inkFaint font-normal"> (you)</span>}</td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{s.email}</td>
                  <td className="px-5 py-3.5"><Badge tone={s.role === "admin_super" ? "good" : s.role === "admin_support" ? "warn" : "neutral"}>{ROLE_LABEL[s.role]}</Badge></td>
                  <td className="px-5 py-3.5 text-[12.5px] text-inkFaint">{new Date(s.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3.5 text-right">
                    {canManage && s.id !== user.id && (
                      <button onClick={() => remove(s)} disabled={deletingId === s.id} className="text-[11.5px] font-semibold text-danger">{deletingId === s.id ? "…" : "Remove"}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {staff.length === 0 && <EmptyState title="No admin accounts" />}
        </Card>
      )}

      {showAdd && <AddStaffModal onClose={() => setShowAdd(false)} onSaved={load} />}
    </div>
  );
}
