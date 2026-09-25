import { useEffect, useState } from "react";
import { Plus, Trash2, RefreshCw } from "lucide-react";
import { adminApi } from "../api.js";
import { Card, Button, Input, Spinner, EmptyState } from "../components/ui.jsx";

export default function ExchangeRatesPage({ user }) {
  const canManage = user.role !== "admin_viewer";
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [newRate, setNewRate] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingValues, setEditingValues] = useState({});

  const load = () => {
    setLoading(true); setError("");
    adminApi.exchangeRates.list()
      .then((r) => { setRates(r); setEditingValues(Object.fromEntries(r.map((x) => [x.currency, String(x.rateToTZS)]))); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    const currency = newCurrency.trim().toUpperCase();
    const rate = Number(newRate);
    if (!/^[A-Z]{3}$/.test(currency)) { setError("Currency must be a 3-letter code, e.g. USD."); return; }
    if (!(rate > 0)) { setError("Rate must be a positive number."); return; }
    setSaving(true); setError("");
    try {
      await adminApi.exchangeRates.upsert(currency, rate);
      setNewCurrency(""); setNewRate("");
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const save = async (currency) => {
    const rate = Number(editingValues[currency]);
    if (!(rate > 0)) { setError("Rate must be a positive number."); return; }
    setSaving(true); setError("");
    try {
      await adminApi.exchangeRates.upsert(currency, rate);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (currency) => {
    if (!confirm(`Remove the exchange rate for ${currency}? Customers whose display currency is set to ${currency}, and anyone scanning a receipt in ${currency}, will see an error until a rate is set again.`)) return;
    try { await adminApi.exchangeRates.remove(currency); load(); } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Exchange rates</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">
        Manually-entered rates, always relative to TZS - used whenever EXCHANGE_RATE_PROVIDER=manual (the default; no external API key needed). Every currency a customer can select or a receipt can be scanned in needs a rate here, or that conversion will fail with a clear error rather than guess.
      </p>

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {canManage && (
        <Card className="p-4 mb-6">
          <p className="text-[13px] font-semibold text-ink mb-3">Add or update a rate</p>
          <div className="flex items-end gap-2">
            <div>
              <label className="block text-[11px] font-medium text-inkSoft mb-1">Currency</label>
              <Input value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} placeholder="USD" maxLength={3} className="w-24 uppercase" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-inkSoft mb-1">1 unit = how many TZS</label>
              <Input type="number" min="0" step="0.000001" value={newRate} onChange={(e) => setNewRate(e.target.value)} placeholder="2600" className="w-40" />
            </div>
            <Button variant="accent" onClick={add} disabled={saving} className="flex items-center gap-1.5"><Plus size={14} /> Save</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : rates.length === 0 ? (
        <EmptyState title="No rates configured yet" sub="Add a rate above for every currency customers can select or scan receipts in." />
      ) : (
        <div className="space-y-2">
          {rates.map((r) => (
            <Card key={r.id} className="p-3.5 flex items-center gap-3">
              <span className="text-[14px] font-bold text-ink w-14">{r.currency}</span>
              <span className="text-[12.5px] text-inkFaint">1 {r.currency} =</span>
              <Input
                type="number" min="0" step="0.000001" disabled={!canManage}
                value={editingValues[r.currency] ?? ""}
                onChange={(e) => setEditingValues((v) => ({ ...v, [r.currency]: e.target.value }))}
                className="w-40"
              />
              <span className="text-[12.5px] text-inkFaint flex-1">TZS</span>
              <span className="text-[11px] text-inkFaint">Updated {new Date(r.updatedAt).toLocaleDateString()}</span>
              {canManage && (
                <>
                  <Button variant="ghost" onClick={() => save(r.currency)} disabled={saving} className="flex items-center gap-1"><RefreshCw size={13} /> Update</Button>
                  <button onClick={() => remove(r.currency)} className="p-1.5 rounded-lg text-danger hover:bg-dangerSoft"><Trash2 size={14} /></button>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
