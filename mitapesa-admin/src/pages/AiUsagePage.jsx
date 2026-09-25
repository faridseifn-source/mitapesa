import { useEffect, useState } from "react";
import { adminApi } from "../api.js";
import { Card, StatCard, Input, Button, Badge, Spinner, EmptyState, fmtTZS } from "../components/ui.jsx";

const FEATURE_LABEL = { voice: "voice logging", analytics: "AI analytics (\"Ask AI\")" };
const FEATURE_UNIT = { voice: "voice logs", analytics: "questions" };

function CreditLookup({ user, feature, initialUserId }) {
  const canClear = user.role === "admin_super";
  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState(initialUserId || null);
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  const loadSummary = (userId) => {
    setSelectedId(userId); setLoadingSummary(true); setError(""); setSummary(null);
    adminApi.voiceCredits(userId, feature).then(setSummary).catch((err) => setError(err.message)).finally(() => setLoadingSummary(false));
  };
  useEffect(() => { if (initialUserId) loadSummary(initialUserId); }, [initialUserId]);
  // Switching the Voice/Analytics toggle should clear any open lookup —
  // a credit balance for one feature isn't meaningful once viewed under
  // the other tab's label.
  useEffect(() => { setSelectedId(null); setSummary(null); setResults([]); setSearch(""); }, [feature]);

  const runSearch = async (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true); setError("");
    try { const r = await adminApi.users.list(search.trim(), 1, 10); setResults(r.users); }
    catch (err) { setError(err.message); }
    finally { setSearching(false); }
  };

  const handleClear = async () => {
    if (!selectedId) return;
    if (!window.confirm("Mark this customer's unused purchased credits as fully consumed? This can't be undone, though their purchase history stays visible.")) return;
    setClearing(true); setError("");
    try { await adminApi.clearVoiceCredits(selectedId, feature); loadSummary(selectedId); }
    catch (err) { setError(err.message || "Couldn't clear credits."); }
    finally { setClearing(false); }
  };

  return (
    <Card className="p-5 mb-8">
      <p className="text-[13px] font-semibold text-ink mb-1">Look up a customer's {FEATURE_LABEL[feature]} credits</p>
      <p className="text-[11.5px] text-inkFaint mb-3">Search by name or email to see their purchased-credit balance and history — useful for confirming why a customer's usage isn't matching the free monthly limit (leftover purchased credits never expire).</p>
      <form onSubmit={runSearch} className="flex gap-2 mb-3">
        <Input placeholder="Search by name or email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button variant="accent" disabled={searching}>{searching ? "…" : "Search"}</Button>
      </form>

      {error && <p className="text-[12.5px] text-danger mb-3">{error}</p>}

      {results.length > 0 && !selectedId && (
        <div className="space-y-1.5 mb-2">
          {results.map((u) => (
            <button key={u.id} onClick={() => loadSummary(u.id)} className="w-full text-left px-3.5 py-2.5 rounded-lg border border-border hover:bg-bgSoft/60 flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink">{u.firstName} {u.lastName}</span>
              <span className="text-[12px] text-inkFaint">{u.email}</span>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <div className="border-t border-border pt-4 mt-3">
          {loadingSummary ? (
            <div className="flex justify-center py-6"><Spinner /></div>
          ) : summary ? (
            <>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-[13.5px] font-semibold text-ink">{summary.user.name}</p>
                  <p className="text-[12px] text-inkFaint">{summary.user.email}</p>
                </div>
                <button onClick={() => { setSelectedId(null); setSummary(null); setResults([]); setSearch(""); }} className="text-[12px] text-inkFaint hover:text-ink">Search again</button>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <StatCard label="Purchased" value={summary.totalPurchased} />
                <StatCard label="Used" value={summary.totalUsed} />
                <StatCard label="Remaining" value={summary.remaining} tone={summary.remaining > 0 ? "accent" : "ink"} />
              </div>
              {summary.remaining > 0 && canClear && (
                <Button variant="danger" onClick={handleClear} disabled={clearing} className="mb-4">
                  {clearing ? "Clearing…" : `Clear ${summary.remaining} unused credit${summary.remaining === 1 ? "" : "s"}`}
                </Button>
              )}
              {summary.purchases.length === 0 ? (
                <EmptyState title="No purchases yet" sub={`This customer hasn't bought any ${FEATURE_LABEL[feature]} credits.`} />
              ) : (
                <div className="space-y-1.5">
                  {summary.purchases.map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-bgSoft/60">
                      <div>
                        <span className="text-[12.5px] font-semibold text-ink font-mono">{p.creditsUsed}/{p.creditsPurchased} used</span>
                        <span className="text-[11.5px] text-inkFaint ml-2">{new Date(p.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-inkSoft font-mono">{fmtTZS(p.amountPaidTzs)}</span>
                        <Badge tone={p.status === "succeeded" ? "good" : "bad"}>{p.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function CombinedSummary() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true); setError("");
    adminApi.aiUsageSummary().then(setSummary).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>;
  if (error) return <p className="text-[12.5px] text-danger mb-6">{error}</p>;
  if (!summary) return null;

  const { combined } = summary;
  const netPositive = combined.netTzs >= 0;

  return (
    <Card className="p-5 mb-6">
      <p className="text-[12.5px] font-semibold text-ink mb-1">Total AI spend — {summary.monthKey}</p>
      <p className="text-[11.5px] text-inkFaint mb-4">Voice logging and AI analytics share the same OpenAI account — this is the true combined exposure and net position across both, not either one alone.</p>
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total OpenAI cost" value={`$${combined.costUsd.toFixed(4)}`} hint={fmtTZS(combined.costTzs)} />
        <StatCard label="Total revenue" value={fmtTZS(combined.revenueTzs)} tone="gold" />
        <StatCard label="Net position" value={fmtTZS(combined.netTzs)} tone={netPositive ? "accent" : "danger"} hint={netPositive ? "Profitable" : "Costing more than it earns"} />
      </div>
    </Card>
  );
}

export default function AiUsagePage({ user }) {
  // Voice and analytics are tracked as two fully independent budgets
  // (separate free limits, ceilings, pricing) that happen to share the
  // same underlying OpenAI account — the toggle below reports one at a
  // time so it's clear which feature is actually driving cost or
  // revenue, while CombinedSummary above it shows the true total
  // exposure across both, converted into one comparable currency (TZS).
  const [feature, setFeature] = useState("voice");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lookupUserId, setLookupUserId] = useState(null);

  const load = () => {
    setLoading(true); setError("");
    adminApi.aiUsage(feature).then(setData).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { setLookupUserId(null); load(); }, [feature]);

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">AI usage</h1>
      <p className="text-[13.5px] text-inkFaint mb-4">Real cost and revenue this month, against the configured spend ceiling — see Settings to change the ceiling, free allowance, or run a promotion. Voice and analytics are separate budgets.</p>

      <CombinedSummary />

      <div className="flex gap-1.5 mb-6">
        {["voice", "analytics"].map((f) => (
          <button
            key={f}
            onClick={() => setFeature(f)}
            className={`px-4 py-2 rounded-full text-[12.5px] font-semibold border ${feature === f ? "bg-accent text-white border-accent" : "bg-card text-inkSoft border-border"}`}
          >
            {f === "voice" ? "Voice logging" : "AI analytics (Ask AI)"}
          </button>
        ))}
      </div>

      <CreditLookup user={user} feature={feature} initialUserId={lookupUserId} />

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
            <StatCard label={`Spend this month (${data.monthKey})`} value={`$${data.totalCostUsd.toFixed(4)}`} tone={data.ceilingUsd > 0 && data.totalCostUsd >= data.ceilingUsd ? "danger" : "accent"} />
            <StatCard label="Monthly ceiling" value={`$${data.ceilingUsd.toFixed(2)}`} />
            <StatCard label="Revenue this month" value={fmtTZS(data.revenueThisMonthTzs)} tone="gold" hint={`${data.revenuePurchasesThisMonth} purchased`} />
            <StatCard label={`${FEATURE_UNIT[feature]} this month`} value={data.totalRequests} />
            <StatCard label="Free allowance" value={`${data.freeMonthlyLimit}/customer`} />
          </div>

          <Card className="p-5 mb-8">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[12.5px] font-semibold text-ink">Spend vs. ceiling</p>
              <p className="text-[12px] text-inkFaint">{data.ceilingUsd > 0 ? `${Math.min(100, (data.totalCostUsd / data.ceilingUsd) * 100).toFixed(1)}%` : "No ceiling set"}</p>
            </div>
            <div className="w-full h-2.5 rounded-full bg-bgSoft overflow-hidden">
              <div
                className={`h-full rounded-full ${data.ceilingUsd > 0 && data.totalCostUsd / data.ceilingUsd > 0.9 ? "bg-danger" : "bg-accent"}`}
                style={{ width: `${data.ceilingUsd > 0 ? Math.min(100, (data.totalCostUsd / data.ceilingUsd) * 100) : 0}%` }}
              />
            </div>
            {data.ceilingUsd > 0 && data.totalCostUsd >= data.ceilingUsd && (
              <p className="text-[12px] text-danger mt-2">Ceiling reached — {FEATURE_LABEL[feature]} is currently disabled for everyone until next month.</p>
            )}
            {data.promoFreeUntil && new Date(data.promoFreeUntil) >= new Date() && (
              <p className="text-[12px] text-accent mt-2">Promotion active — free and unlimited for every customer until {data.promoFreeUntil} (the ceiling above still applies).</p>
            )}
          </Card>

          <p className="text-[15px] font-bold font-display text-ink mb-3">Top customers this month</p>
          <Card className="overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border bg-bgSoft/60">
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Customer</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Email</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">{FEATURE_UNIT[feature]}</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Cost</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.map((u) => (
                  <tr key={u.userId} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{u.name}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{u.email}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft font-mono">{u.requests}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft font-mono">${u.costUsd.toFixed(4)}</td>
                    <td className="px-5 py-3.5 text-right"><button onClick={() => setLookupUserId(u.userId)} className="text-[12px] text-accent hover:underline">View credits</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.topUsers.length === 0 && <EmptyState title={`No ${FEATURE_LABEL[feature]} usage yet this month`} />}
          </Card>
        </>
      )}
    </div>
  );
}
