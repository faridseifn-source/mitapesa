import { useEffect, useState } from "react";
import { adminApi } from "./api.js";
import Shell from "./components/Shell.jsx";
import { Spinner } from "./components/ui.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import UsersPage from "./pages/UsersPage.jsx";
import TicketsPage from "./pages/TicketsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import AuditLogPage from "./pages/AuditLogPage.jsx";
import BroadcastPage from "./pages/BroadcastPage.jsx";
import InstitutionsPage from "./pages/InstitutionsPage.jsx";
import FeeRulesPage from "./pages/FeeRulesPage.jsx";
import FeeBundlesPage from "./pages/FeeBundlesPage.jsx";
import FeeReportPage from "./pages/FeeReportPage.jsx";
import StaffPage from "./pages/StaffPage.jsx";
import ReconciliationPage from "./pages/ReconciliationPage.jsx";
import ExchangeRatesPage from "./pages/ExchangeRatesPage.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [page, setPage] = useState("dashboard");

  // On load, try to restore a session from the httpOnly admin refresh
  // cookie (the access token itself only ever lives in memory, so it's
  // gone on every page reload — this is what brings it back without
  // making the admin re-enter their password and OTP every time).
  useEffect(() => {
    (async () => {
      const restored = await adminApi.auth.restoreSession();
      if (restored) {
        try {
          const { user } = await adminApi.auth.me();
          setUser(user);
        } catch {
          // Session cookie was present but no longer valid for admin access — fall through to login.
        }
      }
      setCheckingSession(false);
    })();
  }, []);

  const handleLogout = async () => {
    await adminApi.auth.logout();
    setUser(null);
    setPage("dashboard");
  };

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink">
        <Spinner size={28} />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoggedIn={setUser} />;
  }

  return (
    <Shell page={page} setPage={setPage} user={user} onLogout={handleLogout}>
      {page === "dashboard" && <DashboardPage user={user} />}
      {page === "users" && <UsersPage user={user} />}
      {page === "tickets" && <TicketsPage user={user} />}
      {page === "settings" && <SettingsPage user={user} />}
      {page === "broadcast" && user.role === "admin_super" && <BroadcastPage />}
      {page === "institutions" && <InstitutionsPage user={user} />}
      {page === "feeRules" && <FeeRulesPage user={user} />}
      {page === "feeBundles" && <FeeBundlesPage user={user} />}
      {page === "feeReport" && user.role !== "admin_viewer" && <FeeReportPage />}
      {page === "staff" && user.role === "admin_super" && <StaffPage user={user} />}
      {page === "reconciliation" && user.role !== "admin_viewer" && <ReconciliationPage user={user} />}
      {page === "exchangeRates" && <ExchangeRatesPage user={user} />}
      {page === "audit" && user.role !== "admin_viewer" && <AuditLogPage user={user} />}
    </Shell>
  );
}
