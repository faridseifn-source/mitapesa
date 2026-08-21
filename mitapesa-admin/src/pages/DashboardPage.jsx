import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { StatCard, Spinner, Card, Select, fmtTZS } from "../components/ui.jsx";
import { adminApi } from "../api.js";

export default function DashboardPage({ user }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trends, setTrends] = useState(null);
  const [trendsLoading, setTrendsLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    adminApi.dashboard()
      .then(setStats)
      .catch((err) => setError(err.message || "Couldn't load the dashboard."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setTrendsLoading(true);
    adminApi.dashboardTrends(days).then(setTrends).catch(() => setTrends(null)).finally(() => setTrendsLoading(false));
  }, [days]);

  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Dashboard</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">Welcome back, {user.firstName}. Here's what's happening across MitaPesa.</p>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : error ? (
        <p className="text-[13px] text-danger">{error}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="Mobile app users" value={stats.totalUsers.toLocaleString()} />
          <StatCard label="Active in last 30 days" value={stats.activeUsers30d.toLocaleString()} tone="accent" hint={`${stats.totalUsers ? Math.round((stats.activeUsers30d / stats.totalUsers) * 100) : 0}% of all users`} />
          <StatCard label="New this month" value={stats.newUsersThisMonth.toLocaleString()} tone="gold" />
          <StatCard label="Blocked accounts" value={stats.blockedUsers.toLocaleString()} tone={stats.blockedUsers > 0 ? "danger" : "ink"} />
          <StatCard label="KYC verified" value={stats.kycVerified.toLocaleString()} tone="accent" />
          <StatCard label="KYC pending" value={stats.kycPending.toLocaleString()} tone="gold" />
          <StatCard label="Open requests & disputes" value={stats.openTickets.toLocaleString()} tone={stats.openTickets > 0 ? "danger" : "ink"} />
          {stats.totalCardBalance !== null && <StatCard label="Total balance on platform" value={fmtTZS(stats.totalCardBalance)} />}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-[15px] font-bold font-display text-ink">Trends</p>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-auto">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
      </div>

      {trendsLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : !trends ? (
        <p className="text-[13px] text-inkFaint">Trend data isn't available for your access level.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-5">
            <p className="text-[12px] font-semibold text-inkFaint mb-3">New users per day</p>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trends}>
                <defs>
                  <linearGradient id="newUsersGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1F6F5C" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#1F6F5C" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E4DD" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: "#8A8F8C" }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8A8F8C" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip labelFormatter={fmtDay} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E6E4DD" }} />
                <Area type="monotone" dataKey="newUsers" stroke="#1F6F5C" strokeWidth={2} fill="url(#newUsersGrad)" name="New users" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          <Card className="p-5">
            <p className="text-[12px] font-semibold text-inkFaint mb-3">Completed QR payments per day</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E6E4DD" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: "#8A8F8C" }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#8A8F8C" }} axisLine={false} tickLine={false} width={30} />
                <Tooltip labelFormatter={fmtDay} formatter={(v, name) => (name === "paymentVolume" ? fmtTZS(v) : v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E6E4DD" }} />
                <Bar dataKey="completedPayments" fill="#B8912F" radius={[4, 4, 0, 0]} name="Payments" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  );
}
