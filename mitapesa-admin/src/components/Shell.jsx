import { LayoutDashboard, Users, MessageSquareWarning, Settings, ScrollText, LogOut, ShieldCheck, Megaphone, Landmark, Percent, Package, TrendingUp, UserCog, Scale, DollarSign } from "lucide-react";
import { ROLE_LABEL } from "./ui.jsx";

const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, minRole: "admin_viewer" },
  { key: "users", label: "Mobile app users", icon: Users, minRole: "admin_viewer" },
  { key: "tickets", label: "Requests & disputes", icon: MessageSquareWarning, minRole: "admin_viewer" },
  { key: "institutions", label: "Institutions", icon: Landmark, minRole: "admin_viewer" },
  { key: "feeRules", label: "Fee rules", icon: Percent, minRole: "admin_viewer" },
  { key: "feeBundles", label: "Bundles", icon: Package, minRole: "admin_viewer" },
  { key: "feeReport", label: "Fee revenue", icon: TrendingUp, minRole: "admin_support" },
  { key: "reconciliation", label: "Reconciliation", icon: Scale, minRole: "admin_support" },
  { key: "exchangeRates", label: "Exchange rates", icon: DollarSign, minRole: "admin_viewer" },
  { key: "broadcast", label: "Broadcast", icon: Megaphone, minRole: "admin_super" },
  { key: "staff", label: "Admin users", icon: UserCog, minRole: "admin_super" },
  { key: "audit", label: "Audit log", icon: ScrollText, minRole: "admin_support" },
  { key: "settings", label: "Settings", icon: Settings, minRole: "admin_viewer" },
];
const ROLE_RANK = { admin_viewer: 0, admin_support: 1, admin_super: 2 };

export default function Shell({ page, setPage, user, onLogout, children }) {
  const rank = ROLE_RANK[user.role] ?? 0;

  return (
    <div className="flex h-screen bg-bgSoft">
      <aside className="w-64 shrink-0 bg-ink flex flex-col">
        <div className="px-6 py-6 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
            <ShieldCheck size={17} color="#fff" />
          </div>
          <div>
            <p className="text-white font-display font-bold text-[15px] leading-tight">MitaPesa</p>
            <p className="text-white/50 text-[11px] leading-tight">Admin Portal</p>
          </div>
        </div>

        <nav className="flex-1 px-3 mt-2 space-y-1">
          {NAV_ITEMS.filter((item) => rank >= ROLE_RANK[item.minRole]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setPage(key)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                page === key ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-4 border-t border-white/10 pt-4 mx-3">
          <div className="px-3.5 mb-2">
            <p className="text-white text-[13px] font-semibold">{user.firstName} {user.lastName}</p>
            <p className="text-white/50 text-[11px]">{ROLE_LABEL[user.role] || user.role}</p>
          </div>
          <button onClick={onLogout} className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[13px] font-medium text-white/60 hover:bg-white/5 hover:text-white/90 transition-colors">
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
