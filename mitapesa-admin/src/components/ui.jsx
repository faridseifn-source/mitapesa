import { RefreshCw } from "lucide-react";

export function Card({ className = "", children }) {
  return <div className={`bg-white border border-border rounded-2xl ${className}`}>{children}</div>;
}

export function Badge({ tone = "neutral", children }) {
  const tones = {
    neutral: "bg-bgSoft text-inkSoft",
    good: "bg-accentSoft text-accent",
    warn: "bg-goldSoft text-gold",
    bad: "bg-dangerSoft text-danger",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${tones[tone]}`}>{children}</span>;
}

export function Button({ variant = "primary", className = "", children, ...props }) {
  const variants = {
    primary: "bg-ink text-white hover:bg-ink/90",
    accent: "bg-accent text-white hover:bg-accent/90",
    danger: "bg-danger text-white hover:bg-danger/90",
    ghost: "bg-white border border-border text-inkSoft hover:bg-bgSoft",
  };
  return (
    <button className={`px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Input(props) {
  return <input {...props} className={`w-full px-3.5 py-2.5 rounded-lg border border-border bg-white text-[13.5px] text-ink placeholder:text-inkFaint focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent ${props.className || ""}`} />;
}

export function Select({ children, ...props }) {
  return <select {...props} className={`w-full px-3.5 py-2.5 rounded-lg border border-border bg-white text-[13.5px] text-ink focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent ${props.className || ""}`}>{children}</select>;
}

export function Spinner({ size = 20 }) {
  return <RefreshCw size={size} className="animate-spin text-accent" />;
}

export function StatCard({ label, value, hint, tone = "ink" }) {
  const toneColor = { ink: "text-ink", accent: "text-accent", gold: "text-gold", danger: "text-danger" }[tone];
  return (
    <Card className="p-5">
      <p className="text-[12px] text-inkFaint font-medium mb-1.5">{label}</p>
      <p className={`text-[26px] font-bold font-display ${toneColor}`}>{value}</p>
      {hint && <p className="text-[11.5px] text-inkFaint mt-1">{hint}</p>}
    </Card>
  );
}

export function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-[12.5px] text-inkFaint">{total} total · page {page} of {totalPages}</p>
      <div className="flex gap-2">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <Button variant="ghost" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function EmptyState({ title, sub }) {
  return (
    <div className="text-center py-16">
      <p className="text-[14px] font-semibold text-ink mb-1">{title}</p>
      {sub && <p className="text-[13px] text-inkFaint">{sub}</p>}
    </div>
  );
}

export function fmtTZS(n) {
  const v = Number(n || 0);
  return `TZS ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export const ROLE_LABEL = { admin_viewer: "Viewer", admin_support: "Support agent", admin_super: "Super admin" };
