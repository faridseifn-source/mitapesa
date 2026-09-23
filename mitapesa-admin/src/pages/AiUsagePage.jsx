import { useEffect, useState } from "react";
import { adminApi } from "../api.js";
import { Card, StatCard, Spinner, EmptyState, fmtTZS } from "../components/ui.jsx";

export default function AiUsagePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true); setError("");
    adminApi.aiUsage().then(setData).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">AI usage</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">Voice expense logging's real cost this month, against the configured spend ceiling — see Settings to change the ceiling, free allowance, or run a promotion.</p>

      {error && <p className="text-[13px] text-danger mb-4">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard label={`Spend this month (${data.monthKey})`} value={`$${data.totalCostUsd.toFixed(4)}`} tone={data.ceilingUsd > 0 && data.totalCostUsd >= data.ceilingUsd ? "danger" : "accent"} />
            <StatCard label="Monthly ceiling" value={`$${data.ceilingUsd.toFixed(2)}`} />
            <StatCard label="Voice logs this month" value={data.totalRequests} />
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
              <p className="text-[12px] text-danger mt-2">Ceiling reached — voice logging is currently disabled for everyone until next month.</p>
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
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Voice logs</th>
                  <th className="px-5 py-3 text-[11px] font-semibold text-inkFaint uppercase tracking-wide">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.topUsers.map((u) => (
                  <tr key={u.userId} className="border-b border-border last:border-0">
                    <td className="px-5 py-3.5 text-[13px] font-semibold text-ink">{u.name}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft">{u.email}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft font-mono">{u.requests}</td>
                    <td className="px-5 py-3.5 text-[12.5px] text-inkSoft font-mono">${u.costUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.topUsers.length === 0 && <EmptyState title="No voice logging usage yet this month" />}
          </Card>
        </>
      )}
    </div>
  );
}
