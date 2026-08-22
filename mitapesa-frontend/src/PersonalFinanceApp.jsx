import React, { useState, useEffect, useRef } from "react";
import {
  Home, ListChecks, Target, UploadCloud, Users, Plus, Sun, Moon, X,
  Copy, Mail, ArrowUpRight, ArrowDownRight, Check, ChevronRight, ChevronLeft,
  Wallet as WalletIcon, Sparkles, PiggyBank, ScanLine, CreditCard,
  QrCode, Send, Landmark, Zap, Wifi, ShieldCheck, ArrowLeft,
  BarChart3 as ChartIcon, UserPlus, Receipt, Phone, KeyRound, RefreshCw,
  MessageCircle, BadgeCheck, PieChart as PieIcon, BarChart2,
  Lock, Unlock, Eye, EyeOff, Mic, ArrowLeftRight, ArrowDownCircle,
  ShieldAlert, User, AtSign, Fingerprint, SlidersHorizontal, TrendingUp, TrendingDown, ChevronDown,
  Bell, Camera, Trash2, CheckCheck, Globe, AlertTriangle, Image as ImageIcon,
  Search, Calendar, Download, Pencil, CheckSquare, Square, Tag, ChevronUp, LogOut, FileText, MessageSquareWarning, Package, Info,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  LineChart, Line, LabelList,
} from "recharts";
import { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } from "@capacitor/barcode-scanner";
import { PushNotifications } from "@capacitor/push-notifications";
import { StatusBar, Style } from "@capacitor/status-bar";
import { api } from "./api";

/* ---------------------------------------------------------------------- */
/*  TOKENS                                                                 */
/* ---------------------------------------------------------------------- */

const THEME = {
  light: {
    bg: "#F6F4EE", bgSoft: "#EFEBE1", card: "#FFFFFF", cardSoft: "#FBF9F4",
    ink: "#12201A", inkSoft: "#5C685F", inkFaint: "#8A9189", border: "#E4E0D3",
    accent: "#1F6F50", accentSoft: "#E4F0E9", gold: "#C4913C", goldSoft: "#F6ECD8",
    danger: "#B44B36", dangerSoft: "#F5E3DD", good: "#1F6F50",
  },
  dark: {
    bg: "#0E1712", bgSoft: "#132018", card: "#16221B", cardSoft: "#1B2921",
    ink: "#ECEAE1", inkSoft: "#9CAA9F", inkFaint: "#6C776E", border: "#25352A",
    accent: "#45B383", accentSoft: "#1B3227", gold: "#E3B968", goldSoft: "#2B2417",
    danger: "#E08267", dangerSoft: "#33221C", good: "#45B383",
  },
};

let __scCounter = 0;
const sc = (name) => ({ id: `sub${__scCounter++}_${name.replace(/\W+/g, "").toLowerCase()}`, name });
const DEFAULT_CATEGORIES = [
  { name: "Food & Dining", color: "#C4913C", subcategories: [sc("Groceries"), sc("Restaurants"), sc("Coffee & Snacks"), sc("Takeout & Delivery")] },
  { name: "Transportation", color: "#3D7EA6", subcategories: [sc("Fuel"), sc("Public Transit"), sc("Ride-hailing"), sc("Parking"), sc("Vehicle Maintenance")] },
  { name: "Housing & Utilities", color: "#1F6F50", subcategories: [sc("Rent/Mortgage"), sc("Electricity"), sc("Water"), sc("Internet"), sc("Home Maintenance")] },
  { name: "Shopping", color: "#B44B36", subcategories: [sc("Clothing"), sc("Electronics"), sc("Household Items"), sc("Gifts")] },
  { name: "Health & Medical", color: "#4E7E8E", subcategories: [sc("Pharmacy"), sc("Doctor Visits"), sc("Insurance"), sc("Fitness")] },
  { name: "Education", color: "#7C6BAE", subcategories: [sc("Tuition"), sc("Books & Supplies"), sc("Courses")] },
  { name: "Entertainment", color: "#A0527C", subcategories: [sc("Movies & Shows"), sc("Events"), sc("Games"), sc("Streaming")] },
  { name: "Bills & Subscriptions", color: "#4A8C8C", subcategories: [sc("Phone"), sc("Software"), sc("Memberships")] },
  { name: "Family", color: "#9C7A4A", subcategories: [sc("Childcare"), sc("School Fees"), sc("Family Support")] },
  { name: "Personal Care", color: "#6B8E4E", subcategories: [sc("Salon & Grooming"), sc("Cosmetics"), sc("Wellness")] },
  { name: "Financial", color: "#5B7FBA", subcategories: [sc("Bank Fees"), sc("Loan Payments"), sc("Savings & Investing")] },
  { name: "Travel", color: "#B08968", subcategories: [sc("Flights"), sc("Accommodation"), sc("Activities")] },
  { name: "Other", color: "#8A8578", subcategories: [sc("Miscellaneous")] },
];

const COLOR_POOL = ["#8E5B7F", "#7E8E4E", "#C97B63", "#5E9E8A", "#8C7EA8", "#B0876B", "#6F9BB8", "#A67C52"];
const colorFor = (categories, name) => (categories.find((c) => c.name === name) || categories.at(-1) || { color: "#8A8578" }).color;

// Every stored transaction amount is always in TZS (see backend
// docs/MULTI_CURRENCY.md — TZS is the one real anchor currency, since
// that's what the actual wallet balance holds and what every payment
// rail settles in). This module-level state is how fmt()/fmtTZS() know
// which currency to DISPLAY amounts in and what rate to convert at —
// synced once at app load and after any currency change (see
// syncDisplayCurrency below), not threaded through props, since doing
// that across the ~90 places this file formats money would be a much
// larger and riskier change for what's fundamentally a display concern.
let _displayCurrency = { code: "TZS", rate: 1 };
function setDisplayCurrency(code, rate) {
  _displayCurrency = { code: code || "TZS", rate: rate && rate > 0 ? rate : 1 };
}
function getDisplayCurrency() { return _displayCurrency; }

// Every amount-entry form in this app (Add Transaction, Voice logging)
// takes input in TZS specifically — the app's one real stored currency,
// see the note near fmt/fmtTZS. When a customer has switched their
// display currency away from TZS, that's a real point of confusion: they
// see everything ELSE in USD, then hit a form asking for a plain number
// with no currency context. This shows a live "≈ USD 19" hint as they
// type, and returns null entirely for a TZS customer (nothing to show —
// input and display already match).
function CurrencyEquivalentHint({ t, amountTZS }) {
  const { code, rate } = getDisplayCurrency();
  const n = parseFloat(amountTZS);
  if (code === "TZS" || !amountTZS || isNaN(n) || n <= 0) return null;
  const converted = n / rate;
  return <p className="text-[11.5px] mt-1" style={{ color: t.inkFaint }}>≈ {code} {converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>;
}

// fmt() was a leftover from the original US-centric prototype ("Ledgerly")
// — it showed "$" everywhere, never converted during the Tanzania-specific
// pivot to fmtTZS(). Both now share one implementation, currency-aware.
// For a TZS customer (the default; rate=1, code="TZS") this produces
// byte-identical output to before this feature existed — zero behavior
// change unless a customer has actually switched currency.
const fmtTZS = (n) => {
  const { code, rate } = _displayCurrency;
  const converted = n / rate;
  return `${converted < 0 ? "-" : ""}${code} ${Math.abs(Math.round(converted)).toLocaleString()}`;
};
const fmt = fmtTZS;

// Always the true, unconverted TZS amount — regardless of the customer's
// chosen display currency. Used specifically on confirm/charge screens
// (e.g. a fixed-amount QR payment), where showing the actual amount
// about to be debited matters more than display-currency convenience —
// the wallet balance is always TZS, so that's the number that should be
// unambiguous at the moment of committing to a real charge. Paired with
// CurrencyEquivalentHint alongside it for the customer's own reference.
const fmtTZSBase = (n) => `${n < 0 ? "-" : ""}TZS ${Math.abs(Math.round(n)).toLocaleString()}`;

// Mirrors the backend's calculateTransferFee() exactly (lib/institutionRules.js)
// — used for the PARTNER/institution fee specifically, when only a
// structural preview (not a real amount-priced quote) is available yet.
function computeFeeEstimate(fee, amount) {
  if (!fee || !amount) return 0;
  if (fee.feeType === "fixed") return fee.feeFixedAmount;
  if (fee.feeType === "percentage") {
    let f = amount * (fee.feePercentage / 100);
    if (fee.feeCapAmount !== null && fee.feeCapAmount !== undefined) f = Math.min(f, fee.feeCapAmount);
    return Math.round(f * 100) / 100;
  }
  return 0;
}

// Mirrors the backend's computeRuleFee() exactly (lib/feeEngine.js) — for
// the MITAPESA fee specifically, from the structural rule preview
// (previewFeeRule) returned when the amount isn't known yet.
// Mirrors the backend's computeBundleVat() exactly (lib/bundleLifecycle.js)
// — shows the true VAT-inclusive total a customer will actually be charged
// before they purchase, not just the bundle's listed base price.
function computeBundleVat(bundle) {
  const price = Number(bundle.price) || 0;
  const rate = Number(bundle.vatRate) || 0;
  if (bundle.taxTreatment === "VAT_EXCLUSIVE" && rate > 0) {
    const vatAmount = Math.round(price * (rate / 100) * 100) / 100;
    return { vatAmount, totalCharge: price + vatAmount };
  }
  if (bundle.taxTreatment === "VAT_INCLUSIVE" && rate > 0) {
    const vatAmount = Math.round((price - price / (1 + rate / 100)) * 100) / 100;
    return { vatAmount, totalCharge: price };
  }
  return { vatAmount: 0, totalCharge: price };
}

function computeMitaPesaFeeEstimate(rule, amount) {
  if (!rule || !amount) return 0;
  const applyCap = (fee) => {
    let f = fee;
    if (rule.minFee !== null && rule.minFee !== undefined) f = Math.max(f, rule.minFee);
    if (rule.maxFee !== null && rule.maxFee !== undefined) f = Math.min(f, rule.maxFee);
    return Math.max(0, Math.round(f * 100) / 100);
  };
  switch (rule.feeModel) {
    case "zero": case "display_only": return 0;
    case "fixed": return applyCap(rule.fixedAmount || 0);
    case "percentage": return applyCap(amount * ((rule.percentage || 0) / 100));
    case "fixed_plus_percentage": return applyCap((rule.fixedAmount || 0) + amount * ((rule.percentage || 0) / 100));
    case "tiered": {
      const tier = (rule.tiers || []).find((t) => amount >= t.minAmount && (t.maxAmount === null || amount <= t.maxAmount));
      if (!tier) return 0;
      const tierFee = tier.feeModel === "percentage" ? amount * ((tier.percentage || 0) / 100) : (tier.fixedAmount || 0);
      return applyCap(tierFee);
    }
    default: return 0;
  }
}

// Normalizes the two shapes /qr/resolve can return into one consistent
// breakdown: a REAL quote (fixed-amount QR — the backend already computed
// everything) has `totalFee` directly; a STRUCTURAL PREVIEW (amount not
// known yet) has `mitaPesaFeeRule` + a partner-fee-structure object instead,
// which need client-side estimation as the customer types an amount.
function vatLabelFor(taxTreatment, language = "en") {
  if (taxTreatment === "VAT_INCLUSIVE") return language === "sw" ? "VAT (imejumuishwa)" : "VAT (inclusive)";
  if (taxTreatment === "VAT_EXCLUSIVE") return "VAT";
  return language === "sw" ? "Kodi" : "Tax";
}

function getFeeBreakdown(fee, amount, language = "en") {
  if (!fee) return { mitaPesaFee: 0, partnerFee: 0, tax: 0, totalFee: 0, transfersEnabled: true, coveredMessage: null, wouldBeMitaPesaFee: null, taxLabel: null };

  if (fee.totalFee !== undefined) {
    // A real, authoritative quote — the amount was already known. When a
    // bundle/exemption waived the fee (bundleBenefit > 0), the backend's
    // own disclosure text explains why — previously ignored here, which
    // meant this path showed no explanation at all for a waived fee.
    const isCovered = Number(fee.bundleBenefit || 0) > 0;
    return {
      mitaPesaFee: fee.mitaPesaFee || 0, partnerFee: fee.partnerFee || 0, tax: fee.tax || 0, totalFee: fee.totalFee || 0,
      transfersEnabled: fee.transfersEnabled !== false,
      coveredMessage: isCovered ? (language === "sw" ? fee.disclosureSw || fee.disclosureEn : fee.disclosureEn) : null,
      wouldBeMitaPesaFee: fee.bundleBenefit > 0 ? fee.bundleBenefit : null,
      taxLabel: fee.tax > 0 ? vatLabelFor(fee.taxTreatment, language) : null,
    };
  }

  // Amount not known yet — estimate client-side, mirroring the backend
  // exactly. When covered (bundle/exemption), mitaPesaFeeRule holds the
  // rule that WOULD have applied — used to show "waived," never omitted.
  const partnerFee = computeFeeEstimate(fee.partnerFee, amount);
  const wouldBeMitaPesaFee = computeMitaPesaFeeEstimate(fee.mitaPesaFeeRule, amount);
  if (fee.coveredMessage) {
    // The partner/institution fee (a bank markup, separate from MitaPesa's
    // own fee) still applies independently — a bundle only ever covers
    // MitaPesa's own fee, never the bank's.
    return {
      mitaPesaFee: 0, partnerFee, tax: 0, totalFee: partnerFee, transfersEnabled: fee.transfersEnabled !== false,
      coveredMessage: language === "sw" ? (fee.coveredMessageSw || fee.coveredMessage) : fee.coveredMessage,
      wouldBeMitaPesaFee: wouldBeMitaPesaFee > 0 ? wouldBeMitaPesaFee : null,
      taxLabel: fee.mitaPesaFeeRule?.taxTreatment ? vatLabelFor(fee.mitaPesaFeeRule.taxTreatment, language) : null,
    };
  }
  return {
    mitaPesaFee: wouldBeMitaPesaFee, partnerFee, tax: 0, totalFee: wouldBeMitaPesaFee + partnerFee,
    transfersEnabled: fee.transfersEnabled !== false, coveredMessage: null, wouldBeMitaPesaFee: null,
    taxLabel: fee.mitaPesaFeeRule?.taxTreatment ? vatLabelFor(fee.mitaPesaFeeRule.taxTreatment, language) : null,
  };
}

// Customer-facing view: merges the MitaPesa/partner split into one neutral
// "Charge" component — which party collects what is an internal business
// arrangement, not something a customer needs to see. VAT stays separate
// since it's a legally distinct component, matching how real Tanzanian
// mobile money apps disclose charges (e.g. "Charge X, VAT Y, Ex Duty Z").
// Matches the reference disclosure pattern: one combined "Charges" line,
// with a small caption underneath spelling out the neutral components
// (Charge, VAT) — no MitaPesa/partner attribution ever surfaces here.
function ChargesLine({ t, view, tr }) {
  if (!view.transfersEnabled) {
    return <p className="text-[12px]" style={{ color: t.danger }}>{tr("feeTransfersUnavailable")}</p>;
  }
  const captionParts = [];
  if (view.charge > 0) captionParts.push(`${tr("feeCharge")} ${fmtTZSBase(view.charge)}`);
  if (view.vat > 0) captionParts.push(`${view.vatLabel} ${fmtTZSBase(view.vat)}`);

  return (
    <div className="mb-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px]" style={{ color: t.inkFaint }}>
          {tr("feeCharges")} {(captionParts.length > 0 || view.coveredMessage) && <Info size={12} color={t.inkFaint} />}
        </span>
        <span className="text-[12px] font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {view.isWaived && view.wouldBeTotalCharges > 0 ? (
            <>
              <span style={{ textDecoration: "line-through", color: t.inkFaint, marginRight: 6 }}>{fmtTZSBase(view.wouldBeTotalCharges)}</span>
              <span style={{ color: t.good }}>{tr("feeFree")}</span>
            </>
          ) : (
            <span style={{ color: t.ink }}>{view.totalCharges > 0 ? fmtTZSBase(view.totalCharges) : tr("feeFree")}</span>
          )}
        </span>
      </div>
      {view.coveredMessage ? (
        <p className="text-[10.5px] mt-0.5" style={{ color: t.good }}>{view.coveredMessage}</p>
      ) : captionParts.length > 0 && (
        <p className="text-[10.5px] mt-0.5" style={{ color: t.inkFaint }}>{captionParts.join(", ")}</p>
      )}
    </div>
  );
}

// Shown on a payment confirm screen when a fee is being charged and
// there's a bundle available that would cover it, but isn't currently
// active. Deliberately simple — one line naming the bundle, one button —
// matching the reference design rather than a full bundle-details screen.
function BundleUpsellCard({ t, bundle, onSubscribed }) {
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState("");

  const subscribe = async () => {
    setSubscribing(true); setError("");
    try {
      await api.bundles.purchase(bundle.id);
      await onSubscribed();
    } catch (err) {
      setError(err.message || "Couldn't subscribe right now.");
    } finally {
      setSubscribing(false);
    }
  };

  return (
    <div className="p-3.5 rounded-[14px] mb-4" style={{ background: t.accentSoft, border: `1px solid ${t.border}` }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: t.ink }}>Transactional bundle</p>
          <p className="text-[11.5px] truncate" style={{ color: t.inkFaint }}>{bundle.nameEn} · {fmtTZSBase(bundle.price)} / {bundle.validity.toLowerCase()}</p>
        </div>
        <button onClick={subscribe} disabled={subscribing} className="shrink-0 px-3.5 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: t.accent, color: "#fff" }}>
          {subscribing ? "…" : "Subscribe"}
        </button>
      </div>
      {error && <p className="text-[11px] mt-1.5" style={{ color: t.danger }}>{error}</p>}
    </div>
  );
}

function getCustomerChargesView(breakdown) {
  const charge = breakdown.mitaPesaFee + breakdown.partnerFee;
  const vat = breakdown.tax;
  const totalCharges = charge + vat;
  const wouldBeCharge = breakdown.wouldBeMitaPesaFee !== null ? breakdown.wouldBeMitaPesaFee + breakdown.partnerFee : null;
  return {
    totalCharges, charge, vat, vatLabel: breakdown.taxLabel,
    isWaived: breakdown.wouldBeMitaPesaFee !== null,
    wouldBeTotalCharges: wouldBeCharge !== null ? wouldBeCharge + vat : null,
    coveredMessage: breakdown.coveredMessage,
    transfersEnabled: breakdown.transfersEnabled,
  };
}

const uid = () => Math.random().toString(36).slice(2, 10);
const hashCode = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
const shortId = () => Math.abs(hashCode(uid())).toString(16).toUpperCase().slice(0, 8);
const KYC_THRESHOLD = 50000;

// Mirrors the backend's own VERIFIED_CHANNEL_SOURCES (transactions.routes.js)
// - kept in sync manually since the two can't share a constant across the
// boundary. Used so the edit UI locks these fields upfront instead of
// letting the customer edit them and only finding out the save silently
// didn't apply after the backend rejects it.
const VERIFIED_CHANNEL_SOURCES = ["topup_gateway", "topup_oct"];
const TODAY_STR = new Date().toISOString().slice(0, 10);

function daysBetween(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date(TODAY_STR + "T00:00:00");
  return Math.round((today - d) / 86400000);
}

function dateBucket(dateStr, tr) {
  const diff = daysBetween(dateStr);
  if (diff === 0) return tr("today");
  if (diff === 1) return tr("yesterday");
  if (diff > 1 && diff <= 7) return tr("thisWeek");
  return tr("earlier");
}

function inDateRange(dateStr, preset, customFrom, customTo) {
  if (preset === "all") return true;
  const diff = daysBetween(dateStr);
  if (preset === "today") return diff === 0;
  if (preset === "yesterday") return diff === 1;
  if (preset === "week") return diff >= 0 && diff <= 6;
  if (preset === "month") return dateStr.slice(0, 7) === TODAY_STR.slice(0, 7);
  if (preset === "custom") return (!customFrom || dateStr >= customFrom) && (!customTo || dateStr <= customTo);
  return true;
}

function exportTransactionsCSV(rows) {
  const header = "Date,Merchant,Category,Amount\n";
  const body = rows.map((r) => `${r.date},"${(r.merchant || "").replace(/"/g, '""')}",${r.category},${r.amount}`).join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `mitapesa-export-${TODAY_STR}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------------- */
/*  MOCK DATA                                                              */
/* ---------------------------------------------------------------------- */

const initialBudgets = [
  { category: "Food & Dining", limit: 500 }, { category: "Housing & Utilities", limit: 1680 }, { category: "Entertainment", limit: 120 },
  { category: "Transportation", limit: 150 }, { category: "Shopping", limit: 200 },
];

const TIPS_MERCHANTS = ["Kariakoo Textile Shop", "Mama Ntilie Kitchen", "Highway Auto Spares", "Sunrise Pharmacy", "Bahari Beach Cafe"];
const resolveTips = (num) => TIPS_MERCHANTS[Math.abs(hashCode(num)) % TIPS_MERCHANTS.length];

const GEPG_BILLERS = ["TRA – Motor Vehicle License", "NIDA – ID Replacement Fee", "Ardhi – Land Rent", "Muhimbili Hospital Bill", "University Tuition Payment"];
const resolveGepg = (control) => { const h = Math.abs(hashCode(control)); return { biller: GEPG_BILLERS[h % GEPG_BILLERS.length], amount: 20 + (h % 180) }; };

/* NIDA lookup, OTP, and KBV fallback now live server-side (see /kyc/* in the
   backend) — KycStep below calls api.kyc.* instead of resolving locally. */

const QR_MERCHANTS = ["Kariakoo Fresh Market", "Slipway Craft Stall", "Java House Cafe", "Msasani Boutique"];

const genLukuToken = () => Array.from({ length: 5 }, () => String(Math.floor(1000 + Math.random() * 9000))).join("-");

const CARD_HOLDERS = ["Neema K.", "Baraka M.", "Furaha S.", "Elias T.", "Amina R."];
const resolveCardHolder = (num) => CARD_HOLDERS[Math.abs(hashCode(num)) % CARD_HOLDERS.length];

const BANKS = ["CRDB Bank", "NMB Bank", "NBC Bank", "Stanbic Bank", "Absa Bank", "Equity Bank", "DTB Bank", "Exim Bank"];
const resolveBankHolder = (num) => CARD_HOLDERS[Math.abs(hashCode(num + "bank")) % CARD_HOLDERS.length];

const CATEGORY_KEYWORDS = [
  { keys: ["lunch", "dinner", "breakfast", "coffee", "grocery", "food", "restaurant"], category: "Food & Dining" },
  { keys: ["uber", "taxi", "bus", "fuel", "petrol", "bodaboda", "transport"], category: "Transportation" },
  { keys: ["rent", "house", "apartment"], category: "Housing & Utilities" },
  { keys: ["movie", "cinema", "netflix", "concert", "game"], category: "Entertainment" },
  { keys: ["shoes", "clothes", "shopping", "outfit"], category: "Shopping" },
  { keys: ["electricity", "water", "bill", "utility", "utilities"], category: "Housing & Utilities" },
];
function parseVoiceExpense(text, categories) {
  const amountMatch = text.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : null;
  const lower = text.toLowerCase();
  let category = categories.find((c) => lower.includes(c.name.toLowerCase()))?.name;
  if (!category) category = CATEGORY_KEYWORDS.find((k) => k.keys.some((w) => lower.includes(w)))?.category;
  if (!category) category = categories.find((c) => c.name === "Other")?.name || "Other";
  const atMatch = text.match(/(?:at|from) ([A-Z][A-Za-z0-9 &'-]+)/);
  const merchant = atMatch ? atMatch[1].trim() : `Voice entry · ${category}`;
  return { amount, category, merchant };
}

/* ---------------------------------------------------------------------- */
/*  TRANSLATIONS (EN / SW)                                                 */
/* ---------------------------------------------------------------------- */

const TRANSLATIONS = {
  en: {
    navHome: "Home", navLedger: "Ledger", navBudget: "Budget", navPay: "Pay", navWallets: "Wallets",
    goodEvening: "Good evening", yourOverview: "Your overview", totalBalance: "Total balance",
    monthlyIncome: "Monthly income", monthlyExpenses: "Monthly expenses", remainingBudget: "Remaining budget",
    ofPlanned: "of {0} planned this month", recentActivity: "Recent activity",
    transactionLedger: "Transaction ledger", import: "Import", noTransactions: "No transactions in this category yet.",
    budgetPlanner: "Budget planner", budgetPlannerSub: "Set monthly limits and track how close you are to each one.",
    addCategoryBudget: "Add a category budget", newCategory: "New category",
    pay: "Pay", paySub: "Prepaid card. Load it. Spend it. Stay in control.",
    cardBalance: "Card balance", billMerchantPayments: "Bill & merchant payments", cardServices: "Card services",
    cardActivity: "Card activity", insights: "Insights", controls: "Controls", activity: "Activity",
    noCardActivity: "No card activity yet.", nidaVerified: "NIDA verified", basicUpTo: "Basic · up to {0}",
    wallets: "Wallets", sharedHouseholdWallet: "Shared Household Wallet", personalBalance: "Personal balance",
    householdBalance: "Household balance", recentTransactions: "Recent transactions", sharedActivity: "Shared activity",
    myPersonalWallet: "My Personal Wallet", noActivityWallet: "No activity yet in this wallet.",
    notifications: "Notifications", clearAll: "Clear all", markAllRead: "Mark all read",
    noNotifications: "No notifications yet.", profile: "Profile", changePhoto: "Change photo", removePhoto: "Remove photo",
    firstName: "First name", lastName: "Last name", email: "Email address", phone: "Mobile number",
    accountDetails: "Account details", save: "Save",
    quickActions: "Quick actions", addExpense: "Add", voiceLog: "Voice log",
    seeAll: "See all", topCategory: "Top category this month", viewInsights: "View insights",
    budgetUsed: "Budget used", leftOfPlan: "{0} left of {1}", noRecentActivity: "No recent activity yet.",
    searchPlaceholder: "Search merchant…", dateRange: "Date range", today: "Today", yesterday: "Yesterday",
    thisWeek: "This week", thisMonth: "This month", allTime: "All time", custom: "Custom", from: "From", to: "To",
    apply: "Apply", earlier: "Earlier", select: "Select", cancel: "Cancel", selectAll: "Select all",
    selected: "{0} selected", export: "Export", deleteSelected: "Delete", noResults: "No transactions match your filters.",
    txCount: "{0} transactions", editTransaction: "Edit transaction", deleteTransaction: "Delete transaction",
    deleteConfirmMsg: "This can't be undone. Delete this transaction?", saveChanges: "Save changes",
    delete: "Delete", merchant: "Merchant", date: "Date", type: "Type", expense: "Expense", income: "Income",
    scanReceipt: "Scan receipt", takePhoto: "Take photo", readingReceipt: "Reading receipt…",
    savedToLedger: "Saved to your ledger", scanIntro: "Snap a photo and we'll pull out the merchant, amount, and category automatically.",
    confidenceNote: "confidence · double-check if anything looks off",
    budgetPerformance: "Budget performance", forYou: "For you",
    feeAmount: "Amount", feeCharges: "Charges", feeTotalAmount: "Total amount", feeCharge: "Charge", feeVat: "VAT", feeVatInclusive: "VAT (inclusive)", feeTax: "Tax", feeWaived: "Waived", feeFree: "FREE", feeTransfersUnavailable: "Transfers to this institution are currently unavailable.",
  },
  sw: {
    navHome: "Nyumbani", navLedger: "Daftari", navBudget: "Bajeti", navPay: "Lipa", navWallets: "Pochi",
    goodEvening: "Habari za jioni", yourOverview: "Muhtasari wako", totalBalance: "Salio jumla",
    monthlyIncome: "Mapato ya mwezi", monthlyExpenses: "Matumizi ya mwezi", remainingBudget: "Bajeti iliyobaki",
    ofPlanned: "kati ya {0} zilizopangwa mwezi huu", recentActivity: "Shughuli za hivi karibuni",
    transactionLedger: "Daftari la miamala", import: "Ingiza", noTransactions: "Hakuna miamala kwenye kundi hili bado.",
    budgetPlanner: "Mpangaji wa bajeti", budgetPlannerSub: "Weka kikomo cha kila mwezi na fuatilia jinsi ulivyo karibu na kila kimoja.",
    addCategoryBudget: "Ongeza bajeti ya kundi", newCategory: "Kundi jipya",
    pay: "Lipa", paySub: "Kadi tangulizi. Ijaze. Itumie. Dhibiti matumizi yako.",
    cardBalance: "Salio la kadi", billMerchantPayments: "Malipo ya bili na wafanyabiashara", cardServices: "Huduma za kadi",
    cardActivity: "Shughuli za kadi", insights: "Uchambuzi", controls: "Udhibiti", activity: "Shughuli",
    noCardActivity: "Hakuna shughuli za kadi bado.", nidaVerified: "Imethibitishwa na NIDA", basicUpTo: "Msingi · hadi {0}",
    wallets: "Pochi", sharedHouseholdWallet: "Pochi ya Pamoja ya Familia", personalBalance: "Salio la kibinafsi",
    householdBalance: "Salio la familia", recentTransactions: "Miamala ya hivi karibuni", sharedActivity: "Shughuli za pamoja",
    myPersonalWallet: "Pochi Yangu Binafsi", noActivityWallet: "Hakuna shughuli bado kwenye pochi hii.",
    notifications: "Arifa", clearAll: "Futa zote", markAllRead: "Weka zote kama zimesomwa",
    noNotifications: "Hakuna arifa bado.", profile: "Wasifu", changePhoto: "Badilisha picha", removePhoto: "Ondoa picha",
    firstName: "Jina la kwanza", lastName: "Jina la mwisho", email: "Barua pepe", phone: "Nambari ya simu",
    accountDetails: "Taarifa za akaunti", save: "Hifadhi",
    quickActions: "Vitendo vya haraka", addExpense: "Ongeza", voiceLog: "Ingiza kwa sauti",
    seeAll: "Ona zote", topCategory: "Kundi kuu mwezi huu", viewInsights: "Ona uchambuzi",
    budgetUsed: "Bajeti iliyotumika", leftOfPlan: "{0} imebaki kati ya {1}", noRecentActivity: "Hakuna shughuli za hivi karibuni.",
    searchPlaceholder: "Tafuta muuzaji…", dateRange: "Kipindi cha tarehe", today: "Leo", yesterday: "Jana",
    thisWeek: "Wiki hii", thisMonth: "Mwezi huu", allTime: "Muda wote", custom: "Maalum", from: "Kutoka", to: "Hadi",
    apply: "Tumia", earlier: "Awali", select: "Chagua", cancel: "Ghairi", selectAll: "Chagua zote",
    selected: "{0} zimechaguliwa", export: "Hamisha", deleteSelected: "Futa", noResults: "Hakuna miamala inayolingana na vichungi vyako.",
    txCount: "miamala {0}", editTransaction: "Hariri muamala", deleteTransaction: "Futa muamala",
    deleteConfirmMsg: "Hili haliwezi kutenduliwa. Futa muamala huu?", saveChanges: "Hifadhi mabadiliko",
    delete: "Futa", merchant: "Muuzaji", date: "Tarehe", type: "Aina", expense: "Matumizi", income: "Mapato",
    scanReceipt: "Piga picha ya risiti", takePhoto: "Piga picha", readingReceipt: "Inasoma risiti…",
    savedToLedger: "Imehifadhiwa kwenye daftari lako", scanIntro: "Piga picha na tutatoa muuzaji, kiasi, na kundi kiotomatiki.",
    confidenceNote: "uhakika · angalia kama kuna kitu hakiko sawa",
    budgetPerformance: "Utendaji wa bajeti", forYou: "Kwa ajili yako",
    feeAmount: "Kiasi", feeCharges: "Ada", feeTotalAmount: "Jumla ya kiasi", feeCharge: "Ada ya huduma", feeVat: "VAT", feeVatInclusive: "VAT (imejumuishwa)", feeTax: "Kodi", feeWaived: "Imesamehewa", feeFree: "BURE", feeTransfersUnavailable: "Uhamishaji kwenda taasisi hii kwa sasa haupatikani.",
  },
};

function makeTr(language) {
  return (key, ...args) => {
    let str = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS.en[key] ?? key;
    args.forEach((a, i) => { str = str.replace(`{${i}}`, a); });
    return str;
  };
}

/* ---------------------------------------------------------------------- */
/*  NOTIFICATIONS (seed data)                                              */
/* ---------------------------------------------------------------------- */

const NOTIF_ICON = {
  topup: ArrowDownCircle, payment: ArrowUpRight, bill_payment: Receipt,
  qr_payment_completed: Check, qr_payment_reversed: RefreshCw,
  wallet_invite: WalletIcon, wallet_invite_accepted: WalletIcon, virtual_card_issued: CreditCard,
  account_blocked: AlertTriangle, account_unblocked: ShieldCheck, ticket_resolved: MessageSquareWarning,
  shared_expense: WalletIcon,
  // Legacy/demo types kept for backward compatibility with any old seed data.
  received: ArrowDownCircle, sent: ArrowUpRight, deposit: ArrowDownCircle, withdrawal: ArrowUpRight,
  budget_alert: AlertTriangle, savings_milestone: PiggyBank, bill_confirmation: Receipt,
};
function notifTone(type, t) {
  if (["budget_alert", "account_blocked", "qr_payment_reversed"].includes(type)) return t.danger;
  if (["received", "deposit", "savings_milestone", "topup", "qr_payment_completed", "account_unblocked", "ticket_resolved"].includes(type)) return t.good;
  if (["bill_confirmation", "bill_payment", "wallet_invite", "wallet_invite_accepted", "virtual_card_issued"].includes(type)) return t.gold;
  return t.inkSoft;
}

/* ---------------------------------------------------------------------- */
/*  PRIMITIVES                                                             */
/* ---------------------------------------------------------------------- */

function MitaPesaMark({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <circle cx="256" cy="256" r="230" fill="#1F6F50" />
      <path d="M130 256 L200 256 L232 190 L288 340 L320 256 L382 256" fill="none" stroke="#45B383" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Card({ t, className = "", children, style = {} }) {
  return <div className={`rounded-[22px] border ${className}`} style={{ background: t.card, borderColor: t.border, ...style }}>{children}</div>;
}

function SectionLabel({ t, children, right }) {
  return (
    <div className="flex items-center justify-between px-1 mb-2.5">
      <h2 className="text-[13px] font-semibold tracking-wide uppercase" style={{ color: t.inkFaint, fontFamily: "'Space Grotesk', sans-serif" }}>{children}</h2>
      {right}
    </div>
  );
}

function CategoryDot({ color, size = 8 }) {
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, background: color }} />;
}

function Pill({ t, active, children, onClick }) {
  return (
    <button onClick={onClick} className="px-3.5 py-1.5 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors"
      style={{ background: active ? t.accent : t.cardSoft, color: active ? "#fff" : t.inkSoft, border: `1px solid ${active ? t.accent : t.border}`, fontFamily: "'Inter', sans-serif" }}>
      {children}
    </button>
  );
}

function Switch({ t, on, onChange, disabled }) {
  return (
    <button onClick={() => !disabled && onChange(!on)} className="w-11 h-6 rounded-full relative shrink-0 transition-colors" style={{ background: on ? t.accent : t.border, opacity: disabled ? 0.5 : 1 }}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform" style={{ transform: on ? "translateX(22px)" : "translateX(2px)" }} />
    </button>
  );
}

function ProgressRing({ t, percent, size = 132, stroke = 13, label, sub, tone }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(percent, 0), 1);
  const color = tone || (clamped > 0.9 ? t.danger : clamped > 0.7 ? t.gold : t.accent);
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={t.bgSoft} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-[20px] font-bold leading-tight" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{label}</span>
        <span className="text-[11px]" style={{ color: t.inkFaint }}>{sub}</span>
      </div>
    </div>
  );
}

function BudgetBar({ t, spent, limit }) {
  const pct = limit > 0 ? Math.min(spent / limit, 1) : 0;
  const over = spent > limit;
  const color = pct > 0.9 ? t.danger : pct > 0.65 ? t.gold : t.good;
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: t.bgSoft }}>
      <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: over ? t.danger : `linear-gradient(90deg, ${t.good}, ${color})`, transition: "width 0.5s ease" }} />
    </div>
  );
}

function BottomSheet({ t, open, onClose, title, children, onBack }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0" style={{ background: "rgba(10,14,11,0.55)" }} onClick={onClose} />
      <div className="relative w-full max-w-[430px] rounded-t-[26px] border-t px-5 pt-4 pb-7 max-h-[88vh] overflow-y-auto" style={{ background: t.card, borderColor: t.border }}>
        <div className="w-10 h-1.5 rounded-full mx-auto mb-4" style={{ background: t.border }} />
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {onBack && <button onClick={onBack} className="p-1.5 rounded-full" style={{ background: t.bgSoft }}><ArrowLeft size={15} color={t.inkSoft} /></button>}
            <h3 className="text-[17px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full" style={{ background: t.bgSoft }}><X size={16} color={t.inkSoft} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ t, label, children }) {
  return (
    <div className="mb-3.5">
      <label className="block text-[12px] font-medium mb-1.5" style={{ color: t.inkFaint }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = (t) => ({ width: "100%", padding: "11px 13px", borderRadius: 13, border: `1px solid ${t.border}`, background: t.cardSoft, color: t.ink, fontSize: 14, fontFamily: "'Inter', sans-serif", outline: "none" });

function PrimaryButton({ t, onClick, children, disabled, tone }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full py-3 rounded-full font-semibold text-[14px] flex items-center justify-center gap-2"
      style={{ background: tone || t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: disabled ? 0.5 : 1 }}>
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------- */
/*  FRICTIONLESS KYC (NIDA) STEP                                            */
/* ---------------------------------------------------------------------- */

function KycOtpDigits({ t, digits, setDigits }) {
  const refs = useRef([]);
  const setDigit = (i, val) => {
    if (!/^[0-9]?$/.test(val)) return;
    const next = [...digits]; next[i] = val; setDigits(next);
    if (val && i < 5) refs.current[i + 1]?.focus();
  };
  const handleKeyDown = (i, e) => { if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus(); };
  return (
    <div className="flex gap-2 justify-between mb-4">
      {digits.map((d, i) => (
        <input key={i} ref={(el) => (refs.current[i] = el)} value={d} onChange={(e) => setDigit(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} inputMode="numeric" maxLength={1}
          className="w-10 text-center text-[18px] font-bold rounded-[12px]" style={{ height: 48, background: t.cardSoft, border: `1.5px solid ${d ? t.accent : t.border}`, color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }} />
      ))}
    </div>
  );
}

function KycStep({ t, amount, onVerified }) {
  const [phase, setPhase] = useState("nida"); // nida -> resolving -> choose -> otp -> kbv -> failed
  const [nida, setNida] = useState("");
  const [record, setRecord] = useState(null); // { maskedName, maskedPhone } from the server
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const [otpError, setOtpError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [timer, setTimer] = useState(30);
  const [kbvQuestions, setKbvQuestions] = useState([]);
  const [kbvAnswers, setKbvAnswers] = useState({});
  const [kbvError, setKbvError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const valid = nida.length >= 8;

  useEffect(() => {
    if (phase !== "otp" || timer <= 0) return;
    const id = setTimeout(() => setTimer((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, timer]);

  const lookUp = async () => {
    setPhase("resolving"); setLookupError("");
    try {
      const found = await api.kyc.lookup(nida);
      setRecord(found);
      setPhase("choose");
    } catch (err) {
      setLookupError(err.message || "Couldn't reach the NIDA record. Please try again.");
      setPhase("nida");
    }
  };

  const sendOtp = async () => {
    setOtpDigits(["", "", "", "", "", ""]);
    setOtpError(""); setPhase("otp");
    try {
      const { expiresInSec } = await api.kyc.sendOtp();
      setTimer(expiresInSec || 30);
    } catch (err) {
      setOtpError(err.message || "Couldn't send the code. Try again.");
    }
  };

  const verifyOtp = async () => {
    const code = otpDigits.join("");
    if (code.length !== 6) return;
    setVerifying(true);
    try {
      const { verified } = await api.kyc.verifyOtp(code);
      setVerifying(false);
      if (verified) onVerified();
      else setOtpError("That code didn't match. Check and try again.");
    } catch (err) {
      setVerifying(false);
      setOtpError(err.message || "Verification failed. Try again.");
    }
  };

  const startKbv = async () => {
    setKbvAnswers({}); setKbvError(""); setPhase("kbv");
    try {
      const { questions } = await api.kyc.kbvQuestions();
      setKbvQuestions(questions);
    } catch (err) {
      setKbvError(err.message || "Couldn't load security questions.");
      setPhase("failed");
    }
  };

  const submitKbv = async () => {
    try {
      const { passed } = await api.kyc.verifyKbv(kbvAnswers);
      if (passed) onVerified();
      else { setKbvError("That didn't match our NIDA records closely enough."); setPhase("failed"); }
    } catch (err) {
      setKbvError(err.message || "Verification failed."); setPhase("failed");
    }
  };

  if (phase === "nida") {
    return (
      <div>
        <div className="flex items-start gap-3 p-4 rounded-[16px] mb-4" style={{ background: t.goldSoft, border: `1px solid ${t.border}` }}>
          <Fingerprint size={20} color={t.gold} className="shrink-0 mt-0.5" />
          <p className="text-[12.5px] leading-relaxed" style={{ color: t.inkSoft }}>
            This is over <span style={{ fontWeight: 700, color: t.ink }}>{fmtTZS(KYC_THRESHOLD)}</span>. We'll look up your NIDA record, then confirm it's really you with a one-time code — you won't need to do this again.
          </p>
        </div>
        <Field t={t} label="NIDA number">
          <input style={inputStyle(t)} placeholder="e.g. 19850101234500012345" value={nida} onChange={(e) => setNida(e.target.value.replace(/[^0-9]/g, ""))} />
        </Field>
        {lookupError && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{lookupError}</p>}
        <PrimaryButton t={t} onClick={lookUp} disabled={!valid} tone={t.gold}><ShieldCheck size={15} /> Look up NIDA record</PrimaryButton>
      </div>
    );
  }

  if (phase === "resolving") {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <RefreshCw size={22} className="animate-spin mb-3" color={t.gold} />
        <p className="text-[13px] font-medium" style={{ color: t.inkSoft }}>Looking up your NIDA record…</p>
      </div>
    );
  }

  if (phase === "choose") {
    return (
      <div>
        <div className="p-4 rounded-[16px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
          <div className="flex items-center gap-2 mb-2"><BadgeCheck size={16} color={t.good} /><p className="text-[12px] font-semibold" style={{ color: t.inkFaint }}>Record found</p></div>
          <p className="text-[15px] font-bold" style={{ color: t.ink }}>{record.maskedName}</p>
          <p className="text-[12.5px] mt-1" style={{ color: t.inkFaint }}>Registered number: <span style={{ color: t.ink, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>{record.maskedPhone}</span></p>
        </div>
        <p className="text-[12.5px] mb-3" style={{ color: t.inkFaint }}>We'll text a 6-digit code to the number registered with this NIDA record to confirm it's you.</p>
        <PrimaryButton t={t} onClick={sendOtp} tone={t.gold}><Phone size={15} /> Send code to {record.maskedPhone}</PrimaryButton>
        <button onClick={startKbv} className="w-full text-center text-[12.5px] font-semibold mt-3" style={{ color: t.accent }}>I don't have access to this number</button>
      </div>
    );
  }

  if (phase === "otp") {
    return (
      <div>
        <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Enter the 6-digit code sent to <span style={{ color: t.ink, fontWeight: 600 }}>{record.maskedPhone}</span>.</p>
        <KycOtpDigits t={t} digits={otpDigits} setDigits={setOtpDigits} />
        {otpError && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{otpError}</p>}
        <button onClick={sendOtp} disabled={timer > 0} className="text-[12.5px] font-medium mb-4 block" style={{ color: timer > 0 ? t.inkFaint : t.accent }}>{timer > 0 ? `Resend code in ${timer}s` : "Resend code"}</button>
        <PrimaryButton t={t} onClick={verifyOtp} disabled={otpDigits.join("").length !== 6 || verifying} tone={t.gold}>
          {verifying ? <><RefreshCw size={15} className="animate-spin" /> Verifying…</> : <><ShieldCheck size={15} /> Verify & continue</>}
        </PrimaryButton>
        <button onClick={startKbv} className="w-full text-center text-[12.5px] font-semibold mt-3" style={{ color: t.accent }}>Can't access this number? Answer security questions instead</button>
      </div>
    );
  }

  if (phase === "kbv") {
    const answeredAll = kbvQuestions.every((q) => kbvAnswers[q.id]);
    return (
      <div>
        <div className="flex items-start gap-3 p-3.5 rounded-[14px] mb-4" style={{ background: t.goldSoft, border: `1px solid ${t.border}` }}>
          <ShieldAlert size={18} color={t.gold} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed" style={{ color: t.inkSoft }}>Answer at least 2 of 3 correctly to confirm this is your NIDA record.</p>
        </div>
        {kbvQuestions.map((q) => (
          <Field t={t} key={q.id} label={q.prompt}>
            <div className="grid grid-cols-2 gap-2">
              {q.options.map((opt) => (
                <button key={opt} onClick={() => setKbvAnswers((prev) => ({ ...prev, [q.id]: opt }))} className="py-2 rounded-[12px] text-[12.5px] font-semibold" style={{ background: kbvAnswers[q.id] === opt ? t.accent : t.cardSoft, color: kbvAnswers[q.id] === opt ? "#fff" : t.inkSoft, border: `1px solid ${kbvAnswers[q.id] === opt ? t.accent : t.border}` }}>{opt}</button>
              ))}
            </div>
          </Field>
        ))}
        <PrimaryButton t={t} onClick={submitKbv} disabled={!answeredAll} tone={t.gold}>Submit answers</PrimaryButton>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="flex flex-col items-center text-center py-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: t.dangerSoft }}><ShieldAlert size={22} color={t.danger} /></div>
        <p className="text-[14px] font-semibold mb-1" style={{ color: t.ink }}>We couldn't verify your identity</p>
        <p className="text-[12.5px] mb-5" style={{ color: t.inkFaint }}>{kbvError || "Your answers didn't match our NIDA records."} You can try the code again, retry the questions, or contact support.</p>
        <div className="flex gap-2 w-full">
          <button onClick={sendOtp} className="flex-1 py-3 rounded-full font-semibold text-[13px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>Try OTP again</button>
          <button onClick={startKbv} className="flex-1 py-3 rounded-full font-semibold text-[13px]" style={{ background: t.gold, color: "#fff" }}>Retry questions</button>
        </div>
      </div>
    );
  }

  return null;
}

/* ---------------------------------------------------------------------- */
/*  RECEIPTS + SUCCESS SCREENS                                              */
/* ---------------------------------------------------------------------- */

function ReceiptBlock({ t, receiptId, verifyCode }) {
  const [verifying, setVerifying] = useState(false);
  const [checked, setChecked] = useState(false);
  const runVerify = () => { setVerifying(true); setTimeout(() => { setVerifying(false); setChecked(true); }, 1000); };

  return (
    <div className="w-full mt-4 p-3.5 rounded-[14px]" style={{ background: t.bgSoft, border: `1px dashed ${t.border}` }}>
      <div className="flex items-center justify-between">
        <div><p className="text-[10px] uppercase tracking-wide" style={{ color: t.inkFaint }}>Receipt ID</p><p className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{receiptId}</p></div>
        <div className="text-right"><p className="text-[10px] uppercase tracking-wide" style={{ color: t.inkFaint }}>Verification code</p><p className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{verifyCode}</p></div>
      </div>
      <button onClick={runVerify} disabled={verifying || checked} className="w-full mt-3 py-2 rounded-full text-[12px] font-semibold flex items-center justify-center gap-1.5" style={{ background: checked ? t.accentSoft : t.card, color: checked ? t.good : t.inkSoft, border: `1px solid ${t.border}` }}>
        {checked ? <><BadgeCheck size={14} /> Verified genuine</> : verifying ? <><RefreshCw size={13} className="animate-spin" /> Checking…</> : <><ShieldCheck size={14} /> Verify this receipt</>}
      </button>
      <p className="text-[10.5px] mt-2 leading-snug" style={{ color: t.inkFaint }}>Anyone can check this code against MitaPesa's verification service to confirm a receipt is genuine — helping prevent fraudulent receipts.</p>
    </div>
  );
}

function PaySuccess({ t, icon: Icon = Check, title, amount, sublabel, extra, shareText, receiptId, verifyCode, onDone }) {
  const shareOnWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText || `${title} — ${sublabel || ""}`)}`, "_blank");
  return (
    <div className="flex flex-col items-center text-center py-3">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: t.accentSoft }}><Icon size={28} color={t.good} /></div>
      <p className="text-[15px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{title}</p>
      {amount != null && <p className="text-[26px] font-bold mt-2" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(-Math.abs(amount))}</p>}
      {sublabel && <p className="text-[13px] mt-1" style={{ color: t.inkFaint }}>{sublabel}</p>}
      {extra}
      {receiptId && <ReceiptBlock t={t} receiptId={receiptId} verifyCode={verifyCode} />}
      <button onClick={shareOnWhatsApp} className="w-full py-3 rounded-full font-semibold text-[14px] mt-3 flex items-center justify-center gap-2" style={{ background: "#25D366", color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}><MessageCircle size={17} /> Share receipt on WhatsApp</button>
      <button onClick={onDone} className="w-full py-3 rounded-full font-semibold text-[14px] mt-2.5" style={{ background: t.ink, color: t.bg, fontFamily: "'Space Grotesk', sans-serif" }}>Done</button>
    </div>
  );
}

function CardSuccess({ t, icon: Icon = Check, title, amountLabel, amountColor, sublabel, showShare, shareText, extra, onDone }) {
  const shareOnWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(shareText || title)}`, "_blank");
  return (
    <div className="flex flex-col items-center text-center py-3">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: t.accentSoft }}><Icon size={28} color={t.good} /></div>
      <p className="text-[15px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{title}</p>
      <p className="text-[26px] font-bold mt-2" style={{ color: amountColor || t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{amountLabel}</p>
      {sublabel && <p className="text-[13px] mt-1" style={{ color: t.inkFaint }}>{sublabel}</p>}
      {extra}
      {showShare && <button onClick={shareOnWhatsApp} className="w-full py-3 rounded-full font-semibold text-[14px] mt-4 flex items-center justify-center gap-2" style={{ background: "#25D366", color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}><MessageCircle size={17} /> Share on WhatsApp</button>}
      <button onClick={onDone} className="w-full py-3 rounded-full font-semibold text-[14px] mt-2.5" style={{ background: t.ink, color: t.bg, fontFamily: "'Space Grotesk', sans-serif" }}>Done</button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  TRANSACTION ROW                                                        */
/* ---------------------------------------------------------------------- */

function TxRow({ t, tx, categories, showLogger }) {
  const positive = tx.amount > 0;
  const color = colorFor(categories, tx.category);
  return (
    <div className="flex items-center gap-3 py-3 px-1 border-b last:border-0" style={{ borderColor: t.border }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}22` }}><CategoryDot color={color} size={10} /></div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold truncate" style={{ color: t.ink, fontFamily: "'Inter', sans-serif" }}>{tx.merchant}</p>
        <p className="text-[12px]" style={{ color: t.inkFaint }}>{tx.category}{tx.subcategory ? ` › ${tx.subcategory}` : ""} · {new Date(tx.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{showLogger && tx.loggedBy ? ` · logged by ${tx.loggedBy}` : ""}</p>
      </div>
      <span className="text-[14px] font-bold shrink-0" style={{ color: positive ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(tx.amount)}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  SWIPEABLE SPENDING GRAPH (bar <-> pie)                                  */
/* ---------------------------------------------------------------------- */

function useWeeklySpend(transactions, wallet = "personal") {
  const personal = transactions.filter((x) => x.wallet === wallet && x.amount < 0);
  return [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString(undefined, { weekday: "short" });
    const total = -personal.filter((x) => x.date === key).reduce((s, x) => s + x.amount, 0);
    return { label, key, total: Math.round(total * 100) / 100 };
  });
}

function useCategorySpend(transactions, categories, wallet = "personal") {
  const tx = transactions.filter((x) => x.wallet === wallet && x.amount < 0);
  const map = {};
  tx.forEach((x) => { map[x.category] = (map[x.category] || 0) + -x.amount; });
  return Object.entries(map).map(([category, total]) => ({ category, total: Math.round(total * 100) / 100, color: colorFor(categories, category) })).sort((a, b) => b.total - a.total);
}

function ChartTooltip({ t, active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-2.5 py-1.5 rounded-lg text-[12px]" style={{ background: t.ink, color: t.bg }}>
      <p className="font-semibold">{payload[0].payload.category || label}</p>
      <p style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(-payload[0].value)}</p>
    </div>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const YEAR_OPTIONS = [2024, 2025, 2026];
// Was hardcoded to a fixed 2026-07 snapshot — meant the app's notion of
// "this month" silently fell further behind reality every day after that
// was written. Computed from the real clock now, same as everywhere else
// "today" is needed in this file.
const TODAY = new Date();
const CURRENT_YEAR = TODAY.getFullYear();
const CURRENT_MONTH_IDX = TODAY.getMonth();
const monthIndex = (year, month) => year * 12 + month;
const MIN_MONTH_INDEX = monthIndex(2024, 0);
const MAX_MONTH_INDEX = monthIndex(CURRENT_YEAR, CURRENT_MONTH_IDX);

function monthKeyOf(year, month) { return `${year}-${String(month + 1).padStart(2, "0")}`; }

// Real historical totals, filtered from the customer's own transaction
// history (already loaded in full — GET /transactions has no date
// filtering applied today, so every past month's real data is already
// available in the `transactions` state; nothing here is fabricated).
function realMonthTotal(transactions, year, month, wallet = "personal") {
  const key = monthKeyOf(year, month);
  return Math.round(-transactions.filter((x) => x.wallet === wallet && x.amount < 0 && x.date?.startsWith(key)).reduce((s, x) => s + x.amount, 0) * 100) / 100;
}

function realCategorySpend(transactions, categories, year, month, wallet = "personal") {
  const key = monthKeyOf(year, month);
  const tx = transactions.filter((x) => x.wallet === wallet && x.amount < 0 && x.date?.startsWith(key));
  const map = {};
  tx.forEach((x) => { map[x.category] = (map[x.category] || 0) + -x.amount; });
  return Object.entries(map).map(([category, total]) => ({ category, total: Math.round(total * 100) / 100, color: colorFor(categories, category) })).sort((a, b) => b.total - a.total);
}

function realCategoryMonthTotal(transactions, year, month, categoryName, wallet = "personal") {
  const key = monthKeyOf(year, month);
  return Math.round(-transactions.filter((x) => x.wallet === wallet && x.amount < 0 && x.category === categoryName && x.date?.startsWith(key)).reduce((s, x) => s + x.amount, 0) * 100) / 100;
}

/* ---- Unified swipeable insights card: weekly trend / monthly category / 3-month compare ---- */

function SpendGraphCard({ t, transactions, categories, wallet = "personal", onViewCategoryPerformance }) {
  const PANEL_COUNT = 5;
  const [mode, setMode] = useState(0); // 0 weekly, 1 category summary, 2 category comparison (h-bar), 3 category trends, 4 three-month compare
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(CURRENT_MONTH_IDX);
  const [cmpPickerOpen, setCmpPickerOpen] = useState(false);
  const [trendRange, setTrendRange] = useState("6");
  const [customFrom, setCustomFrom] = useState({ year: CURRENT_YEAR, month: Math.max(0, CURRENT_MONTH_IDX - 5) });
  const [customTo, setCustomTo] = useState({ year: CURRENT_YEAR, month: CURRENT_MONTH_IDX });
  const dragRef = useRef({ x: 0, active: false });

  const weekly = useWeeklySpend(transactions, wallet);
  const currentReal = useCategorySpend(transactions, categories, wallet);
  const currentTotal = currentReal.reduce((s, c) => s + c.total, 0);

  const isCurrentMonth = year === CURRENT_YEAR && month === CURRENT_MONTH_IDX;
  const monthData = isCurrentMonth ? currentReal : realCategorySpend(transactions, categories, year, month, wallet);
  const monthTotal = monthData.reduce((s, c) => s + c.total, 0);
  const currentMonthKeyForPanel = monthKeyOf(CURRENT_YEAR, CURRENT_MONTH_IDX);
  const currentMonthIncomeForPanel = transactions.filter((x) => x.wallet === wallet && x.amount > 0 && x.date?.startsWith(currentMonthKeyForPanel)).reduce((s, x) => s + x.amount, 0);
  const idx = monthIndex(year, month);

  const stepMonth = (delta) => {
    const next = Math.min(MAX_MONTH_INDEX, Math.max(MIN_MONTH_INDEX, idx + delta));
    setYear(Math.floor(next / 12)); setMonth(next % 12);
  };
  const monthOptions = year === CURRENT_YEAR ? MONTH_NAMES.slice(0, CURRENT_MONTH_IDX + 1) : MONTH_NAMES;

  const last3 = [2, 1, 0].map((back) => {
    const i = MAX_MONTH_INDEX - back;
    const y = Math.floor(i / 12), m = i % 12;
    const total = y === CURRENT_YEAR && m === CURRENT_MONTH_IDX ? currentTotal : realMonthTotal(transactions, y, m, wallet);
    return { label: MONTH_NAMES[m], category: `${MONTH_NAMES[m]} ${y}`, total };
  });
  const compareChange = last3[1].total > 0 ? Math.round(((last3[2].total - last3[1].total) / last3[1].total) * 100) : 0;

  // Trend chart: which months, which categories
  const trendFromIdx = trendRange === "custom" ? monthIndex(customFrom.year, customFrom.month) : Math.max(MIN_MONTH_INDEX, MAX_MONTH_INDEX - (parseInt(trendRange) - 1));
  const trendToIdx = trendRange === "custom" ? monthIndex(customTo.year, customTo.month) : MAX_MONTH_INDEX;
  const trendStart = Math.max(MIN_MONTH_INDEX, Math.min(trendFromIdx, trendToIdx));
  const trendEnd = Math.min(MAX_MONTH_INDEX, Math.max(trendFromIdx, trendToIdx));
  const trendCategories = currentReal.slice(0, 6);
  const trendData = [];
  for (let i = trendStart; i <= trendEnd; i++) {
    const y = Math.floor(i / 12), m = i % 12;
    const row = { label: `${MONTH_NAMES[m]} ${String(y).slice(2)}` };
    trendCategories.forEach((tc) => { row[tc.category] = realCategoryMonthTotal(transactions, y, m, tc.category, wallet); });
    trendData.push(row);
  }

  const cmpHeight = Math.min(180, Math.max(120, monthData.length * 30));

  const onStart = (x) => { dragRef.current = { x, active: true }; };
  const onEnd = (x) => {
    if (!dragRef.current.active) return;
    const delta = x - dragRef.current.x;
    dragRef.current.active = false;
    if (delta < -40) setMode((m) => Math.min(PANEL_COUNT - 1, m + 1));
    else if (delta > 40) setMode((m) => Math.max(0, m - 1));
  };

  const titles = ["Weekly spending", "By category", "Category comparison", "Category trends", "Last 3 months"];
  const toggleIcons = [BarChart2, ListChecks, ChartIcon, TrendingUp, Receipt];

  const MonthNav = ({ open, setOpen }) => (
    <>
      <div className="flex items-center justify-center gap-1 mb-2">
        <button onClick={() => stepMonth(-1)} disabled={idx <= MIN_MONTH_INDEX} className="p-1 rounded-full" style={{ opacity: idx <= MIN_MONTH_INDEX ? 0.3 : 1 }}><ChevronLeft size={15} color={t.inkSoft} /></button>
        <button onClick={() => setOpen((p) => !p)} className="flex items-center gap-1 px-2 py-0.5 rounded-full" style={{ background: open ? t.accentSoft : "transparent" }}>
          <span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{MONTH_NAMES[month]} {year}</span>
          <ChevronDown size={13} color={t.inkFaint} />
        </button>
        <button onClick={() => stepMonth(1)} disabled={idx >= MAX_MONTH_INDEX} className="p-1 rounded-full" style={{ opacity: idx >= MAX_MONTH_INDEX ? 0.3 : 1 }}><ChevronRight size={15} color={t.inkSoft} /></button>
      </div>
      {open && (
        <div className="flex gap-2 mb-2 justify-center">
          <select value={month} onChange={(e) => { const m = parseInt(e.target.value); const capped = Math.min(monthIndex(year, m), MAX_MONTH_INDEX); setMonth(capped % 12); setYear(Math.floor(capped / 12)); }} className="px-2 py-1 rounded-lg text-[12px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>
            {monthOptions.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
          </select>
          <select value={year} onChange={(e) => { const y = parseInt(e.target.value); const cap = Math.min(monthIndex(y, month), MAX_MONTH_INDEX); setYear(Math.floor(cap / 12)); setMonth(cap % 12); }} className="px-2 py-1 rounded-lg text-[12px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      )}
    </>
  );

  return (
    <Card t={t} className="col-span-2 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: t.inkFaint }}>{titles[mode]}</p>
        <div className="flex items-center gap-0.5">
          {toggleIcons.map((Icon, i) => (
            <button key={i} onClick={() => setMode(i)} className="p-1.5 rounded-full" style={{ background: mode === i ? t.accentSoft : "transparent" }}><Icon size={14} color={mode === i ? t.good : t.inkFaint} /></button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden" onTouchStart={(e) => onStart(e.touches[0].clientX)} onTouchEnd={(e) => onEnd(e.changedTouches[0].clientX)} onMouseDown={(e) => onStart(e.clientX)} onMouseUp={(e) => onEnd(e.clientX)}>
        <div className="flex items-start transition-transform duration-300 ease-out" style={{ width: `${PANEL_COUNT * 100}%`, transform: `translateX(-${mode * (100 / PANEL_COUNT)}%)` }}>
          {/* Panel 0: weekly bar */}
          <div style={{ width: `${100 / PANEL_COUNT}%` }}>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={weekly} margin={{ left: -20, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke={t.border} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: t.inkFaint, fontSize: 11 }} axisLine={{ stroke: t.border }} tickLine={false} />
                <YAxis tick={{ fill: t.inkFaint, fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                <Tooltip cursor={{ fill: t.bgSoft }} content={<ChartTooltip t={t} />} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>{weekly.map((d, i) => <Cell key={i} fill={t.accent} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Panel 1: compact category summary — full breakdown now lives on its own page (View category performance), kept brief here specifically so this panel doesn't push the whole widget taller than the others. Deliberately always "this month" (currentReal/currentTotal), not the shared navigable year/month other panels use — this panel has no visible month selector of its own, so silently following navigation happening on another panel would be confusing. */}
          <div style={{ width: `${100 / PANEL_COUNT}%` }} className="px-0.5">
            <div className="flex gap-2 mb-2">
              <div className="flex-1 rounded-[12px] p-2.5" style={{ background: t.cardSoft }}>
                <p className="text-[10px]" style={{ color: t.inkFaint }}>Income</p>
                <p className="text-[13.5px] font-bold mt-0.5" style={{ color: t.good, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(currentMonthIncomeForPanel)}</p>
              </div>
              <div className="flex-1 rounded-[12px] p-2.5" style={{ background: t.cardSoft }}>
                <p className="text-[10px]" style={{ color: t.inkFaint }}>Expenses</p>
                <p className="text-[13.5px] font-bold mt-0.5" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(currentTotal)}</p>
              </div>
            </div>
            <p className="text-[11px] mb-2 px-0.5" style={{ color: t.inkFaint }}>{currentReal[0] ? `${currentReal[0].category} is your biggest category this month.` : "No spending recorded yet this month."}</p>
            {onViewCategoryPerformance && (
              <button onClick={onViewCategoryPerformance} className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[12px] text-[12.5px] font-semibold" style={{ background: t.accentSoft, color: t.accent }}>
                View category performance <ChevronRight size={13} />
              </button>
            )}
          </div>

          {/* Panel 2: category comparison - horizontal (reversed) bar chart, sorted highest to lowest */}
          <div style={{ width: `${100 / PANEL_COUNT}%` }} className="px-0.5">
            <MonthNav open={cmpPickerOpen} setOpen={setCmpPickerOpen} />
            {monthData.length > 0 ? (
              <ResponsiveContainer width="100%" height={cmpHeight}>
                <BarChart data={monthData} layout="vertical" margin={{ left: 4, right: 34, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke={t.border} strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: t.inkFaint, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} />
                  <YAxis type="category" dataKey="category" tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} width={76} />
                  <Tooltip cursor={{ fill: t.bgSoft }} content={<ChartTooltip t={t} />} />
                  <Bar dataKey="total" radius={[0, 6, 6, 0]} barSize={16}>
                    {monthData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    <LabelList dataKey="total" position="right" formatter={(v) => fmt(v)} style={{ fill: t.ink, fontSize: 10.5, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center py-6 text-[11.5px]" style={{ color: t.inkFaint }}>No spending recorded.</p>
            )}
          </div>

          {/* Panel 3: category trends line chart */}
          <div style={{ width: `${100 / PANEL_COUNT}%` }} className="px-0.5">
            <div className="flex gap-1.5 mb-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
              {["3", "6", "12", "custom"].map((r) => (
                <button key={r} onClick={() => setTrendRange(r)} className="px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0" style={{ background: trendRange === r ? t.accent : t.cardSoft, color: trendRange === r ? "#fff" : t.inkSoft, border: `1px solid ${trendRange === r ? t.accent : t.border}` }}>
                  {r === "custom" ? "Custom" : `${r}M`}
                </button>
              ))}
            </div>
            {trendRange === "custom" && (
              <div className="flex items-center gap-1.5 mb-2 text-[11px]" style={{ color: t.inkFaint }}>
                <span>From</span>
                <select value={`${customFrom.year}-${customFrom.month}`} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setCustomFrom({ year: y, month: m }); }} className="px-1.5 py-1 rounded-lg text-[11px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>
                  {YEAR_OPTIONS.flatMap((y) => (y === CURRENT_YEAR ? MONTH_NAMES.slice(0, CURRENT_MONTH_IDX + 1) : MONTH_NAMES).map((mn, mi) => <option key={`${y}-${mi}`} value={`${y}-${mi}`}>{mn} {y}</option>))}
                </select>
                <span>to</span>
                <select value={`${customTo.year}-${customTo.month}`} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setCustomTo({ year: y, month: m }); }} className="px-1.5 py-1 rounded-lg text-[11px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>
                  {YEAR_OPTIONS.flatMap((y) => (y === CURRENT_YEAR ? MONTH_NAMES.slice(0, CURRENT_MONTH_IDX + 1) : MONTH_NAMES).map((mn, mi) => <option key={`${y}-${mi}`} value={`${y}-${mi}`}>{mn} {y}</option>))}
                </select>
              </div>
            )}
            {trendCategories.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={150}>
                  <LineChart data={trendData} margin={{ left: -20, right: 8, top: 4 }}>
                    <CartesianGrid vertical={false} stroke={t.border} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: t.inkFaint, fontSize: 10 }} axisLine={{ stroke: t.border }} tickLine={false} />
                    <YAxis tick={{ fill: t.inkFaint, fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
                    <Tooltip content={<ChartTooltip t={t} />} />
                    {trendCategories.map((tc) => (
                      <Line key={tc.category} type="monotone" dataKey={tc.category} stroke={tc.color} strokeWidth={2.2} dot={{ r: 2.5, fill: tc.color, strokeWidth: 0 }} activeDot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
                  {trendCategories.map((tc) => (
                    <div key={tc.category} className="flex items-center gap-1.5 text-[10.5px]" style={{ color: t.inkSoft }}>
                      <CategoryDot color={tc.color} size={7} /><span>{tc.category}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-center py-6 text-[11.5px]" style={{ color: t.inkFaint }}>No category spending to trend yet.</p>
            )}
          </div>

          {/* Panel 4: three-month comparison */}
          <div style={{ width: `${100 / PANEL_COUNT}%` }}>
            <div className="flex items-center justify-end mb-1.5">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ color: compareChange <= 0 ? t.good : t.danger, background: compareChange <= 0 ? t.accentSoft : t.dangerSoft }}>{compareChange >= 0 ? "+" : ""}{compareChange}% vs prior</span>
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={last3} margin={{ left: -20, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke={t.border} strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fill: t.inkFaint, fontSize: 11 }} axisLine={{ stroke: t.border }} tickLine={false} />
                <YAxis tick={{ fill: t.inkFaint, fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
                <Tooltip cursor={{ fill: t.bgSoft }} content={<ChartTooltip t={t} />} />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>{last3.map((d, i) => <Cell key={i} fill={i === last3.length - 1 ? t.accent : t.gold} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-1.5 mt-3">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: mode === i ? 16 : 6, background: mode === i ? t.accent : t.border }} />)}
      </div>
      <p className="text-center text-[10.5px] mt-1" style={{ color: t.inkFaint }}>Swipe to explore weekly, monthly, comparison, trend, and 3-month views</p>
    </Card>
  );
}


/* ---------------------------------------------------------------------- */
/*  CATEGORY PICKER (with inline "add new")                                 */
/* ---------------------------------------------------------------------- */

function CategoryPicker({ t, categories, value, onChange, onAddCategory }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const confirmAdd = () => { const created = onAddCategory(name); if (created) { onChange(created); setName(""); setAdding(false); } };

  if (adding) {
    return (
      <div className="flex gap-2">
        <input autoFocus style={inputStyle(t)} placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={confirmAdd} className="px-3.5 rounded-[13px] font-semibold text-[13px] shrink-0" style={{ background: t.accent, color: "#fff" }}>Add</button>
        <button onClick={() => { setAdding(false); setName(""); }} className="px-3 rounded-[13px] shrink-0" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><X size={14} color={t.inkFaint} /></button>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <select style={inputStyle(t)} value={value} onChange={(e) => onChange(e.target.value)}>{categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
      <button onClick={() => setAdding(true)} className="px-3.5 rounded-[13px] text-[13px] font-semibold shrink-0 flex items-center gap-1" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.accent }}><Plus size={14} /> New</button>
    </div>
  );
}

function SubcategoryPicker({ t, categories, mainCategory, value, onChange, onAddSubcategory }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const subs = categories.find((c) => c.name === mainCategory)?.subcategories || [];

  const confirmAdd = () => { const created = onAddSubcategory(mainCategory, name); if (created) { onChange(created); setName(""); setAdding(false); } };

  if (adding) {
    return (
      <div className="flex gap-2">
        <input autoFocus style={inputStyle(t)} placeholder="New subcategory name" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={confirmAdd} className="px-3.5 rounded-[13px] font-semibold text-[13px] shrink-0" style={{ background: t.accent, color: "#fff" }}>Add</button>
        <button onClick={() => { setAdding(false); setName(""); }} className="px-3 rounded-[13px] shrink-0" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><X size={14} color={t.inkFaint} /></button>
      </div>
    );
  }
  if (subs.length === 0) {
    return <button onClick={() => setAdding(true)} className="w-full py-2.5 rounded-[13px] text-[13px] font-semibold flex items-center justify-center gap-1" style={{ background: t.cardSoft, border: `1px dashed ${t.border}`, color: t.accent }}><Plus size={14} /> Add a subcategory</button>;
  }
  return (
    <div className="flex gap-2">
      <select style={inputStyle(t)} value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {subs.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
      </select>
      <button onClick={() => setAdding(true)} className="px-3.5 rounded-[13px] text-[13px] font-semibold shrink-0 flex items-center gap-1" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.accent }}><Plus size={14} /> New</button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  ADD TRANSACTION SHEET                                                   */
/* ---------------------------------------------------------------------- */

function PhotoPicker({ t, photo, setPhoto, label }) {
  const fileRef = useRef(null);
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <Field t={t} label={label}>
      {photo ? (
        <div className="relative w-24 h-24 rounded-[14px] overflow-hidden" style={{ border: `1px solid ${t.border}` }}>
          <img src={photo} alt="receipt" className="w-full h-full object-cover" />
          <button onClick={() => setPhoto(null)} className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}><X size={13} color="#fff" /></button>
        </div>
      ) : (
        <button onClick={() => fileRef.current?.click()} className="w-full py-3 rounded-[13px] flex items-center justify-center gap-2 text-[13px] font-semibold" style={{ background: t.cardSoft, border: `1px dashed ${t.border}`, color: t.inkSoft }}>
          <Camera size={16} /> Take or add a photo
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
    </Field>
  );
}

function AddTxSheet({ t, open, onClose, onAdd, wallet, loggedByOptions, categories, onAddCategory, onAddSubcategory }) {
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState(categories.find((c) => c.name !== "Income")?.name || categories[0]?.name || "Food & Dining");
  const [subcategory, setSubcategory] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [type, setType] = useState("expense");
  const [loggedBy, setLoggedBy] = useState(loggedByOptions?.[0] || "You");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);

  const changeCategory = (name) => { setCategory(name); setSubcategory(""); };

  // Income isn't just a negative-sign version of an expense — it doesn't
  // have a "merchant" or a spending category, it has a source (an
  // employer, a client) and a type (salary, commission, etc). Switching
  // type swaps the whole field set rather than reusing expense's fields
  // with different labels, and resets subcategory since "Groceries"
  // isn't a meaningful income type and vice versa.
  const changeType = (k) => {
    setType(k);
    setSubcategory("");
    if (k === "income") setCategory("Income");
    else setCategory(categories.find((c) => c.name !== "Income")?.name || categories[0]?.name || "Food & Dining");
  };

  const valid = amount && merchant && (type === "expense" || subcategory);

  const submit = () => {
    if (!valid) return;
    const val = Math.abs(parseFloat(amount)) || 0;
    onAdd({ id: uid(), amount: type === "expense" ? -val : val, merchant, category, subcategory: subcategory || null, date, wallet, loggedBy, note: note.trim() || null, photo });
    setAmount(""); setMerchant(""); setNote(""); setPhoto(null); setSubcategory(""); onClose();
  };

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Add transaction">
      <div className="flex gap-2 mb-4">
        {["expense", "income"].map((k) => (
          <button key={k} onClick={() => changeType(k)} className="flex-1 py-2 rounded-full text-[13px] font-semibold capitalize" style={{ background: type === k ? (k === "expense" ? t.dangerSoft : t.accentSoft) : t.cardSoft, color: type === k ? (k === "expense" ? t.danger : t.good) : t.inkFaint, border: `1px solid ${t.border}` }}>{k}</button>
        ))}
      </div>
      <Field t={t} label="Amount (TZS)">
        <input style={inputStyle(t)} type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <CurrencyEquivalentHint t={t} amountTZS={amount} />
      </Field>
      {type === "expense" ? (
        <>
          <Field t={t} label="Merchant"><input style={inputStyle(t)} placeholder="e.g. Green Leaf Grocer" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>
          <Field t={t} label="Category"><CategoryPicker t={t} categories={categories.filter((c) => c.name !== "Income")} value={category} onChange={changeCategory} onAddCategory={onAddCategory} /></Field>
          <Field t={t} label="Subcategory (optional)"><SubcategoryPicker t={t} categories={categories} mainCategory={category} value={subcategory} onChange={setSubcategory} onAddSubcategory={onAddSubcategory} /></Field>
        </>
      ) : (
        <>
          <Field t={t} label="Source"><input style={inputStyle(t)} placeholder="e.g. Acme Corp, Client name" value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>
          <Field t={t} label="Income type"><SubcategoryPicker t={t} categories={categories} mainCategory="Income" value={subcategory} onChange={setSubcategory} onAddSubcategory={onAddSubcategory} /></Field>
        </>
      )}
      <Field t={t} label="Date"><input style={inputStyle(t)} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field t={t} label="Description (optional)"><textarea rows={2} style={{ ...inputStyle(t), resize: "none" }} placeholder="What was this for?" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <PhotoPicker t={t} photo={photo} setPhoto={setPhoto} label="Receipt photo (optional)" />
      {loggedByOptions && <Field t={t} label="Logged by"><select style={inputStyle(t)} value={loggedBy} onChange={(e) => setLoggedBy(e.target.value)}>{loggedByOptions.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>}
      <PrimaryButton t={t} onClick={submit} disabled={!valid}>Save transaction</PrimaryButton>
    </BottomSheet>
  );
}

// Resizes/re-encodes a captured photo before upload — receipts don't need
// full camera resolution for OCR to work, and this keeps the upload
// comfortably under the API's body-size limit regardless of the source
// photo's resolution, while also reducing provider cost/latency.
// Resizes/re-encodes a captured photo before upload — receipts don't need
// full camera resolution for OCR to work, and this keeps the upload
// comfortably under the API's body-size limit regardless of the source
// photo's resolution, while also reducing provider cost/latency.
//
// Deliberately takes the File object directly and loads it via
// URL.createObjectURL, NOT a base64 data URL — loading a full-resolution
// phone photo (often 12+ megapixels) as a giant base64 string into an
// <img src="data:..."> is a well-documented source of silent hangs/
// crashes on mobile Safari specifically, due to the memory pressure of
// holding both the base64 string and the decoded bitmap at once. A blob
// URL avoids that entirely — the browser streams from the file, never
// materializing a giant base64 string for the full-resolution original.
function resizeImageForOcr(file, maxDimension = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    // A hard timeout so this can never leave the UI silently stuck again,
    // regardless of the exact underlying cause — the "capture" screen
    // should always eventually show either a result or a clear failure.
    const timeoutId = setTimeout(() => { cleanup(); reject(new Error("That took too long to process — please try again.")); }, 20000);

    const img = new window.Image();
    img.onload = () => {
      clearTimeout(timeoutId);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      cleanup();
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { clearTimeout(timeoutId); cleanup(); reject(new Error("Couldn't process that image — please try a different photo.")); };
    img.src = objectUrl;
  });
}

function ScanReceiptSheet({ t, open, onClose, onAdd, onUpdate, categories, tr }) {
  const [phase, setPhase] = useState("capture"); // capture -> scanning -> result -> unavailable -> failed
  const [photo, setPhoto] = useState(null);
  const [txId, setTxId] = useState(null);
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [confidence, setConfidence] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const fileRef = useRef(null);

  const reset = () => { setPhase("capture"); setPhoto(null); setTxId(null); setAmount(""); setMerchant(""); setCategory(""); setConfidence(null); setErrorMsg(""); };

  const startScan = async (file) => {
    setPhase("scanning");
    try {
      const resized = await resizeImageForOcr(file);
      setPhoto(resized); // the resized (not full-resolution) version is plenty for a receipt thumbnail
      const base64 = resized.split(",")[1];
      const result = await api.receipts.scan(base64, "image/jpeg");

      const cat = result.category || categories[0]?.name || "Other";
      const amt = result.amount !== null ? String(result.amount) : "";
      const merch = result.merchant || "";
      const id = uid();
      setMerchant(merch); setAmount(amt); setCategory(cat); setConfidence(result.confidence); setTxId(id);
      onAdd({
        id, amount: result.amount !== null ? -Math.abs(result.amount) : 0, merchant: merch || "Receipt", category: cat,
        date: result.date || new Date().toISOString().slice(0, 10), wallet: "personal", loggedBy: "You", note: "Scanned from receipt", photo: resized,
      });
      setPhase("result");
    } catch (err) {
      if (err.status === 403 || /turned off/i.test(err.message || "")) {
        setPhase("unavailable");
      } else {
        setErrorMsg(err.message || "We couldn't read this receipt.");
        setPhase("failed");
      }
    }
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    startScan(file);
    e.target.value = "";
  };

  const editField = (field, value) => {
    if (field === "amount") { setAmount(value); onUpdate(txId, { amount: -Math.abs(parseFloat(value) || 0) }); }
    if (field === "merchant") { setMerchant(value); onUpdate(txId, { merchant: value }); }
    if (field === "category") { setCategory(value); onUpdate(txId, { category: value }); }
  };

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title={tr("scanReceipt")}>
      {phase === "capture" && (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: t.accentSoft }}><Camera size={32} color={t.good} /></div>
          <p className="text-[13.5px] leading-relaxed mb-6" style={{ color: t.inkFaint }}>{tr("scanIntro")}</p>
          <PrimaryButton t={t} onClick={() => fileRef.current?.click()}><Camera size={16} /> {tr("takePhoto")}</PrimaryButton>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
        </div>
      )}

      {phase === "scanning" && (
        <div className="flex flex-col items-center py-2 text-center">
          <div className="relative w-full h-52 rounded-[18px] overflow-hidden mb-4" style={{ border: `1px solid ${t.border}` }}>
            <img src={photo} alt="receipt" className="w-full h-full object-cover" style={{ filter: "brightness(0.65)" }} />
            <div className="absolute inset-x-0" style={{ height: 3, background: t.accent, boxShadow: `0 0 12px 2px ${t.accent}`, animation: "scanline 1.6s ease-in-out infinite" }} />
          </div>
          <div className="flex items-center gap-2"><RefreshCw size={16} className="animate-spin" color={t.accent} /><span className="text-[13.5px] font-medium" style={{ color: t.inkSoft }}>{tr("readingReceipt")}</span></div>
        </div>
      )}

      {phase === "unavailable" && (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: t.cardSoft }}><Camera size={26} color={t.inkFaint} /></div>
          <p className="text-[13.5px] font-semibold mb-1.5" style={{ color: t.ink }}>Receipt scanning is currently unavailable</p>
          <p className="text-[12.5px] mb-6" style={{ color: t.inkFaint }}>Please add this expense manually from the Home page instead.</p>
          <button onClick={() => { onClose(); reset(); }} className="text-[13px] font-semibold" style={{ color: t.accent }}>Close</button>
        </div>
      )}

      {phase === "failed" && (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: t.dangerSoft }}><AlertTriangle size={26} color={t.danger} /></div>
          <p className="text-[13.5px] font-semibold mb-1.5" style={{ color: t.ink }}>Couldn't read this receipt</p>
          <p className="text-[12.5px] mb-6" style={{ color: t.inkFaint }}>{errorMsg}</p>
          <div className="flex gap-3">
            <button onClick={reset} className="text-[13px] font-semibold" style={{ color: t.accent }}>Try again</button>
            <button onClick={() => { onClose(); reset(); }} className="text-[13px] font-semibold" style={{ color: t.inkFaint }}>Add manually instead</button>
          </div>
        </div>
      )}

      {phase === "result" && (
        <div>
          <div className="flex items-center gap-2.5 mb-4 p-3 rounded-[14px]" style={{ background: t.accentSoft }}>
            <BadgeCheck size={20} color={t.good} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: t.ink }}>{tr("savedToLedger")}</p>
              <p className="text-[11px]" style={{ color: t.inkFaint }}>{confidence !== null ? `${confidence}% ${tr("confidenceNote")}` : "Please double-check these details."}</p>
            </div>
          </div>
          {(!merchant || !amount) && (
            <p className="text-[11.5px] mb-3" style={{ color: t.gold }}>Some details weren't fully legible — please fill in or correct anything missing below.</p>
          )}
          <div className="flex gap-3 mb-4">
            {photo && <img src={photo} alt="receipt" className="w-16 h-16 rounded-[12px] object-cover shrink-0" style={{ border: `1px solid ${t.border}` }} />}
            <div className="flex-1 space-y-2 min-w-0">
              <input value={merchant} onChange={(e) => editField("merchant", e.target.value)} placeholder="Merchant name" style={inputStyle(t)} />
              <div className="flex gap-2">
                <input type="number" value={amount} onChange={(e) => editField("amount", e.target.value)} placeholder="Amount" style={inputStyle(t)} />
                <select value={category} onChange={(e) => editField("category", e.target.value)} style={inputStyle(t)}>{categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
              </div>
            </div>
          </div>
          <PrimaryButton t={t} onClick={() => { onClose(); reset(); }}>Done</PrimaryButton>
        </div>
      )}
    </BottomSheet>
  );
}

/* ---------------------------------------------------------------------- */
/*  ONBOARDING: SLIDES -> PHONE -> OTP -> PROFILE                           */
/* ---------------------------------------------------------------------- */

const ONBOARDING_SLIDES = [
  { icon: MitaPesaMark, title: "Welcome to MitaPesa", body: "Every shilling, tracked and understood — balances, budgets and bills in one clean view." },
  { icon: ChartIcon, title: "See where it goes", body: "Swipeable graphs break spending down by week or by category, so patterns jump out at you." },
  { icon: QrCode, title: "Pay anyone, anywhere", body: "Scan a QR code, key in a TIPS number, or settle GePG and LUKU bills straight from your card." },
  { icon: Users, title: "Share when you want to", body: "Flip on the Shared Wallet to track household spending together with family — fully optional." },
];

function OnboardingSlides({ t, onDone, onSkip, onLogin }) {
  const [step, setStep] = useState(0);
  const last = step === ONBOARDING_SLIDES.length - 1;
  const slide = ONBOARDING_SLIDES[step];
  const Icon = slide.icon;
  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2"><MitaPesaMark size={32} /><span className="text-[14px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>MitaPesa</span></div>
        {!last && <button onClick={onSkip} className="text-[13px] font-medium" style={{ color: t.inkFaint }}>Skip</button>}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className="w-28 h-28 rounded-[32px] flex items-center justify-center mb-8" style={{ background: Icon === MitaPesaMark ? t.cardSoft : `linear-gradient(135deg, ${t.accent}, ${t.good})` }}>{Icon === MitaPesaMark ? <Icon size={56} /> : <Icon size={48} color="#fff" strokeWidth={1.6} />}</div>
        <h1 className="text-[24px] font-bold mb-3 leading-tight" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{slide.title}</h1>
        <p className="text-[14.5px] leading-relaxed max-w-[300px]" style={{ color: t.inkSoft }}>{slide.body}</p>
      </div>
      <div className="flex items-center justify-center gap-2 mb-7">{ONBOARDING_SLIDES.map((_, i) => <span key={i} className="h-1.5 rounded-full transition-all" style={{ width: i === step ? 22 : 7, background: i === step ? t.accent : t.border }} />)}</div>
      <div className="flex gap-3">
        {step > 0 && <button onClick={() => setStep((s) => s - 1)} className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ChevronLeft size={18} color={t.inkSoft} /></button>}
        <button onClick={() => (last ? onDone() : setStep((s) => s + 1))} className="flex-1 py-3.5 rounded-full font-semibold text-[15px] flex items-center justify-center gap-2" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>{last ? "Get started" : "Continue"} <ChevronRight size={17} /></button>
      </div>
      <button onClick={onLogin} className="text-center text-[13px] font-semibold mt-4" style={{ color: t.accent }}>Already have an account? Log in</button>
    </div>
  );
}

function PhoneStage({ t, onBack, onSent, phone, setPhone }) {
  const valid = phone.length >= 8;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const sendCode = async () => {
    if (!valid) return;
    setSending(true); setError("");
    try {
      await api.auth.sendPhoneOtp(phone);
      onSent();
    } catch (err) {
      setError(err.message || "Couldn't send the code. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.accentSoft }}><Phone size={24} color={t.good} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>What's your number?</h1>
      <p className="text-[13.5px] mb-6" style={{ color: t.inkFaint }}>We'll text you a one-time code to verify it's really you.</p>
      <label className="block text-[12px] font-medium mb-1.5" style={{ color: t.inkFaint }}>Mobile number</label>
      <div className="flex gap-2 mb-2">
        <div className="px-3.5 flex items-center justify-center rounded-[13px] text-[14px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>+255</div>
        <input style={{ ...inputStyle(t), flex: 1 }} type="tel" inputMode="numeric" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))} />
      </div>
      {error && <p className="text-[12.5px] mb-2" style={{ color: t.danger }}>{error}</p>}
      <div className="flex-1" />
      <button onClick={sendCode} disabled={!valid || sending} className="w-full py-3.5 rounded-full font-semibold text-[15px]" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: valid && !sending ? 1 : 0.5 }}>{sending ? "Sending…" : "Send code"}</button>
    </div>
  );
}

function OtpStage({ t, onBack, onVerified, phone }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [timer, setTimer] = useState(30);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const refs = useRef([]);

  useEffect(() => { if (timer <= 0) return; const id = setTimeout(() => setTimer((s) => s - 1), 1000); return () => clearTimeout(id); }, [timer]);

  const setDigit = (i, val) => {
    if (!/^[0-9]?$/.test(val)) return;
    const next = [...digits]; next[i] = val; setDigits(next);
    if (val && i < 5) refs.current[i + 1]?.focus();
  };
  const handleKeyDown = (i, e) => { if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus(); };
  const code = digits.join("");
  const complete = code.length === 6;

  const verify = async () => {
    setVerifying(true); setError("");
    try {
      const { verified, verifyToken } = await api.auth.verifyPhoneOtp(phone, code);
      if (verified) onVerified(verifyToken);
      else setError("That code didn't match. Check and try again.");
    } catch (err) {
      setError(err.message || "Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    setResending(true); setError(""); setDigits(["", "", "", "", "", ""]);
    try {
      await api.auth.sendPhoneOtp(phone);
      setTimer(30);
    } catch (err) {
      setError(err.message || "Couldn't resend the code.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.accentSoft }}><KeyRound size={24} color={t.good} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Enter the code</h1>
      <p className="text-[13.5px] mb-7" style={{ color: t.inkFaint }}>We sent a 6-digit code to <span style={{ color: t.ink, fontWeight: 600 }}>+255 {phone}</span></p>
      <div className="flex gap-2 justify-between mb-5">
        {digits.map((d, i) => (
          <input key={i} ref={(el) => (refs.current[i] = el)} value={d} onChange={(e) => setDigit(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} inputMode="numeric" maxLength={1} className="w-11 text-center text-[20px] font-bold rounded-[13px]" style={{ height: 52, background: t.cardSoft, border: `1.5px solid ${d ? t.accent : t.border}`, color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }} />
        ))}
      </div>
      <button onClick={resend} disabled={timer > 0 || resending} className="text-[13px] font-medium text-left" style={{ color: timer > 0 ? t.inkFaint : t.accent }}>{timer > 0 ? `Resend code in ${timer}s` : resending ? "Resending…" : "Resend code"}</button>
      {error && <p className="text-[12.5px] mt-2" style={{ color: t.danger }}>{error}</p>}
      <div className="flex-1" />
      <button onClick={verify} disabled={!complete || verifying} className="w-full py-3.5 rounded-full font-semibold text-[15px] flex items-center justify-center gap-2" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: complete ? 1 : 0.5 }}>
        {verifying ? <><RefreshCw size={16} className="animate-spin" /> Verifying…</> : "Verify & continue"}
      </button>
    </div>
  );
}

function EmailStage({ t, onBack, onSent, email, setEmail }) {
  const valid = /^\S+@\S+\.\S+$/.test(email);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const sendCode = async () => {
    if (!valid) return;
    setSending(true); setError("");
    try {
      await api.auth.sendEmailOtp(email);
      onSent();
    } catch (err) {
      setError(err.message || "Couldn't send the code. Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.accentSoft }}><AtSign size={24} color={t.good} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>What's your email?</h1>
      <p className="text-[13.5px] mb-6" style={{ color: t.inkFaint }}>We'll email you a one-time code to verify it's really you.</p>
      <label className="block text-[12px] font-medium mb-1.5" style={{ color: t.inkFaint }}>Email address</label>
      <div className="relative mb-2">
        <AtSign size={15} color={t.inkFaint} style={{ position: "absolute", left: 13, top: 13.5 }} />
        <input style={{ ...inputStyle(t), paddingLeft: 34 }} type="email" placeholder="amara@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p className="text-[12.5px] mb-2" style={{ color: t.danger }}>{error}</p>}
      <div className="flex-1" />
      <button onClick={sendCode} disabled={!valid || sending} className="w-full py-3.5 rounded-full font-semibold text-[15px]" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: valid && !sending ? 1 : 0.5 }}>{sending ? "Sending…" : "Send code"}</button>
    </div>
  );
}

function OtpEmailStage({ t, onBack, onVerified, email }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [timer, setTimer] = useState(30);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const refs = useRef([]);

  useEffect(() => { if (timer <= 0) return; const id = setTimeout(() => setTimer((s) => s - 1), 1000); return () => clearTimeout(id); }, [timer]);

  const setDigit = (i, val) => {
    if (!/^[0-9]?$/.test(val)) return;
    const next = [...digits]; next[i] = val; setDigits(next);
    if (val && i < 5) refs.current[i + 1]?.focus();
  };
  const handleKeyDown = (i, e) => { if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus(); };
  const code = digits.join("");
  const complete = code.length === 6;

  const verify = async () => {
    setVerifying(true); setError("");
    try {
      const { verified, verifyToken } = await api.auth.verifyEmailOtp(email, code);
      if (verified) onVerified(verifyToken);
      else setError("That code didn't match. Check and try again.");
    } catch (err) {
      setError(err.message || "Verification failed. Please try again.");
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    setResending(true); setError(""); setDigits(["", "", "", "", "", ""]);
    try {
      await api.auth.sendEmailOtp(email);
      setTimer(30);
    } catch (err) {
      setError(err.message || "Couldn't resend the code.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.accentSoft }}><KeyRound size={24} color={t.good} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Enter the code</h1>
      <p className="text-[13.5px] mb-7" style={{ color: t.inkFaint }}>We sent a 6-digit code to <span style={{ color: t.ink, fontWeight: 600 }}>{email}</span>. It may take a minute to arrive — check your spam folder if you don't see it.</p>
      <div className="flex gap-2 justify-between mb-5">
        {digits.map((d, i) => (
          <input key={i} ref={(el) => (refs.current[i] = el)} value={d} onChange={(e) => setDigit(i, e.target.value)} onKeyDown={(e) => handleKeyDown(i, e)} inputMode="numeric" maxLength={1} className="w-11 text-center text-[20px] font-bold rounded-[13px]" style={{ height: 52, background: t.cardSoft, border: `1.5px solid ${d ? t.accent : t.border}`, color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }} />
        ))}
      </div>
      <button onClick={resend} disabled={timer > 0 || resending} className="text-[13px] font-medium text-left" style={{ color: timer > 0 ? t.inkFaint : t.accent }}>{timer > 0 ? `Resend code in ${timer}s` : resending ? "Resending…" : "Resend code"}</button>
      {error && <p className="text-[12.5px] mt-2" style={{ color: t.danger }}>{error}</p>}
      <div className="flex-1" />
      <button onClick={verify} disabled={!complete || verifying} className="w-full py-3.5 rounded-full font-semibold text-[15px] flex items-center justify-center gap-2" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: complete ? 1 : 0.5 }}>
        {verifying ? <><RefreshCw size={16} className="animate-spin" /> Verifying…</> : "Verify & continue"}
      </button>
    </div>
  );
}

function ProfileStage({ t, onBack, onDone, submitting, error, prefilledEmail, needsPhone }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(prefilledEmail || "");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const emailValid = /^\S+@\S+\.\S+$/.test(email);
  const phoneValid = !needsPhone || phone.length >= 8;
  const valid = firstName.trim().length > 1 && lastName.trim().length > 1 && emailValid && phoneValid && password.length >= 8;

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.accentSoft }}><User size={24} color={t.good} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Tell us about you</h1>
      <p className="text-[13.5px] mb-6" style={{ color: t.inkFaint }}>This is how you'll appear on your card and receipts.</p>

      <Field t={t} label="First name"><input style={inputStyle(t)} placeholder="Amara" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
      <Field t={t} label="Last name"><input style={inputStyle(t)} placeholder="Ngowi" value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
      <Field t={t} label="Email address">
        <div className="relative">
          <AtSign size={15} color={t.inkFaint} style={{ position: "absolute", left: 13, top: 13.5 }} />
          <input style={{ ...inputStyle(t), paddingLeft: 34, opacity: prefilledEmail ? 0.65 : 1 }} type="email" placeholder="amara@email.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!!prefilledEmail} />
        </div>
        {prefilledEmail && <p className="text-[11px] mt-1" style={{ color: t.inkFaint }}>Already verified — can't be changed here.</p>}
      </Field>
      {needsPhone && (
        <Field t={t} label="Phone number">
          <div className="flex gap-2">
            <div className="px-3.5 flex items-center justify-center rounded-[13px] text-[14px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>+255</div>
            <input style={{ ...inputStyle(t), flex: 1 }} type="tel" inputMode="numeric" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))} />
          </div>
        </Field>
      )}
      <Field t={t} label="Password">
        <input style={inputStyle(t)} type="password" placeholder="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p className="text-[12.5px] mb-2" style={{ color: t.danger }}>{error}</p>}

      <div className="flex-1" />
      <button onClick={() => valid && onDone({ firstName, lastName, email, password, ...(needsPhone ? { phone } : {}) })} disabled={!valid || submitting} className="w-full py-3.5 rounded-full font-semibold text-[15px]" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: valid && !submitting ? 1 : 0.5 }}>
        {submitting ? "Setting up your account…" : "Finish setup"}
      </button>
    </div>
  );
}

function LoginStage({ t, onBack, onDone, onForgotPassword, submitting, error, onBiometricLogin, biometricSubmitting, biometricError }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email) && password.length > 0;
  const emailValid = /^\S+@\S+\.\S+$/.test(email);

  useEffect(() => {
    if (!api.webauthn.isSupported()) return;
    api.settingsPublic()
      .then((s) => setBiometricAvailable(s.biometric_login_enabled !== "false"))
      .catch(() => setBiometricAvailable(false));
  }, []);

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.accentSoft }}><ShieldCheck size={24} color={t.good} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Welcome back</h1>
      <p className="text-[13.5px] mb-6" style={{ color: t.inkFaint }}>Log in with your email and password.</p>

      <Field t={t} label="Email address">
        <div className="relative">
          <AtSign size={15} color={t.inkFaint} style={{ position: "absolute", left: 13, top: 13.5 }} />
          <input style={{ ...inputStyle(t), paddingLeft: 34 }} type="email" placeholder="amara@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </Field>
      <Field t={t} label="Password">
        <input style={inputStyle(t)} type="password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button onClick={onForgotPassword} className="text-[12.5px] font-semibold self-start mb-2" style={{ color: t.accent }}>Forgot password?</button>
      {error && <p className="text-[12.5px] mb-2" style={{ color: t.danger }}>{error}</p>}
      {biometricError && <p className="text-[12.5px] mb-2" style={{ color: t.danger }}>{biometricError}</p>}

      <div className="flex-1" />
      {biometricAvailable && (
        <button
          onClick={() => emailValid && onBiometricLogin(email)} disabled={!emailValid || biometricSubmitting}
          className="w-full py-3.5 rounded-full font-semibold text-[15px] mb-3 flex items-center justify-center gap-2"
          style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink, opacity: emailValid && !biometricSubmitting ? 1 : 0.5 }}
        >
          <Fingerprint size={17} color={t.accent} /> {biometricSubmitting ? "Checking…" : "Sign in with Face ID / fingerprint"}
        </button>
      )}
      <button onClick={() => valid && onDone({ email, password })} disabled={!valid || submitting} className="w-full py-3.5 rounded-full font-semibold text-[15px]" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: valid && !submitting ? 1 : 0.5 }}>
        {submitting ? "Logging in…" : "Log in"}
      </button>
    </div>
  );
}

function ForgotPasswordStage({ t, onBack, onSent, submitting, error, message }) {
  const [email, setEmail] = useState("");
  const valid = /^\S+@\S+\.\S+$/.test(email);

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.goldSoft }}><Fingerprint size={24} color={t.gold} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Reset your password</h1>
      <p className="text-[13.5px] mb-6" style={{ color: t.inkFaint }}>Enter the email on your account and we'll send you a reset code.</p>

      <Field t={t} label="Email address">
        <div className="relative">
          <AtSign size={15} color={t.inkFaint} style={{ position: "absolute", left: 13, top: 13.5 }} />
          <input style={{ ...inputStyle(t), paddingLeft: 34 }} type="email" placeholder="amara@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </Field>
      {message && <p className="text-[12.5px] mb-2" style={{ color: t.good }}>{message}</p>}
      {error && <p className="text-[12.5px] mb-2" style={{ color: t.danger }}>{error}</p>}

      <div className="flex-1" />
      <button onClick={() => valid && onSent(email)} disabled={!valid || submitting} className="w-full py-3.5 rounded-full font-semibold text-[15px]" style={{ background: t.gold, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: valid && !submitting ? 1 : 0.5 }}>
        {submitting ? "Sending…" : "Send reset code"}
      </button>
    </div>
  );
}

function ResetPasswordStage({ t, onBack, onDone, submitting, error, message }) {
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const valid = token.trim().length > 10 && newPassword.length >= 8;

  return (
    <div className="flex flex-col h-screen px-6 overflow-hidden" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))", paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}>
      <button onClick={onBack} className="w-9 h-9 rounded-full flex items-center justify-center mb-6" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><ArrowLeft size={16} color={t.inkSoft} /></button>
      <div className="w-14 h-14 rounded-[18px] flex items-center justify-center mb-5" style={{ background: t.goldSoft }}><ShieldCheck size={24} color={t.gold} /></div>
      <h1 className="text-[22px] font-bold mb-2" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Enter your reset code</h1>
      <p className="text-[13.5px] mb-6" style={{ color: t.inkFaint }}>Paste the code you were sent, then choose a new password.</p>

      <Field t={t} label="Reset code">
        <input style={inputStyle(t)} placeholder="Paste the code here" value={token} onChange={(e) => setToken(e.target.value.trim())} />
      </Field>
      <Field t={t} label="New password">
        <input style={inputStyle(t)} type="password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
      </Field>
      {message && <p className="text-[12.5px] mb-2" style={{ color: t.good }}>{message}</p>}
      {error && <p className="text-[12.5px] mb-2" style={{ color: t.danger }}>{error}</p>}

      <div className="flex-1" />
      <button onClick={() => valid && onDone(token, newPassword)} disabled={!valid || submitting} className="w-full py-3.5 rounded-full font-semibold text-[15px]" style={{ background: t.gold, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: valid && !submitting ? 1 : 0.5 }}>
        {submitting ? "Updating…" : "Update password"}
      </button>
    </div>
  );
}

function Onboarding({ t, onFinish, submitting, error, onLogin, loginSubmitting, loginError, onBiometricLogin, biometricSubmitting, biometricError, onForgotPassword, forgotSubmitting, forgotError, forgotMessage, onResetPassword, resetSubmitting, resetError, resetMessage }) {
  // Skips the welcome slides for a returning customer on this device -
  // the httpOnly session cookie won't always still be valid (e.g. after
  // fully closing and reopening the app), but there's no reason to show
  // marketing slides again to someone who's already used the app before.
  const [stage, setStage] = useState(() => (localStorage.getItem("mitapesa_has_account") ? "login" : "slides"));
  const [verificationMethod, setVerificationMethod] = useState("sms");
  const [phone, setPhone] = useState("");
  const [phoneVerifyToken, setPhoneVerifyToken] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [emailVerifyToken, setEmailVerifyToken] = useState("");

  // Which onboarding journey to show is admin-configured (Admin Portal ->
  // Settings -> verification_method), not hardcoded — see the backend
  // docs on why this is a single value rather than two toggles.
  useEffect(() => {
    api.settingsPublic().then((s) => setVerificationMethod(s.verification_method === "email" ? "email" : "sms")).catch(() => {});
  }, []);

  const startVerification = () => setStage(verificationMethod === "email" ? "email" : "phone");

  return (
    <div style={{ background: t.bg }}>
      {stage === "slides" && <OnboardingSlides t={t} onDone={startVerification} onSkip={startVerification} onLogin={() => setStage("login")} />}
      {stage === "phone" && <PhoneStage t={t} phone={phone} setPhone={setPhone} onBack={() => setStage("slides")} onSent={() => setStage("otp")} />}
      {stage === "otp" && <OtpStage t={t} phone={phone} onBack={() => setStage("phone")} onVerified={(verifyToken) => { setPhoneVerifyToken(verifyToken); setStage("profile"); }} />}
      {stage === "email" && <EmailStage t={t} email={regEmail} setEmail={setRegEmail} onBack={() => setStage("slides")} onSent={() => setStage("otpEmail")} />}
      {stage === "otpEmail" && <OtpEmailStage t={t} email={regEmail} onBack={() => setStage("email")} onVerified={(verifyToken) => { setEmailVerifyToken(verifyToken); setStage("profile"); }} />}
      {stage === "profile" && (
        <ProfileStage
          t={t}
          onBack={() => setStage(verificationMethod === "email" ? "otpEmail" : "otp")}
          onDone={(profile) => onFinish(verificationMethod === "email" ? { ...profile, emailVerifyToken } : { ...profile, phone, phoneVerifyToken })}
          submitting={submitting}
          error={error}
          prefilledEmail={verificationMethod === "email" ? regEmail : undefined}
          needsPhone={verificationMethod === "email"}
        />
      )}
      {stage === "login" && <LoginStage t={t} onBack={() => setStage("slides")} onDone={onLogin} onForgotPassword={() => setStage("forgot")} submitting={loginSubmitting} error={loginError} onBiometricLogin={onBiometricLogin} biometricSubmitting={biometricSubmitting} biometricError={biometricError} />}
      {stage === "forgot" && <ForgotPasswordStage t={t} onBack={() => setStage("login")} onSent={async (email) => { const ok = await onForgotPassword(email); if (ok) setStage("reset"); }} submitting={forgotSubmitting} error={forgotError} message={forgotMessage} />}
      {stage === "reset" && <ResetPasswordStage t={t} onBack={() => setStage("login")} onDone={async (token, newPassword) => { const ok = await onResetPassword(token, newPassword); if (ok) setStage("login"); }} submitting={resetSubmitting} error={resetError} message={resetMessage} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PAGE: HOME                                                             */
/* ---------------------------------------------------------------------- */

function HomePage({ t, transactions, budgets, categories, categoryIdByName, refreshCardAndTransactions, user, tr, language, setActive, onAdd, onUpdate, onAddCategory, onAddSubcategory, kycVerified, setKycVerified }) {
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [qrPayOpen, setQrPayOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const personal = transactions.filter((x) => x.wallet === "personal");
  const income = personal.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const expenses = personal.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  const balance = income + expenses;
  const totalLimit = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = -personal.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  const remaining = totalLimit - totalSpent;
  const budgetPct = totalLimit > 0 ? Math.min(1, totalSpent / totalLimit) : 0;
  const recent = [...personal].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  const byCategory = useCategorySpend(transactions, categories, "personal");
  const topCat = byCategory[0];
  const topPct = topCat && totalSpent > 0 ? Math.round((topCat.total / totalSpent) * 100) : 0;

  const quickActions = [
    { icon: Plus, label: tr("addExpense"), color: t.accent, onClick: () => setAddOpen(true) },
    { icon: Mic, label: tr("voiceLog"), color: "#7C6BAE", onClick: () => setAiOpen(true) },
    { icon: QrCode, label: "Lipa", color: t.gold, onClick: () => setQrPayOpen(true) },
    { icon: Camera, label: tr("scanReceipt"), color: "#1A5C97", onClick: () => setScanOpen(true) },
  ];

  return (
    <div className="px-4 pt-2 pb-6 space-y-3">
      <div>
        <p className="text-[13px]" style={{ color: t.inkFaint }}>{tr("goodEvening")}{user?.firstName ? `, ${user.firstName}` : ""}</p>
        <h1 className="text-[20px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("yourOverview")}</h1>
      </div>

      {/* Hero card: balance + income/expense chips + budget progress, all in one */}
      <Card t={t} className="p-4" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.good})` }}>
        <p className="text-[11px] font-medium tracking-wide uppercase" style={{ color: "rgba(255,255,255,0.75)" }}>{tr("totalBalance")}</p>
        <p className="text-[28px] font-bold mt-0.5" style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>{fmt(balance)}</p>

        <div className="flex gap-2 mt-3">
          <div className="flex-1 rounded-[14px] px-3 py-2" style={{ background: "rgba(255,255,255,0.14)" }}>
            <div className="flex items-center gap-1"><ArrowUpRight size={12} color="#fff" /><span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("monthlyIncome")}</span></div>
            <p className="text-[14px] font-bold mt-0.5" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(income)}</p>
          </div>
          <div className="flex-1 rounded-[14px] px-3 py-2" style={{ background: "rgba(255,255,255,0.14)" }}>
            <div className="flex items-center gap-1"><ArrowDownRight size={12} color="#fff" /><span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("monthlyExpenses")}</span></div>
            <p className="text-[14px] font-bold mt-0.5" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(expenses)}</p>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between mb-1"><span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("budgetUsed")}</span><span className="text-[10.5px] font-bold" style={{ color: "#fff" }}>{Math.round(budgetPct * 100)}%</span></div>
          <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}><div className="h-full rounded-full" style={{ width: `${budgetPct * 100}%`, background: budgetPct > 0.9 ? "#FCA5A5" : "#fff" }} /></div>
          <p className="text-[10.5px] mt-1" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("leftOfPlan", fmt(remaining), fmt(totalLimit))}</p>
        </div>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2">
        {quickActions.map((a, i) => (
          <button key={i} onClick={a.onClick} className="flex flex-col items-center gap-1.5 py-2.5 rounded-[16px]" style={{ background: t.card, border: `1px solid ${t.border}` }}>
            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${a.color}1F` }}><a.icon size={15} color={a.color} /></div>
            <span className="text-[10px] font-medium text-center leading-tight" style={{ color: t.inkSoft }}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* Compact top-category insight with link to full Insights */}
      {topCat && (
        <Card t={t} className="p-3.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: t.inkFaint }}>{tr("topCategory")}</span>
            <button onClick={() => setActive("insights")} className="text-[11px] font-semibold flex items-center gap-0.5" style={{ color: t.accent }}>{tr("viewInsights")} <ChevronRight size={13} /></button>
          </div>
          <div className="flex items-center gap-2.5">
            <CategoryDot color={topCat.color} size={9} />
            <span className="text-[13px] font-semibold flex-1" style={{ color: t.ink }}>{topCat.category}</span>
            <span className="text-[11px]" style={{ color: t.inkFaint }}>{topPct}%</span>
            <span className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(topCat.total)}</span>
          </div>
          <div className="w-full h-1.5 rounded-full mt-2" style={{ background: t.bgSoft }}><div className="h-full rounded-full" style={{ width: `${topPct}%`, background: topCat.color }} /></div>
        </Card>
      )}

      {/* Recent activity, trimmed */}
      <div>
        <SectionLabel t={t} right={<button onClick={() => setActive("ledger")} className="text-[12px] font-semibold" style={{ color: t.accent }}>{tr("seeAll")}</button>}>{tr("recentActivity")}</SectionLabel>
        <Card t={t} className="px-3">{recent.length ? recent.map((tx) => <TxRow key={tx.id} t={t} tx={tx} categories={categories} />) : <p className="py-6 text-center text-[13px]" style={{ color: t.inkFaint }}>{tr("noRecentActivity")}</p>}</Card>
      </div>

      <AddTxSheet t={t} open={addOpen} onClose={() => setAddOpen(false)} onAdd={onAdd} wallet="personal" categories={categories} onAddCategory={onAddCategory} onAddSubcategory={onAddSubcategory} />
      <AiExpenseLogSheet t={t} open={aiOpen} onClose={() => setAiOpen(false)} onAdd={onAdd} categories={categories} />
      <QrPaymentSheet t={t} open={qrPayOpen} onClose={() => setQrPayOpen(false)} cardType="main" cardId="main" categories={categories} kycVerified={kycVerified} setKycVerified={setKycVerified} onSuccess={refreshCardAndTransactions} tr={tr} language={language} />
      <ScanReceiptSheet t={t} open={scanOpen} onClose={() => setScanOpen(false)} onAdd={onAdd} onUpdate={onUpdate} categories={categories} tr={tr} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PAGE: INSIGHTS (dedicated, Home-style layout)                          */
/* ---------------------------------------------------------------------- */

function ObservationRow({ t, icon: Icon, tone, text }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b last:border-0" style={{ borderColor: t.border }}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${tone}1F` }}><Icon size={15} color={tone} /></div>
      <p className="text-[13px] leading-relaxed flex-1" style={{ color: t.inkSoft }}>{text}</p>
    </div>
  );
}

function ExportInsightsSheet({ t, open, onClose }) {
  const [checked, setChecked] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [fromMonth, setFromMonth] = useState({ year: CURRENT_YEAR, month: CURRENT_MONTH_IDX });
  const [toMonth, setToMonth] = useState({ year: CURRENT_YEAR, month: CURRENT_MONTH_IDX });
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setChecked(false); setError("");
    api.settingsPublic()
      .then((s) => setEnabled(s.pfm_export_enabled !== "false"))
      .catch(() => setEnabled(true))
      .finally(() => setChecked(true));
  }, [open]);

  const monthOptionsFor = (year) => (year === CURRENT_YEAR ? MONTH_NAMES.slice(0, CURRENT_MONTH_IDX + 1) : MONTH_NAMES);

  const doExport = async () => {
    const fromIdx = monthIndex(fromMonth.year, fromMonth.month);
    const toIdx = monthIndex(toMonth.year, toMonth.month);
    if (fromIdx > toIdx) { setError("The starting month needs to be before the ending month."); return; }

    setDownloading(true); setError("");
    try {
      const from = `${fromMonth.year}-${String(fromMonth.month + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(toMonth.year, toMonth.month + 1, 0).getDate();
      const to = `${toMonth.year}-${String(toMonth.month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      await api.transactions.downloadExportCsv(from, to);
    } catch (err) {
      setError(err.message || "Couldn't export right now — please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const MonthYearSelect = ({ value, onChange }) => (
    <div className="flex gap-2">
      <select value={value.month} onChange={(e) => onChange({ ...value, month: parseInt(e.target.value) })} style={inputStyle(t)}>
        {monthOptionsFor(value.year).map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
      </select>
      <select value={value.year} onChange={(e) => onChange({ ...value, year: parseInt(e.target.value) })} style={inputStyle(t)}>
        {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Export transactions">
      {!checked ? (
        <div className="flex justify-center py-10"><RefreshCw size={20} className="animate-spin" color={t.accent} /></div>
      ) : !enabled ? (
        <div className="flex flex-col items-center py-8 text-center">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: t.cardSoft }}><Download size={26} color={t.inkFaint} /></div>
          <p className="text-[13.5px] font-semibold mb-1.5" style={{ color: t.ink }}>Export is currently unavailable</p>
          <p className="text-[12.5px]" style={{ color: t.inkFaint }}>Please check back later.</p>
        </div>
      ) : (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Choose the months to include — every transaction across all your categories and wallets in that range will be included as a CSV file.</p>
          <Field t={t} label="From"><MonthYearSelect value={fromMonth} onChange={setFromMonth} /></Field>
          <Field t={t} label="To"><MonthYearSelect value={toMonth} onChange={setToMonth} /></Field>
          {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={doExport} disabled={downloading}>
            <Download size={16} /> {downloading ? "Preparing…" : "Download CSV"}
          </PrimaryButton>
        </div>
      )}
    </BottomSheet>
  );
}

// Dedicated drill-down page for category-level income/expense analysis —
// pulled out of the old multi-panel SpendGraphCard specifically to cut
// down on scrolling on the main Insights page. Reuses the same
// day/week/month/custom date-range logic already used by the Ledger
// page's filters, rather than inventing a second one.
function CategoryPerformancePage({ t, transactions, categories, goBack }) {
  const [rangeType, setRangeType] = useState("month");
  const [customFrom, setCustomFrom] = useState(TODAY_STR);
  const [customTo, setCustomTo] = useState(TODAY_STR);
  const [viewType, setViewType] = useState("expense");
  const [selectedCategory, setSelectedCategory] = useState(null);

  const personal = transactions.filter((x) => x.wallet === "personal" && inDateRange(x.date, rangeType, customFrom, customTo));
  const typeFiltered = personal.filter((x) => (viewType === "income" ? x.amount > 0 : x.amount < 0));

  const byCategory = (() => {
    const map = {};
    typeFiltered.forEach((x) => { map[x.category] = (map[x.category] || 0) + Math.abs(x.amount); });
    return Object.entries(map)
      .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100, color: colorFor(categories, category) }))
      .sort((a, b) => b.total - a.total);
  })();
  const grandTotal = byCategory.reduce((s, c) => s + c.total, 0);

  const categoryTransactions = selectedCategory
    ? typeFiltered.filter((x) => x.category === selectedCategory).sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];
  const categoryTotal = categoryTransactions.reduce((s, x) => s + Math.abs(x.amount), 0);

  const rangeLabel = { today: "Today", week: "This week", month: "This month", custom: "Custom range" }[rangeType];
  const RANGE_OPTIONS = [["today", "Today"], ["week", "Week"], ["month", "Month"], ["custom", "Custom"]];

  // Drill-down: one category's transactions for the selected period.
  if (selectedCategory) {
    return (
      <div className="px-4 pt-2 pb-6 space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedCategory(null)} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <CategoryDot color={colorFor(categories, selectedCategory)} size={9} />
            <h1 className="text-[17px] font-bold truncate" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{selectedCategory}</h1>
          </div>
        </div>
        <Card t={t} className="p-4">
          <p className="text-[11px]" style={{ color: t.inkFaint }}>{rangeLabel} · {viewType === "income" ? "Income" : "Expenses"}</p>
          <p className="text-[24px] font-bold mt-0.5" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{fmt(categoryTotal)}</p>
          <p className="text-[11.5px] mt-0.5" style={{ color: t.inkFaint }}>{categoryTransactions.length} transaction{categoryTransactions.length !== 1 ? "s" : ""}</p>
        </Card>
        <Card t={t} className="divide-y" style={{ borderColor: t.border }}>
          {categoryTransactions.length === 0 ? (
            <p className="text-[12.5px] text-center py-6" style={{ color: t.inkFaint }}>No transactions in this period.</p>
          ) : categoryTransactions.map((x) => (
            <div key={x.id} className="flex items-center justify-between py-2.5 px-4">
              <div className="min-w-0">
                <p className="text-[13px] font-medium truncate" style={{ color: t.ink }}>{x.merchant}</p>
                <p className="text-[11px]" style={{ color: t.inkFaint }}>{x.date}</p>
              </div>
              <span className="text-[13px] font-semibold shrink-0 ml-2" style={{ color: x.amount > 0 ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(x.amount)}</span>
            </div>
          ))}
        </Card>
      </div>
    );
  }

  // Category list, for the selected date range and income/expense type.
  return (
    <div className="px-4 pt-2 pb-6 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[19px] font-bold flex-1" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Category performance</h1>
      </div>

      <div className="flex gap-1.5">
        {RANGE_OPTIONS.map(([key, label]) => (
          <button key={key} onClick={() => setRangeType(key)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold"
            style={rangeType === key ? { background: t.accent, color: "#fff" } : { background: t.cardSoft, color: t.inkSoft, border: `1px solid ${t.border}` }}>
            {label}
          </button>
        ))}
      </div>
      {rangeType === "custom" && (
        <div className="flex gap-2">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle(t)} />
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle(t)} />
        </div>
      )}

      <div className="flex gap-1 p-1 rounded-full w-fit" style={{ background: t.cardSoft }}>
        <button onClick={() => setViewType("expense")} className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold" style={viewType === "expense" ? { background: t.ink, color: t.bg } : { color: t.inkFaint }}>Expenses</button>
        <button onClick={() => setViewType("income")} className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold" style={viewType === "income" ? { background: t.ink, color: t.bg } : { color: t.inkFaint }}>Income</button>
      </div>

      <Card t={t} className="p-4">
        <p className="text-[11px]" style={{ color: t.inkFaint }}>{rangeLabel} total {viewType === "income" ? "income" : "expenses"}</p>
        <p className="text-[26px] font-bold mt-0.5" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{fmt(grandTotal)}</p>
      </Card>

      <Card t={t} className="divide-y" style={{ borderColor: t.border }}>
        {byCategory.length === 0 ? (
          <p className="text-[12.5px] text-center py-6" style={{ color: t.inkFaint }}>No {viewType === "income" ? "income" : "expenses"} in this period.</p>
        ) : byCategory.map((c) => {
          const pct = grandTotal > 0 ? Math.round((c.total / grandTotal) * 100) : 0;
          return (
            <button key={c.category} onClick={() => setSelectedCategory(c.category)} className="w-full flex items-center justify-between py-3 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <CategoryDot color={c.color} size={9} />
                <span className="text-[13px] font-medium truncate" style={{ color: t.ink }}>{c.category}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className="text-[11px]" style={{ color: t.inkFaint }}>{pct}%</span>
                <span className="text-[13px] font-semibold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(c.total)}</span>
                <ChevronRight size={14} color={t.inkFaint} />
              </div>
            </button>
          );
        })}
      </Card>
    </div>
  );
}

function InsightsPage({ t, transactions, budgets, categories, tr, goBack, onViewCategoryPerformance }) {
  // Scoped to the current calendar month specifically — every figure here
  // ("monthly income," "this month's budget," etc.) is meant to represent
  // this month, not the customer's entire transaction history. Previously
  // unscoped, which meant these numbers were lifetime totals that never
  // reset month to month.
  const currentMonthKey = monthKeyOf(CURRENT_YEAR, CURRENT_MONTH_IDX);
  const personal = transactions.filter((x) => x.wallet === "personal" && x.date?.startsWith(currentMonthKey));
  const income = personal.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const expenses = personal.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  const balance = income + expenses;
  const totalLimit = budgets.reduce((s, b) => s + b.limit, 0);
  const totalSpent = -personal.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  const remaining = totalLimit - totalSpent;
  const budgetPct = totalLimit > 0 ? Math.min(1, totalSpent / totalLimit) : 0;
  const byCategory = useCategorySpend(transactions, categories, "personal");
  const topCat = byCategory[0];
  const topPct = topCat && totalSpent > 0 ? Math.round((topCat.total / totalSpent) * 100) : 0;
  const spentByCat = (cat) => -personal.filter((x) => x.amount < 0 && x.category === cat).reduce((s, x) => s + x.amount, 0);

  const prevIdx = MAX_MONTH_INDEX - 1;
  const prevY = Math.floor(prevIdx / 12), prevM = prevIdx % 12;
  const prevTotal = realMonthTotal(transactions, prevY, prevM, "personal");
  const momChange = prevTotal > 0 ? Math.round(((totalSpent - prevTotal) / prevTotal) * 100) : 0;

  const observations = [];
  if (budgetPct > 0.9) observations.push({ icon: AlertTriangle, tone: t.danger, text: `You've used ${Math.round(budgetPct * 100)}% of your total budget this month — consider slowing down on ${topCat ? topCat.category : "discretionary spending"}.` });
  else if (budgetPct > 0.65) observations.push({ icon: Target, tone: t.gold, text: `You're at ${Math.round(budgetPct * 100)}% of your monthly budget — on pace, but worth watching for the rest of the month.` });
  else observations.push({ icon: BadgeCheck, tone: t.good, text: `You're comfortably within budget this month, having used only ${Math.round(budgetPct * 100)}% so far.` });
  if (topCat) observations.push({ icon: PiggyBank, tone: t.gold, text: `${topCat.category} is your biggest expense this month at ${topPct}% of total spending (${fmt(topCat.total)}).` });
  observations.push(momChange <= 0
    ? { icon: TrendingDown, tone: t.good, text: `Nice — your spending is down ${Math.abs(momChange)}% compared to last month.` }
    : { icon: TrendingUp, tone: t.danger, text: `Heads up — your spending is up ${momChange}% compared to last month.` });
  if (remaining > 0) observations.push({ icon: Sparkles, tone: t.accent, text: `You still have ${fmt(remaining)} left in your budget with the month still in progress.` });

  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="px-4 pt-2 pb-6 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[20px] font-bold flex-1" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("insights")}</h1>
        <button onClick={() => setExportOpen(true)} className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-full" style={{ color: t.accent, background: t.accentSoft }}><Download size={13} /> Export</button>
      </div>

      <ExportInsightsSheet t={t} open={exportOpen} onClose={() => setExportOpen(false)} />

      {/* Overview card, same style as Home */}
      <Card t={t} className="p-4" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.good})` }}>
        <p className="text-[11px] font-medium tracking-wide uppercase" style={{ color: "rgba(255,255,255,0.75)" }}>{tr("totalBalance")}</p>
        <p className="text-[28px] font-bold mt-0.5" style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>{fmt(balance)}</p>
        <div className="flex gap-2 mt-3">
          <div className="flex-1 rounded-[14px] px-3 py-2" style={{ background: "rgba(255,255,255,0.14)" }}>
            <div className="flex items-center gap-1"><ArrowUpRight size={12} color="#fff" /><span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("monthlyIncome")}</span></div>
            <p className="text-[14px] font-bold mt-0.5" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(income)}</p>
          </div>
          <div className="flex-1 rounded-[14px] px-3 py-2" style={{ background: "rgba(255,255,255,0.14)" }}>
            <div className="flex items-center gap-1"><ArrowDownRight size={12} color="#fff" /><span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("monthlyExpenses")}</span></div>
            <p className="text-[14px] font-bold mt-0.5" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(expenses)}</p>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1"><span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("budgetUsed")}</span><span className="text-[10.5px] font-bold" style={{ color: "#fff" }}>{Math.round(budgetPct * 100)}%</span></div>
          <div className="w-full h-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }}><div className="h-full rounded-full" style={{ width: `${budgetPct * 100}%`, background: budgetPct > 0.9 ? "#FCA5A5" : "#fff" }} /></div>
          <p className="text-[10.5px] mt-1" style={{ color: "rgba(255,255,255,0.8)" }}>{tr("leftOfPlan", fmt(remaining), fmt(totalLimit))}</p>
        </div>
      </Card>

      {/* Full analytics: weekly / category summary / comparison / trends / 3-month */}
      <SpendGraphCard t={t} transactions={transactions} categories={categories} wallet="personal" onViewCategoryPerformance={onViewCategoryPerformance} />

      {/* Budget performance */}
      <div>
        <SectionLabel t={t}>{tr("budgetPerformance")}</SectionLabel>
        <Card t={t} className="p-4 space-y-3">
          {budgets.map((b) => {
            const spent = spentByCat(b.category);
            return (
              <div key={b.category}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5"><CategoryDot color={colorFor(categories, b.category)} size={7} /><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{b.category}</span></div>
                  <span className="text-[11.5px]" style={{ color: t.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(spent)} / {fmt(b.limit)}</span>
                </div>
                <BudgetBar t={t} spent={spent} limit={b.limit} />
              </div>
            );
          })}
        </Card>
      </div>

      {/* Personalized observations */}
      <div>
        <SectionLabel t={t}>{tr("forYou")}</SectionLabel>
        <Card t={t} className="px-4">
          {observations.map((o, i) => <ObservationRow key={i} t={t} icon={o.icon} tone={o.tone} text={o.text} />)}
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PAGE: LEDGER                                                           */
/* ---------------------------------------------------------------------- */

function TxDetailSheet({ t, tx, open, onClose, categories, onAddCategory, onAddSubcategory, onUpdate, onDelete, tr }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [date, setDate] = useState("");
  const [type, setType] = useState("expense");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);

  useEffect(() => {
    if (tx) {
      setAmount(String(Math.abs(tx.amount)));
      setMerchant(tx.merchant);
      setCategory(tx.category);
      setSubcategory(tx.subcategory || "");
      setDate(tx.date);
      setType(tx.amount < 0 ? "expense" : "income");
      setNote(tx.note || "");
      setPhoto(tx.photo || null);
      setEditing(false);
      setConfirmDelete(false);
    }
  }, [tx]);

  if (!tx) return null;
  const positive = tx.amount > 0;
  const color = colorFor(categories, tx.category);
  const isVerifiedChannel = VERIFIED_CHANNEL_SOURCES.includes(tx.source);

  const changeCategory = (name) => { setCategory(name); setSubcategory(""); };
  const save = () => {
    const val = Math.abs(parseFloat(amount)) || 0;
    const patch = { category, subcategory: subcategory || null, note: note.trim() || null, photo };
    if (!isVerifiedChannel) {
      patch.amount = type === "expense" ? -val : val;
      patch.merchant = merchant;
      patch.date = date;
    }
    onUpdate(tx.id, patch);
    setEditing(false);
  };
  const confirmedDelete = () => { onDelete(tx.id); onClose(); };

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title={editing ? tr("editTransaction") : tx.merchant}>
      {!editing && !confirmDelete && (
        <div>
          <div className="flex flex-col items-center py-3 mb-4">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: `${color}22` }}><CategoryDot color={color} size={14} /></div>
            <p className="text-[26px] font-bold" style={{ color: positive ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(tx.amount)}</p>
            <p className="text-[13px] mt-1" style={{ color: t.inkFaint }}>{tx.category}{tx.subcategory ? ` › ${tx.subcategory}` : ""}</p>
          </div>
          {tx.photo && <img src={tx.photo} alt="receipt" className="w-full h-40 object-cover rounded-[16px] mb-4" style={{ border: `1px solid ${t.border}` }} />}
          <Card t={t} className="p-4 mb-4">
            <div className="flex items-center justify-between py-1.5"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>{tr("merchant")}</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{tx.merchant}</span></div>
            <div className="flex items-center justify-between py-1.5"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>{tr("date")}</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{new Date(tx.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span></div>
            <div className="flex items-center justify-between py-1.5"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>{tr("type")}</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{positive ? tr("income") : tr("expense")}</span></div>
            {tx.subcategory && <div className="flex items-center justify-between py-1.5"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>Subcategory</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{tx.subcategory}</span></div>}
            {tx.loggedBy && <div className="flex items-center justify-between py-1.5"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>Logged by</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{tx.loggedBy}</span></div>}
            {tx.note && <div className="pt-2 mt-1" style={{ borderTop: `1px solid ${t.border}` }}><p className="text-[12.5px] mb-1" style={{ color: t.inkFaint }}>Description</p><p className="text-[13.5px]" style={{ color: t.ink }}>{tx.note}</p></div>}
          </Card>
          <div className="flex gap-2">
            <button onClick={() => setEditing(true)} className="flex-1 py-3 rounded-full font-semibold text-[13.5px] flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}><Pencil size={14} /> {tr("editTransaction")}</button>
            <button onClick={() => setConfirmDelete(true)} className="flex-1 py-3 rounded-full font-semibold text-[13.5px] flex items-center justify-center gap-1.5" style={{ background: t.dangerSoft, color: t.danger }}><Trash2 size={14} /> {tr("delete")}</button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="flex flex-col items-center text-center py-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: t.dangerSoft }}><Trash2 size={22} color={t.danger} /></div>
          <p className="text-[14px] font-semibold mb-1" style={{ color: t.ink }}>{tr("deleteTransaction")}</p>
          <p className="text-[13px] mb-5" style={{ color: t.inkFaint }}>{tr("deleteConfirmMsg")}</p>
          <div className="flex gap-2 w-full">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>{tr("cancel")}</button>
            <button onClick={confirmedDelete} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: t.danger, color: "#fff" }}>{tr("delete")}</button>
          </div>
        </div>
      )}

      {editing && (
        <div>
          {isVerifiedChannel && (
            <div className="flex items-start gap-2 p-3 rounded-[14px] mb-4" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
              <Lock size={14} color={t.inkFaint} className="mt-0.5 shrink-0" />
              <p className="text-[11.5px]" style={{ color: t.inkFaint }}>This top-up was verified by {tx.source === "topup_oct" ? "an instant push" : "the payment gateway"} that processed it — the amount, source, and date can't be changed here. The category and description can still be updated below.</p>
            </div>
          )}
          {!isVerifiedChannel && (
            <div className="flex gap-2 mb-4">
              {["expense", "income"].map((k) => (
                <button key={k} onClick={() => { setType(k); setSubcategory(""); if (k === "income") setCategory("Income"); else if (category === "Income") setCategory(categories.find((c) => c.name !== "Income")?.name || categories[0]?.name || "Food & Dining"); }} className="flex-1 py-2 rounded-full text-[13px] font-semibold capitalize" style={{ background: type === k ? (k === "expense" ? t.dangerSoft : t.accentSoft) : t.cardSoft, color: type === k ? (k === "expense" ? t.danger : t.good) : t.inkFaint, border: `1px solid ${t.border}` }}>{tr(k)}</button>
              ))}
            </div>
          )}
          <Field t={t} label="Amount (TZS)">
            {isVerifiedChannel ? (
              <p className="text-[15px] font-semibold py-2" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(tx.amount)}</p>
            ) : (
              <>
                <input style={inputStyle(t)} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <CurrencyEquivalentHint t={t} amountTZS={amount} />
              </>
            )}
          </Field>
          {type === "expense" ? (
            <>
              <Field t={t} label={tr("merchant")}><input style={inputStyle(t)} value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>
              <Field t={t} label="Category"><CategoryPicker t={t} categories={categories.filter((c) => c.name !== "Income")} value={category} onChange={changeCategory} onAddCategory={onAddCategory} /></Field>
              <Field t={t} label="Subcategory (optional)"><SubcategoryPicker t={t} categories={categories} mainCategory={category} value={subcategory} onChange={setSubcategory} onAddSubcategory={onAddSubcategory} /></Field>
            </>
          ) : (
            <>
              <Field t={t} label="Source">
                {isVerifiedChannel ? (
                  <p className="text-[13.5px] font-semibold py-2" style={{ color: t.ink }}>{merchant}</p>
                ) : (
                  <input style={inputStyle(t)} placeholder="e.g. Acme Corp, Client name" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
                )}
              </Field>
              <Field t={t} label="Income type"><SubcategoryPicker t={t} categories={categories} mainCategory="Income" value={subcategory} onChange={setSubcategory} onAddSubcategory={onAddSubcategory} /></Field>
            </>
          )}
          <Field t={t} label={tr("date")}>
            {isVerifiedChannel ? (
              <p className="text-[13.5px] font-semibold py-2" style={{ color: t.ink }}>{new Date(date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</p>
            ) : (
              <input style={inputStyle(t)} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            )}
          </Field>
          <Field t={t} label="Description (optional)"><textarea rows={2} style={{ ...inputStyle(t), resize: "none" }} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <PhotoPicker t={t} photo={photo} setPhoto={setPhoto} label="Receipt photo (optional)" />
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>{tr("cancel")}</button>
            <button onClick={save} disabled={!amount || !merchant || (type === "income" && !subcategory)} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: t.accent, color: "#fff", opacity: (!amount || !merchant || (type === "income" && !subcategory)) ? 0.5 : 1 }}>{tr("saveChanges")}</button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function DateFilterSheet({ t, open, onClose, preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, tr }) {
  const presets = [
    { key: "today", label: tr("today") }, { key: "yesterday", label: tr("yesterday") },
    { key: "week", label: tr("thisWeek") }, { key: "month", label: tr("thisMonth") },
    { key: "custom", label: tr("custom") }, { key: "all", label: tr("allTime") },
  ];
  return (
    <BottomSheet t={t} open={open} onClose={onClose} title={tr("dateRange")}>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {presets.map((p) => (
          <button key={p.key} onClick={() => setPreset(p.key)} className="py-2.5 rounded-full text-[13px] font-semibold" style={{ background: preset === p.key ? t.accent : t.cardSoft, color: preset === p.key ? "#fff" : t.inkSoft, border: `1px solid ${preset === p.key ? t.accent : t.border}` }}>{p.label}</button>
        ))}
      </div>
      {preset === "custom" && (
        <div className="flex gap-2 mb-4">
          <Field t={t} label={tr("from")}><input style={inputStyle(t)} type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></Field>
          <Field t={t} label={tr("to")}><input style={inputStyle(t)} type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></Field>
        </div>
      )}
      <PrimaryButton t={t} onClick={onClose}>{tr("apply")}</PrimaryButton>
    </BottomSheet>
  );
}

function LedgerTxRow({ t, tx, categories, selectMode, selected, onToggleSelect, onOpenDetail }) {
  const positive = tx.amount > 0;
  const color = colorFor(categories, tx.category);
  return (
    <button onClick={() => (selectMode ? onToggleSelect(tx.id) : onOpenDetail(tx))} className="w-full flex items-center gap-3 py-3 px-1 border-b last:border-0 text-left" style={{ borderColor: t.border }}>
      {selectMode ? (
        selected ? <CheckSquare size={20} color={t.accent} className="shrink-0" /> : <Square size={20} color={t.inkFaint} className="shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}22` }}><CategoryDot color={color} size={10} /></div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-[14px] font-semibold truncate" style={{ color: t.ink, fontFamily: "'Inter', sans-serif" }}>{tx.merchant}</p>
          {tx.photo && <Camera size={11} color={t.inkFaint} className="shrink-0" />}
        </div>
        <p className="text-[12px]" style={{ color: t.inkFaint }}>{tx.category}{tx.subcategory ? ` › ${tx.subcategory}` : ""} · {new Date(tx.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
      </div>
      <span className="text-[14px] font-bold shrink-0" style={{ color: positive ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(tx.amount)}</span>
    </button>
  );
}

function LedgerPage({ t, transactions, onAdd, onUpdate, onDelete, onDeleteMany, goImport, categories, onAddCategory, onAddSubcategory, tr }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [datePreset, setDatePreset] = useState("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [detailTx, setDetailTx] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);

  const personal = transactions.filter((x) => x.wallet === "personal");
  const byCategory = filter === "All" ? personal : personal.filter((x) => x.category === filter);
  const bySearch = search.trim() ? byCategory.filter((x) => x.merchant.toLowerCase().includes(search.trim().toLowerCase())) : byCategory;
  const byDate = bySearch.filter((x) => inDateRange(x.date, datePreset, customFrom, customTo));
  const sorted = [...byDate].sort((a, b) => new Date(b.date) - new Date(a.date));

  const income = sorted.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const expenses = sorted.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);

  const groups = [];
  const groupMap = {};
  sorted.forEach((tx) => {
    const bucket = dateBucket(tx.date, tr);
    if (!groupMap[bucket]) { groupMap[bucket] = []; groups.push(bucket); }
    groupMap[bucket].push(tx);
  });

  const toggleSelect = (id) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAll = () => setSelectedIds(sorted.map((x) => x.id));
  const clearSelection = () => setSelectedIds([]);
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds([]); };
  const doExport = () => exportTransactionsCSV(sorted.filter((x) => selectedIds.includes(x.id)));
  const doDelete = () => { onDeleteMany(selectedIds); exitSelectMode(); };

  const datePresetLabel = { all: tr("allTime"), today: tr("today"), yesterday: tr("yesterday"), week: tr("thisWeek"), month: tr("thisMonth"), custom: tr("custom") }[datePreset];

  return (
    <div className="px-4 pt-2 pb-24 relative">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[22px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("transactionLedger")}</h1>
        <div className="flex items-center gap-1.5">
          <button onClick={goImport} className="flex items-center gap-1 text-[12.5px] font-semibold px-3 py-1.5 rounded-full" style={{ color: t.accent, background: t.accentSoft }}><UploadCloud size={13} /> {tr("import")}</button>
          <button onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))} className="text-[12.5px] font-semibold px-3 py-1.5 rounded-full" style={{ color: selectMode ? "#fff" : t.inkSoft, background: selectMode ? t.ink : t.cardSoft, border: `1px solid ${t.border}` }}>{selectMode ? tr("cancel") : tr("select")}</button>
        </div>
      </div>

      <div className="relative mb-2.5">
        <Search size={15} color={t.inkFaint} style={{ position: "absolute", left: 13, top: 12 }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("searchPlaceholder")} style={{ ...inputStyle(t), paddingLeft: 34 }} />
        {search && <button onClick={() => setSearch("")} className="absolute" style={{ right: 10, top: 9 }}><X size={16} color={t.inkFaint} /></button>}
      </div>

      <button onClick={() => setDateSheetOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold mb-2.5" style={{ background: datePreset !== "today" ? t.accentSoft : t.cardSoft, color: datePreset !== "today" ? t.good : t.inkSoft, border: `1px solid ${t.border}` }}>
        <Calendar size={13} /> {tr("dateRange")}: {datePresetLabel} <ChevronDown size={13} />
      </button>

      <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1" style={{ scrollbarWidth: "none" }}>
        <Pill t={t} active={filter === "All"} onClick={() => setFilter("All")}>All</Pill>
        {categories.map((c) => <Pill key={c.name} t={t} active={filter === c.name} onClick={() => setFilter(c.name)}>{c.name}</Pill>)}
      </div>

      {sorted.length > 0 && (
        <div className="flex items-center justify-between px-1 mb-2.5">
          <span className="text-[12px]" style={{ color: t.inkFaint }}>{tr("txCount", sorted.length)}</span>
          <div className="flex items-center gap-3 text-[12px]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
            <span style={{ color: t.good }}>+{fmt(income).replace("$", "")}</span>
            <span style={{ color: t.danger }}>{fmt(expenses)}</span>
          </div>
        </div>
      )}

      {selectMode && (
        <div className="flex items-center justify-between mb-2 px-1">
          <button onClick={selectedIds.length === sorted.length ? clearSelection : selectAll} className="text-[12px] font-semibold" style={{ color: t.accent }}>{tr("selectAll")}</button>
          {selectedIds.length > 0 && <span className="text-[12px] font-semibold" style={{ color: t.ink }}>{tr("selected", selectedIds.length)}</span>}
        </div>
      )}

      {sorted.length === 0 ? (
        <Card t={t} className="px-3"><p className="py-8 text-center text-[13px]" style={{ color: t.inkFaint }}>{search || filter !== "All" || datePreset !== "all" ? tr("noResults") : tr("noTransactions")}</p></Card>
      ) : (
        groups.map((bucket) => (
          <div key={bucket} className="mb-3">
            <SectionLabel t={t}>{bucket}</SectionLabel>
            <Card t={t} className="px-3">
              {groupMap[bucket].map((tx) => (
                <LedgerTxRow key={tx.id} t={t} tx={tx} categories={categories} selectMode={selectMode} selected={selectedIds.includes(tx.id)} onToggleSelect={toggleSelect} onOpenDetail={setDetailTx} />
              ))}
            </Card>
          </div>
        ))
      )}

      {selectMode ? (
        <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] px-4 py-3 flex items-center gap-2 z-40" style={{ background: t.card, borderTop: `1px solid ${t.border}`, paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <button onClick={doDelete} disabled={!selectedIds.length} className="flex-1 py-3 rounded-full font-semibold text-[13px] flex items-center justify-center gap-1.5" style={{ background: t.dangerSoft, color: t.danger, opacity: selectedIds.length ? 1 : 0.5 }}><Trash2 size={14} /> {tr("deleteSelected")}</button>
          <button onClick={doExport} disabled={!selectedIds.length} className="flex-1 py-3 rounded-full font-semibold text-[13px] flex items-center justify-center gap-1.5" style={{ background: t.accent, color: "#fff", opacity: selectedIds.length ? 1 : 0.5 }}><Download size={14} /> {tr("export")}</button>
        </div>
      ) : (
        <>
          <button onClick={() => setScanOpen(true)} className="fixed z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg" style={{ background: t.gold, right: "max(1.25rem, calc(50% - 195px))", bottom: 216 }}><Camera size={19} color="#fff" /></button>
          <button onClick={() => setAiOpen(true)} className="fixed z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg" style={{ background: "#7C6BAE", right: "max(1.25rem, calc(50% - 195px))", bottom: 154 }}><Mic size={20} color="#fff" /></button>
          <button onClick={() => setSheetOpen(true)} className="fixed z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-lg" style={{ background: t.accent, right: "max(1.25rem, calc(50% - 195px))", bottom: 92 }}><Plus size={26} color="#fff" /></button>
        </>
      )}

      <AddTxSheet t={t} open={sheetOpen} onClose={() => setSheetOpen(false)} onAdd={onAdd} wallet="personal" categories={categories} onAddCategory={onAddCategory} onAddSubcategory={onAddSubcategory} />
      <AiExpenseLogSheet t={t} open={aiOpen} onClose={() => setAiOpen(false)} onAdd={onAdd} categories={categories} />
      <ScanReceiptSheet t={t} open={scanOpen} onClose={() => setScanOpen(false)} onAdd={onAdd} onUpdate={onUpdate} categories={categories} tr={tr} />
      <TxDetailSheet t={t} tx={detailTx} open={!!detailTx} onClose={() => setDetailTx(null)} categories={categories} onAddCategory={onAddCategory} onAddSubcategory={onAddSubcategory} onUpdate={onUpdate} onDelete={onDelete} tr={tr} />
      <DateFilterSheet t={t} open={dateSheetOpen} onClose={() => setDateSheetOpen(false)} preset={datePreset} setPreset={setDatePreset} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} tr={tr} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PAGE: BUDGET PLANNER                                                    */
/* ---------------------------------------------------------------------- */

function BudgetPage({ t, budgets, onUpsertBudget, onRemoveBudget, transactions, categories, onAddCategory, tr, setActive }) {
  // Scoped to the current calendar month — budgets are inherently
  // monthly limits, so "spent" needs to reset each month, not accumulate
  // across the customer's entire transaction history.
  const currentMonthKey = monthKeyOf(CURRENT_YEAR, CURRENT_MONTH_IDX);
  const personal = transactions.filter((x) => x.wallet === "personal" && x.amount < 0 && x.date?.startsWith(currentMonthKey));
  const spentByCat = (cat) => -personal.filter((x) => x.category === cat).reduce((s, x) => s + x.amount, 0);
  const availableCats = categories.filter((c) => !budgets.some((b) => b.category === c.name));
  const [newCat, setNewCat] = useState("");
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  useEffect(() => { if (!availableCats.some((c) => c.name === newCat)) setNewCat(availableCats[0]?.name || ""); }, [budgets, categories]);
  const addBudgetForExisting = () => { if (newCat) onUpsertBudget(newCat, 100); };
  const confirmCreate = () => { const created = onAddCategory(createName); if (created) { onUpsertBudget(created, 100); setCreateName(""); setCreating(false); } };

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[22px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("budgetPlanner")}</h1>
        <button onClick={() => setActive("categories")} className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-full" style={{ color: t.accent, background: t.accentSoft }}><Tag size={13} /> Categories</button>
      </div>
      <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>{tr("budgetPlannerSub")}</p>
      <div className="space-y-3">
        {budgets.map((b) => {
          const spent = spentByCat(b.category);
          const pct = b.limit > 0 ? spent / b.limit : 0;
          const status = pct > 0.9 ? "Over budget" : pct > 0.65 ? "Getting close" : "On track";
          const statusColor = pct > 0.9 ? t.danger : pct > 0.65 ? t.gold : t.good;
          return (
            <Card t={t} className="p-4" key={b.category}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><CategoryDot color={colorFor(categories, b.category)} size={10} /><span className="text-[14px] font-semibold" style={{ color: t.ink }}>{b.category}</span></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full" style={{ color: statusColor, background: `${statusColor}1A` }}>{status}</span>
                  <button onClick={() => onRemoveBudget(b.category)} className="p-1 rounded-full" style={{ background: t.bgSoft }} title="Remove budget"><X size={12} color={t.inkFaint} /></button>
                </div>
              </div>
              <BudgetBar t={t} spent={spent} limit={b.limit} />
              <div className="flex items-center justify-between mt-2"><span className="text-[12px]" style={{ color: t.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(spent)} of {fmt(b.limit)}</span><div className="flex items-center gap-1.5"><span className="text-[12px]" style={{ color: t.inkFaint }}>Limit</span><input type="number" value={b.limit} onChange={(e) => onUpsertBudget(b.category, parseFloat(e.target.value) || 0)} className="w-20 text-right px-2 py-1 rounded-lg text-[13px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }} /></div></div>
            </Card>
          );
        })}
      </div>
      <Card t={t} className="p-4 mt-4">
        <p className="text-[13px] font-semibold mb-2.5" style={{ color: t.ink }}>{tr("addCategoryBudget")}</p>
        {creating ? (
          <div className="flex gap-2">
            <input autoFocus style={inputStyle(t)} placeholder="New category name" value={createName} onChange={(e) => setCreateName(e.target.value)} />
            <button onClick={confirmCreate} className="px-4 rounded-[13px] font-semibold text-[13px] shrink-0" style={{ background: t.accent, color: "#fff" }}>Create</button>
            <button onClick={() => { setCreating(false); setCreateName(""); }} className="px-3 rounded-[13px] shrink-0" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><X size={14} color={t.inkFaint} /></button>
          </div>
        ) : (
          <div className="flex gap-2">
            {availableCats.length > 0 && (<><select style={inputStyle(t)} value={newCat} onChange={(e) => setNewCat(e.target.value)}>{availableCats.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select><button onClick={addBudgetForExisting} className="px-4 rounded-[13px] font-semibold text-[13px] shrink-0" style={{ background: t.accent, color: "#fff" }}>Add</button></>)}
            <button onClick={() => setCreating(true)} className="px-4 rounded-[13px] font-semibold text-[13px] shrink-0 flex items-center gap-1" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.accent }}><Plus size={14} /> {tr("newCategory")}</button>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PAGE: CATEGORY MANAGEMENT (main categories + subcategories)            */
/* ---------------------------------------------------------------------- */

function SubcategoryRow({ t, main, sub, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sub.name);

  const save = () => { if (value.trim()) onUpdate(main, sub.id, value.trim()); setEditing(false); };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 py-1.5">
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} style={{ ...inputStyle(t), padding: "6px 10px", fontSize: 12.5 }} />
        <button onClick={save} className="p-1.5 rounded-full" style={{ background: t.accentSoft }}><Check size={13} color={t.good} /></button>
        <button onClick={() => { setEditing(false); setValue(sub.name); }} className="p-1.5 rounded-full" style={{ background: t.cardSoft }}><X size={13} color={t.inkFaint} /></button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12.5px]" style={{ color: t.inkSoft }}>{sub.name}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => setEditing(true)} className="p-1.5 rounded-full" style={{ background: t.bgSoft }}><Pencil size={11} color={t.inkFaint} /></button>
        <button onClick={() => onDelete(main, sub.id)} className="p-1.5 rounded-full" style={{ background: t.bgSoft }}><Trash2 size={11} color={t.danger} /></button>
      </div>
    </div>
  );
}

function MainCategoryCard({ t, cat, expanded, onToggle, onAddSubcategory, onUpdateSubcategory, onDeleteSubcategory, onRenameCategory, onDeleteCategory }) {
  const [renaming, setRenaming] = useState(false);
  const [nameValue, setNameValue] = useState(cat.name);
  const [addingSub, setAddingSub] = useState(false);
  const [subName, setSubName] = useState("");
  const isOther = cat.name === "Other";

  const saveRename = () => { if (nameValue.trim() && nameValue.trim() !== cat.name) onRenameCategory(cat.name, nameValue.trim()); setRenaming(false); };
  const confirmAddSub = () => { if (subName.trim()) { onAddSubcategory(cat.name, subName.trim()); setSubName(""); setAddingSub(false); } };

  return (
    <Card t={t} className="p-4 mb-2.5">
      <div className="flex items-center gap-2.5">
        <button onClick={onToggle} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
          <CategoryDot color={cat.color} size={11} />
          {renaming ? (
            <input autoFocus value={nameValue} onChange={(e) => setNameValue(e.target.value)} onClick={(e) => e.stopPropagation()} style={{ ...inputStyle(t), padding: "6px 10px", fontSize: 13.5, fontWeight: 600 }} />
          ) : (
            <span className="text-[14px] font-semibold truncate" style={{ color: t.ink }}>{cat.name}</span>
          )}
          <span className="text-[11px] shrink-0" style={{ color: t.inkFaint }}>({cat.subcategories.length})</span>
        </button>
        {renaming ? (
          <>
            <button onClick={saveRename} className="p-1.5 rounded-full shrink-0" style={{ background: t.accentSoft }}><Check size={13} color={t.good} /></button>
            <button onClick={() => { setRenaming(false); setNameValue(cat.name); }} className="p-1.5 rounded-full shrink-0" style={{ background: t.cardSoft }}><X size={13} color={t.inkFaint} /></button>
          </>
        ) : (
          <>
            <button onClick={() => setRenaming(true)} className="p-1.5 rounded-full shrink-0" style={{ background: t.bgSoft }}><Pencil size={13} color={t.inkFaint} /></button>
            {!isOther && <button onClick={() => onDeleteCategory(cat.name)} className="p-1.5 rounded-full shrink-0" style={{ background: t.bgSoft }}><Trash2 size={13} color={t.danger} /></button>}
            <button onClick={onToggle} className="p-1.5 rounded-full shrink-0" style={{ background: t.bgSoft }}>{expanded ? <ChevronUp size={14} color={t.inkSoft} /> : <ChevronDown size={14} color={t.inkSoft} />}</button>
          </>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${t.border}` }}>
          {cat.subcategories.length > 0 ? (
            <div className="divide-y" style={{ borderColor: t.border }}>
              {cat.subcategories.map((s) => <SubcategoryRow key={s.id} t={t} main={cat.name} sub={s} onUpdate={onUpdateSubcategory} onDelete={onDeleteSubcategory} />)}
            </div>
          ) : (
            <p className="text-[12px] py-1.5" style={{ color: t.inkFaint }}>No subcategories yet.</p>
          )}
          {addingSub ? (
            <div className="flex items-center gap-1.5 mt-2">
              <input autoFocus value={subName} onChange={(e) => setSubName(e.target.value)} placeholder="Subcategory name" style={{ ...inputStyle(t), padding: "7px 10px", fontSize: 12.5 }} />
              <button onClick={confirmAddSub} className="p-2 rounded-full shrink-0" style={{ background: t.accent }}><Check size={13} color="#fff" /></button>
              <button onClick={() => { setAddingSub(false); setSubName(""); }} className="p-2 rounded-full shrink-0" style={{ background: t.cardSoft }}><X size={13} color={t.inkFaint} /></button>
            </div>
          ) : (
            <button onClick={() => setAddingSub(true)} className="w-full mt-2 py-2 rounded-[12px] text-[12px] font-semibold flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px dashed ${t.border}`, color: t.accent }}><Plus size={13} /> Add subcategory</button>
          )}
        </div>
      )}
    </Card>
  );
}

function CategoryManagementPage({ t, categories, goBack, onAddCategory, onAddSubcategory, onUpdateSubcategory, onDeleteSubcategory, onRenameCategory, onDeleteCategory }) {
  const [expanded, setExpanded] = useState(null);
  const [addingMain, setAddingMain] = useState(false);
  const [mainName, setMainName] = useState("");

  const confirmAddMain = () => { const created = onAddCategory(mainName); if (created) { setMainName(""); setAddingMain(false); setExpanded(created); } };

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center gap-2 mb-1">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[20px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Categories</h1>
      </div>
      <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Tap a main category to view, add, edit, or remove its subcategories.</p>

      {categories.map((cat) => (
        <MainCategoryCard
          key={cat.name} t={t} cat={cat} expanded={expanded === cat.name}
          onToggle={() => setExpanded((e) => (e === cat.name ? null : cat.name))}
          onAddSubcategory={onAddSubcategory} onUpdateSubcategory={onUpdateSubcategory} onDeleteSubcategory={onDeleteSubcategory}
          onRenameCategory={onRenameCategory} onDeleteCategory={onDeleteCategory}
        />
      ))}

      <Card t={t} className="p-4 mt-2">
        {addingMain ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={mainName} onChange={(e) => setMainName(e.target.value)} placeholder="New main category" style={inputStyle(t)} />
            <button onClick={confirmAddMain} className="px-4 rounded-[13px] font-semibold text-[13px] shrink-0" style={{ background: t.accent, color: "#fff" }}>Add</button>
            <button onClick={() => { setAddingMain(false); setMainName(""); }} className="px-3 rounded-[13px] shrink-0" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><X size={14} color={t.inkFaint} /></button>
          </div>
        ) : (
          <button onClick={() => setAddingMain(true)} className="w-full py-2.5 rounded-[13px] text-[13px] font-semibold flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px dashed ${t.border}`, color: t.accent }}><Plus size={14} /> Add main category</button>
        )}
      </Card>
    </div>
  );
}


const SAMPLE_ROWS = [
  { merchant: "Union Coffee Roasters", amount: -6.75, guess: "Food & Dining" },
  { merchant: "Skyline Parking Garage", amount: -14.0, guess: "Transportation" },
  { merchant: "Riverside Cinemas", amount: -22.5, guess: "Entertainment" },
  { merchant: "Bright Home Insurance", amount: -64.2, guess: "Housing & Utilities" },
  { merchant: "Thread & Co Apparel", amount: -47.99, guess: "Shopping" },
  { merchant: "Freelance Deposit", amount: 450, guess: "Other" },
];

function IngestPage({ t, onCommit, goBack, categories }) {
  const [dragOver, setDragOver] = useState(false);
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState(null);
  const [scanning, setScanning] = useState(false);

  const runSimulation = () => { setScanning(true); setParsed(null); setTimeout(() => { setParsed(SAMPLE_ROWS.map((r) => ({ id: uid(), merchant: r.merchant, amount: r.amount, category: r.guess, confidence: Math.floor(78 + Math.random() * 20), date: new Date().toISOString().slice(0, 10), wallet: "personal", loggedBy: "You" }))); setScanning(false); }, 1100); };
  const commitAll = () => { if (!parsed) return; onCommit(parsed); setParsed(null); setPasted(""); setFileName(""); };

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center gap-2 mb-1"><button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button><h1 className="text-[22px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>AI import</h1></div>
      <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Drop a CSV or paste raw statement text — we'll auto-categorize each line.</p>
      <Card t={t} className="p-6 flex flex-col items-center text-center" style={{ borderStyle: "dashed", borderWidth: 2, borderColor: dragOver ? t.accent : t.border, background: dragOver ? t.accentSoft : t.cardSoft }}>
        <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) setFileName(f.name); }} className="w-full flex flex-col items-center py-3">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: t.accentSoft }}><UploadCloud size={22} color={t.accent} /></div>
          <p className="text-[14px] font-semibold" style={{ color: t.ink }}>{fileName ? fileName : "Drag & drop a .csv statement"}</p>
          <p className="text-[12px] mt-1" style={{ color: t.inkFaint }}>or use the sample data below to try it out</p>
        </div>
      </Card>
      <Field t={t} label="Paste transaction text (optional)"><textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={"07/28  UNION COFFEE ROASTERS      -6.75\n07/27  SKYLINE PARKING              -14.00"} rows={4} style={{ ...inputStyle(t), resize: "none" }} /></Field>
      <button onClick={runSimulation} disabled={scanning} className="w-full py-3 rounded-full font-semibold text-[14px] flex items-center justify-center gap-2" style={{ background: t.accent, color: "#fff", fontFamily: "'Space Grotesk', sans-serif", opacity: scanning ? 0.7 : 1 }}>{scanning ? <><ScanLine size={17} className="animate-pulse" /> Categorizing…</> : <><Sparkles size={17} /> Simulate AI categorization</>}</button>
      {parsed && (
        <div className="mt-5">
          <SectionLabel t={t} right={<span className="text-[12px] font-semibold" style={{ color: t.accent }}>{parsed.length} found</span>}>Detected transactions</SectionLabel>
          <Card t={t} className="px-3">
            {parsed.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-3 px-1 border-b last:border-0" style={{ borderColor: t.border }}>
                <CategoryDot color={colorFor(categories, r.category)} size={10} />
                <div className="flex-1 min-w-0"><p className="text-[13px] font-semibold truncate" style={{ color: t.ink }}>{r.merchant}</p><div className="flex items-center gap-1.5 mt-0.5"><span className="text-[11px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: `${colorFor(categories, r.category)}22`, color: colorFor(categories, r.category) }}>{r.category}</span><span className="text-[11px]" style={{ color: t.inkFaint }}>{r.confidence}% confidence</span></div></div>
                <span className="text-[13px] font-bold" style={{ color: r.amount > 0 ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(r.amount)}</span>
              </div>
            ))}
          </Card>
          <button onClick={commitAll} className="w-full py-3 rounded-full font-semibold text-[14px] mt-3 flex items-center justify-center gap-2" style={{ background: t.ink, color: t.bg, fontFamily: "'Space Grotesk', sans-serif" }}><Check size={16} /> Add all to ledger</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  PAGE: PAY — VIRTUAL CARD, CONTROLS, SERVICES, MERCHANT PAYMENTS         */
/* ---------------------------------------------------------------------- */

function VirtualCard({ t, frozen, holderName, revealed, onToggleReveal }) {
  const gradient = frozen
    ? "linear-gradient(135deg, #4B4F4C 0%, #23271F 100%)"
    : "linear-gradient(120deg, #6C4FD6 0%, #7C4FC0 22%, #1F6F50 60%, #C4913C 100%)";

  return (
    <div className="relative pt-2 pb-6" style={{ perspective: 800 }}>
      <div className="absolute left-7 right-7 top-9 h-[176px] rounded-[38px] pointer-events-none" style={{ background: frozen ? "#555" : "linear-gradient(120deg, #6C4FD6, #1F6F50, #C4913C)", filter: "blur(28px)", opacity: 0.55 }} />
      <div className="absolute inset-x-6 top-4 h-[196px] rounded-[36px] pointer-events-none" style={{ background: "#0B120D", opacity: 0.18, transform: "rotate(3deg) scale(0.97)" }} />

      <button onClick={onToggleReveal} className="relative w-full text-left rounded-[36px] p-5 overflow-hidden" style={{ background: gradient, minHeight: 204, transform: "rotate(-1.4deg)", boxShadow: frozen ? "0 22px 40px -18px rgba(0,0,0,0.5)" : "0 26px 46px -16px rgba(108,79,214,0.5), 0 14px 26px -14px rgba(31,111,80,0.45)", transition: "transform 0.25s ease" }}>
        {!frozen && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(115deg, transparent 25%, rgba(255,255,255,0.30) 42%, transparent 58%)", backgroundSize: "260% 260%", animation: "shine 6s ease-in-out infinite" }} />
        )}
        <div className="absolute -right-8 -top-10 w-36 h-36 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="absolute -left-6 bottom-0 w-28 h-28 rounded-full" style={{ background: "rgba(255,255,255,0.06)" }} />

        <div className="relative flex items-center justify-between">
          <span className="text-[14px] font-bold tracking-wide" style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>MITAPESA</span>
          {frozen ? <Lock size={18} color="rgba(255,255,255,0.9)" /> : <Wifi size={20} color="rgba(255,255,255,0.9)" className="rotate-90" />}
        </div>
        <div className="relative mt-7 w-9 h-7 rounded-md" style={{ background: "linear-gradient(135deg, #FCE7B0, #E3B968, #C4913C)" }} />
        <p className="relative mt-4 text-[18px] font-semibold tracking-[3px]" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{revealed ? "5241 8890 3312 4821" : "•••• •••• •••• 4821"}</p>
        <div className="relative flex items-end justify-between mt-5">
          <div><p className="text-[9.5px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.65)" }}>Card holder</p><p className="text-[13px] font-semibold" style={{ color: "#fff" }}>{holderName}</p></div>
          <div><p className="text-[9.5px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.65)" }}>Expires</p><p className="text-[13px] font-semibold" style={{ color: "#fff" }}>09/29</p></div>
          <div className="text-right"><p className="text-[9.5px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.65)" }}>CVV2</p><p className="text-[13px] font-semibold" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{revealed ? "482" : "•••"}</p></div>
        </div>
        {frozen && <div className="absolute top-4 right-4 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: "rgba(0,0,0,0.35)", color: "#fff" }}>Frozen</div>}
      </button>
    </div>
  );
}

function RailAction({ t, icon: Icon, label, color, onClick, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick} className="flex flex-col items-center gap-1.5 py-2.5 rounded-[16px]" style={{ background: t.card, border: `1px solid ${t.border}`, opacity: disabled ? 0.4 : 1 }}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${color}1F` }}><Icon size={15} color={color} /></div>
      <span className="text-[10px] font-medium text-center leading-tight" style={{ color: t.inkSoft }}>{label}</span>
    </button>
  );
}

function MenuOption({ t, icon: Icon, title, sub, color, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-4 rounded-[16px] mb-2.5 text-left" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: `${color}1F` }}><Icon size={18} color={color} /></div>
      <div className="flex-1 min-w-0"><p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{title}</p><p className="text-[11.5px]" style={{ color: t.inkFaint }}>{sub}</p></div>
      <ChevronRight size={16} color={t.inkFaint} />
    </button>
  );
}

function CardControls({ t, frozen, setFrozen, controls, setControls, dailyLimit, setDailyLimit, noMargin }) {
  const [pinVisible, setPinVisible] = useState(false);
  const [reported, setReported] = useState(false);

  useEffect(() => { if (pinVisible) { const id = setTimeout(() => setPinVisible(false), 5000); return () => clearTimeout(id); } }, [pinVisible]);

  const report = () => { setFrozen(true); setReported(true); setTimeout(() => setReported(false), 4000); };

  const rows = [
    { key: "online", label: "Online payments", sub: "Web & app checkouts" },
    { key: "contactless", label: "Contactless & QR", sub: "Tap or scan to pay" },
    { key: "atm", label: "ATM withdrawals", sub: "Cash out at any ATM" },
  ];

  return (
    <Card t={t} className={`p-4 ${noMargin ? "" : "mt-4"}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2"><SlidersHorizontal size={15} color={t.inkSoft} /><p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>Card controls</p></div>
      </div>
      <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: t.border }}>
        <div className="flex items-center gap-2.5">{frozen ? <Lock size={16} color={t.danger} /> : <Unlock size={16} color={t.good} />}<div><p className="text-[13px] font-semibold" style={{ color: t.ink }}>Freeze card</p><p className="text-[11px]" style={{ color: t.inkFaint }}>{frozen ? "All spending is paused" : "Instantly block all activity"}</p></div></div>
        <Switch t={t} on={frozen} onChange={setFrozen} />
      </div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center justify-between py-3 border-b" style={{ borderColor: t.border }}>
          <div><p className="text-[13px] font-semibold" style={{ color: t.ink }}>{r.label}</p><p className="text-[11px]" style={{ color: t.inkFaint }}>{r.sub}</p></div>
          <Switch t={t} on={controls[r.key]} onChange={(v) => setControls((prev) => ({ ...prev, [r.key]: v }))} disabled={frozen} />
        </div>
      ))}
      <div className="flex items-center justify-between py-3 border-b" style={{ borderColor: t.border }}>
        <div><p className="text-[13px] font-semibold" style={{ color: t.ink }}>Daily spending limit</p><p className="text-[11px]" style={{ color: t.inkFaint }}>Resets every 24 hours</p></div>
        <input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(Math.max(0, parseInt(e.target.value) || 0))} className="w-24 text-right px-2 py-1.5 rounded-lg text-[12.5px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }} />
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => setPinVisible((v) => !v)} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>
          {pinVisible ? <><EyeOff size={14} /> {"2468"}</> : <><Eye size={14} /> View PIN</>}
        </button>
        <button onClick={report} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold flex items-center justify-center gap-1.5" style={{ background: t.dangerSoft, color: t.danger }}>
          <ShieldAlert size={14} /> Lost / stolen
        </button>
      </div>
      {reported && <p className="text-[11.5px] mt-2 text-center" style={{ color: t.danger }}>Card frozen — contact support for a replacement.</p>}
    </Card>
  );
}

const ACTIVITY_ICON = { topup: ArrowDownCircle, oct: ArrowDownCircle, receive: QrCode, transfer_out: ArrowLeftRight, bank_transfer: Landmark };
function CardActivityRow({ t, item }) {
  const Icon = ACTIVITY_ICON[item.type] || Receipt;
  const positive = item.amount > 0;
  return (
    <div className="flex items-center gap-3 py-3 px-1 border-b last:border-0" style={{ borderColor: t.border }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: positive ? t.accentSoft : t.bgSoft }}><Icon size={16} color={positive ? t.good : t.inkSoft} /></div>
      <div className="flex-1 min-w-0"><p className="text-[13.5px] font-semibold truncate" style={{ color: t.ink }}>{item.label}</p><p className="text-[11.5px]" style={{ color: t.inkFaint }}>{item.sub}</p></div>
      <span className="text-[13.5px] font-bold shrink-0" style={{ color: positive ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(item.amount)}</span>
    </div>
  );
}

function formatCardNumber(v) { return v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim(); }

/* ---- LIPA: scan-to-pay with manual TIPS fallback, merged into one flow ---- */

function LipaSheet({ t, open, onClose, categoryIdByName, refreshCardAndTransactions, kycVerified, setKycVerified, resolveFn, payFn, onSuccess }) {
  const resolve = resolveFn || api.cards.resolveLipa;
  const pay = payFn || api.cards.payLipa;
  const [phase, setPhase] = useState("scan"); // scan | manual | confirm | kyc | success
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [tipsNumber, setTipsNumber] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const receiptId = useRef(shortId());

  useEffect(() => {
    if (open) {
      setPhase("scan"); setMerchant(""); setAmount(""); setTipsNumber(""); setError(""); receiptId.current = shortId();
      const timer = setTimeout(async () => {
        // Simulates a scanned QR resolving to a till number, then asks the
        // real TIPS-rail endpoint (mocked server-side today) who it belongs to.
        const till = `07${Math.floor(10000000 + Math.random() * 89999999)}`;
        setTipsNumber(till);
        setAmount((8000 + Math.random() * 40000).toFixed(0));
        try {
          const recipient = await resolve(till);
          setMerchant(recipient.name);
        } catch {
          setMerchant("Merchant");
        }
        setPhase("confirm");
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const goManual = () => setPhase("manual");
  const lookUpTips = async () => {
    if (!tipsNumber || !amount) return;
    setError("");
    try {
      const recipient = await resolve(tipsNumber);
      setMerchant(recipient.name);
      setPhase("confirm");
    } catch (err) {
      setError(err.message || "Couldn't resolve that number.");
    }
  };
  const amt = parseFloat(amount) || 0;

  const finalizePay = async () => {
    setProcessing(true); setError("");
    try {
      const categoryId = categoryIdByName["Shopping"] || Object.values(categoryIdByName)[0];
      const result = await pay(tipsNumber, amt, categoryId);
      if (refreshCardAndTransactions) await refreshCardAndTransactions();
      if (onSuccess) await onSuccess(result);
      setPhase("success");
    } catch (err) {
      setError(err.message || "Payment failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };
  const doPay = () => { if (amt > KYC_THRESHOLD && !kycVerified) setPhase("kyc"); else finalizePay(); };
  const verifyCode = `VC-${Math.abs(hashCode(receiptId.current)).toString(16).toUpperCase().slice(0, 6)}`;

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Lipa" onBack={phase === "manual" ? () => setPhase("scan") : phase === "confirm" && tipsNumber ? () => setPhase("manual") : undefined}>
      {phase === "scan" && (
        <div className="flex flex-col items-center py-8">
          <div className="w-48 h-48 rounded-[20px] relative flex items-center justify-center mb-5" style={{ background: t.bgSoft, border: `2px dashed ${t.border}` }}>
            <QrCode size={70} color={t.inkFaint} />
            <div className="absolute inset-3 rounded-[14px]" style={{ border: `2px solid ${t.accent}`, animation: "pulse 1.4s ease-in-out infinite" }} />
          </div>
          <p className="text-[13px] font-medium mb-3" style={{ color: t.inkSoft }}>Point your camera at a merchant QR code…</p>
          <button onClick={goManual} className="text-[13px] font-semibold" style={{ color: t.accent }}>Can't scan? Enter number manually</button>
        </div>
      )}
      {phase === "manual" && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Enter a TIPS till or phone number to pay any merchant.</p>
          <Field t={t} label="TIPS number (till or phone)"><input style={inputStyle(t)} placeholder="e.g. 0712 345 678" value={tipsNumber} onChange={(e) => setTipsNumber(e.target.value)} /></Field>
          <Field t={t} label="Amount (TZS)">
            <input style={inputStyle(t)} type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <CurrencyEquivalentHint t={t} amountTZS={amount} />
          </Field>
          {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={lookUpTips} disabled={!tipsNumber || !amount}>Continue</PrimaryButton>
        </div>
      )}
      {phase === "confirm" && (
        <div>
          <div className="flex items-center gap-3 p-4 rounded-[16px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: t.accentSoft }}><ShieldCheck size={18} color={t.good} /></div>
            <div><p className="text-[11.5px]" style={{ color: t.inkFaint }}>Resolved recipient</p><p className="text-[14.5px] font-bold" style={{ color: t.ink }}>{merchant}</p><p className="text-[11.5px]" style={{ color: t.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>{tipsNumber}</p></div>
          </div>
          <Field t={t} label="Amount (TZS)">
            <input style={inputStyle(t)} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <CurrencyEquivalentHint t={t} amountTZS={amount} />
          </Field>
          {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={doPay} disabled={processing}>{processing ? "Paying…" : `Pay ${fmtTZSBase(-Math.abs(amt))}`}</PrimaryButton>
        </div>
      )}
      {phase === "kyc" && <KycStep t={t} amount={amt} onVerified={() => { setKycVerified(true); finalizePay(); }} />}
      {phase === "success" && <PaySuccess t={t} title="Payment successful" amount={amt} sublabel={`Paid to ${merchant}`} shareText={`MitaPesa Receipt\nMerchant: ${merchant}\nAmount: ${fmt(-Math.abs(amt))}\nReceipt ID: ${receiptId.current}\nVerification code: ${verifyCode}`} receiptId={receiptId.current} verifyCode={verifyCode} onDone={onClose} />}
    </BottomSheet>
  );
}

function GepgPaySheet({ t, open, onClose, categoryIdByName, refreshCardAndTransactions, kycVerified, setKycVerified, payFn, onSuccess }) {
  const pay = payFn || api.cards.payGepg;
  const [step, setStep] = useState(0);
  const [control, setControl] = useState("");
  const [bill, setBill] = useState(null);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const receiptId = useRef(shortId());

  const reset = () => { setStep(0); setControl(""); setBill(null); setError(""); };
  const checkBill = () => { if (control.length < 6) return; setBill(resolveGepg(control)); receiptId.current = shortId(); setStep(1); };
  const verifyCode = `VC-${Math.abs(hashCode(receiptId.current)).toString(16).toUpperCase().slice(0, 6)}`;

  const finalizePay = async () => {
    setProcessing(true); setError("");
    try {
      const categoryId = categoryIdByName["Other"] || Object.values(categoryIdByName)[0];
      const result = await pay(control, bill.amount, bill.biller, categoryId);
      if (refreshCardAndTransactions) await refreshCardAndTransactions();
      if (onSuccess) await onSuccess(result);
      setStep(2);
    } catch (err) {
      setError(err.message || "Payment failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };
  const confirmPay = () => { if (bill.amount > KYC_THRESHOLD && !kycVerified) setStep("kyc"); else finalizePay(); };

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="Pay government · GePG" onBack={step === 1 ? () => setStep(0) : undefined}>
      {step === 0 && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Enter your GePG Control Number to look up and settle a government bill.</p>
          <Field t={t} label="GePG control number"><input style={inputStyle(t)} placeholder="e.g. 991234567" value={control} onChange={(e) => setControl(e.target.value.replace(/\D/g, ""))} maxLength={10} /></Field>
          <PrimaryButton t={t} onClick={checkBill} disabled={control.length < 6} tone={t.gold}>Check bill</PrimaryButton>
        </div>
      )}
      {step === 1 && bill && (
        <div>
          <div className="p-4 rounded-[16px] mb-4" style={{ background: t.goldSoft, border: `1px solid ${t.border}` }}>
            <div className="flex items-center gap-2 mb-1"><Landmark size={15} color={t.gold} /><p className="text-[11.5px]" style={{ color: t.inkFaint }}>Control No. {control}</p></div>
            <p className="text-[15px] font-bold" style={{ color: t.ink }}>{bill.biller}</p>
            <p className="text-[11px] mt-2" style={{ color: t.inkFaint }}>Amount (TZS)</p>
            <p className="text-[22px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZSBase(bill.amount)}</p>
            <CurrencyEquivalentHint t={t} amountTZS={bill.amount} />
          </div>
          {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={confirmPay} tone={t.gold} disabled={processing}>{processing ? "Paying…" : "Pay now"}</PrimaryButton>
        </div>
      )}
      {step === "kyc" && bill && <KycStep t={t} amount={bill.amount} onVerified={() => { setKycVerified(true); finalizePay(); }} />}
      {step === 2 && <PaySuccess t={t} icon={Receipt} title="Bill paid" amount={bill.amount} sublabel={bill.biller} shareText={`MitaPesa Receipt\nBiller: ${bill.biller}\nAmount: ${fmt(-Math.abs(bill.amount))}\nReceipt ID: ${receiptId.current}\nVerification code: ${verifyCode}`} receiptId={receiptId.current} verifyCode={verifyCode} onDone={() => { onClose(); reset(); }} />}
    </BottomSheet>
  );
}

function LukuPaySheet({ t, open, onClose, categoryIdByName, refreshCardAndTransactions, kycVerified, setKycVerified, payFn, onSuccess }) {
  const pay = payFn || api.cards.payLuku;
  const [step, setStep] = useState(0);
  const [meter, setMeter] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const receiptId = useRef(shortId());

  const reset = () => { setStep(0); setMeter(""); setAmount(""); setToken(""); setError(""); };
  const unitPrice = 0.35;
  const units = amount ? (parseFloat(amount) / unitPrice).toFixed(1) : "0.0";
  const amt = parseFloat(amount) || 0;
  const goConfirm = () => { if (meter.length < 6 || !amount) return; setStep(1); };
  const verifyCode = `VC-${Math.abs(hashCode(receiptId.current)).toString(16).toUpperCase().slice(0, 6)}`;

  const finalizePurchase = async () => {
    setProcessing(true); setError("");
    try {
      const categoryId = categoryIdByName["Housing & Utilities"] || Object.values(categoryIdByName)[0];
      const result = await pay(meter, amt, categoryId);
      setToken(result.token);
      receiptId.current = shortId();
      if (refreshCardAndTransactions) await refreshCardAndTransactions();
      if (onSuccess) await onSuccess(result);
      setStep(2);
    } catch (err) {
      setError(err.message || "Purchase failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };
  const confirmBuy = () => { if (amt > KYC_THRESHOLD && !kycVerified) setStep("kyc"); else finalizePurchase(); };

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="Pay electricity · LUKU" onBack={step === 1 ? () => setStep(0) : undefined}>
      {step === 0 && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Buy prepaid electricity units for a LUKU meter number.</p>
          <Field t={t} label="Meter number"><input style={inputStyle(t)} placeholder="e.g. 01234567891" value={meter} onChange={(e) => setMeter(e.target.value.replace(/\D/g, ""))} maxLength={11} /></Field>
          <Field t={t} label="Amount (TZS)">
            <input style={inputStyle(t)} type="number" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <CurrencyEquivalentHint t={t} amountTZS={amount} />
          </Field>
          <p className="text-[12px] mb-4" style={{ color: t.inkFaint }}>Estimated units: <span style={{ color: t.ink, fontWeight: 600 }}>{units} kWh</span></p>
          <PrimaryButton t={t} onClick={goConfirm} disabled={meter.length < 6 || !amount} tone="#4A8C8C">Continue</PrimaryButton>
        </div>
      )}
      {step === 1 && (
        <div>
          <div className="p-4 rounded-[16px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
            <div className="flex items-center gap-2 mb-1"><Zap size={15} color="#4A8C8C" /><p className="text-[11.5px]" style={{ color: t.inkFaint }}>Meter {meter}</p></div>
            <p className="text-[11px] mt-1" style={{ color: t.inkFaint }}>Amount (TZS)</p>
            <p className="text-[22px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZSBase(parseFloat(amount))}</p>
            <CurrencyEquivalentHint t={t} amountTZS={amount} />
            <p className="text-[12.5px] mt-1" style={{ color: t.inkFaint }}>≈ {units} kWh</p>
          </div>
          {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={confirmBuy} tone="#4A8C8C" disabled={processing}>{processing ? "Buying…" : "Confirm & buy token"}</PrimaryButton>
        </div>
      )}
      {step === "kyc" && <KycStep t={t} amount={amt} onVerified={() => { setKycVerified(true); finalizePurchase(); }} />}
      {step === 2 && (
        <PaySuccess t={t} icon={Zap} title="Token generated" amount={amt} sublabel={`${units} kWh · Meter ${meter}`}
          shareText={`MitaPesa Receipt\nLUKU Meter: ${meter}\nAmount: ${fmt(-Math.abs(amt))}\nToken: ${token}\nReceipt ID: ${receiptId.current}\nVerification code: ${verifyCode}`}
          receiptId={receiptId.current} verifyCode={verifyCode}
          extra={<div className="mt-3 px-4 py-2.5 rounded-[12px] w-full" style={{ background: t.bgSoft, border: `1px dashed ${t.border}` }}><p className="text-[10.5px] uppercase tracking-wide mb-1" style={{ color: t.inkFaint }}>Token</p><p className="text-[15px] font-bold tracking-wider" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{token}</p></div>}
          onDone={() => { onClose(); reset(); }} />
      )}
    </BottomSheet>
  );
}

/* ---- Top up: menu -> Card gateway / Visa OCT / Receive via merchant QR ---- */

function TopUpMenuSheet({ t, open, onClose, onNavigate }) {
  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Top up card">
      <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Choose how you'd like to add funds.</p>
      <MenuOption t={t} icon={CreditCard} title="Card payment gateway" sub="Pay with any Visa/Mastercard online" color={t.accent} onClick={() => onNavigate("topup-gateway")} />
      <MenuOption t={t} icon={ArrowDownCircle} title="Visa OCT" sub="Instant push from a Visa card" color="#1A5C97" onClick={() => onNavigate("topup-oct")} />
      <MenuOption t={t} icon={QrCode} title="Receive via merchant QR / number" sub="Let someone else pay you in" color={t.gold} onClick={() => onNavigate("topup-receive")} />
    </BottomSheet>
  );
}

function TopUpGatewaySheet({ t, open, onClose, cardBalance, refreshCardAndTransactions, kycVerified, setKycVerified }) {
  const [step, setStep] = useState(0);
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  const reset = () => { setStep(0); setCardNumber(""); setExpiry(""); setCvv(""); setAmount(""); setError(""); };
  const digits = cardNumber.replace(/\D/g, "");
  const valid = digits.length === 16 && /^\d{2}\/\d{2}$/.test(expiry) && cvv.length === 3 && parseFloat(amount) > 0;
  const amt = parseFloat(amount) || 0;

  const finalize = async () => {
    setProcessing(true); setError("");
    try {
      // Placeholder: sending the raw digits as the "payment token" since no
      // real Visa/processor-hosted card field exists yet. Once that
      // partnership lands, this must become a single-use token from the
      // hosted field — the raw PAN must never reach this backend for real.
      await api.cards.topupGateway(digits, amt);
      await refreshCardAndTransactions();
      setStep(2);
    } catch (err) {
      setError(err.message || "Top-up failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };
  const confirm = () => { if (amt > KYC_THRESHOLD && !kycVerified) setStep("kyc"); else finalize(); };

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="Card payment gateway" onBack={step === 1 ? () => setStep(0) : undefined}>
      {step === 0 && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Load funds instantly through the payment gateway using any debit or credit card.</p>
          <Field t={t} label="Card number"><input style={inputStyle(t)} placeholder="0000 0000 0000 0000" value={cardNumber} onChange={(e) => setCardNumber(formatCardNumber(e.target.value))} /></Field>
          <div className="flex gap-2">
            <Field t={t} label="Expiry"><input style={inputStyle(t)} placeholder="MM/YY" value={expiry} onChange={(e) => { let v = e.target.value.replace(/\D/g, "").slice(0, 4); if (v.length > 2) v = `${v.slice(0, 2)}/${v.slice(2)}`; setExpiry(v); }} /></Field>
            <Field t={t} label="CVV"><input style={inputStyle(t)} placeholder="000" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 3))} /></Field>
          </div>
          <Field t={t} label="Amount (TZS)"><input style={inputStyle(t)} type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <PrimaryButton t={t} onClick={() => setStep(1)} disabled={!valid}>Continue</PrimaryButton>
        </div>
      )}
      {step === 1 && (
        <div>
          <div className="p-4 rounded-[16px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><p className="text-[12px]" style={{ color: t.inkFaint }}>Loading from •••• {digits.slice(-4)}</p><p className="text-[22px] font-bold mt-1" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(amt)}</p></div>
          {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={confirm} disabled={processing}>{processing ? "Loading funds…" : "Load funds"}</PrimaryButton>
        </div>
      )}
      {step === "kyc" && <KycStep t={t} amount={amt} onVerified={() => { setKycVerified(true); finalize(); }} />}
      {step === 2 && <CardSuccess t={t} icon={ArrowDownCircle} title="Funds added" amountLabel={`+${fmtTZS(amt)}`} amountColor={t.good} sublabel={`New balance ${fmtTZS(cardBalance)}`} onDone={() => { onClose(); reset(); }} />}
    </BottomSheet>
  );
}

function VisaOctSheet({ t, open, onClose, cardBalance, refreshCardAndTransactions, kycVerified, setKycVerified }) {
  const [step, setStep] = useState(0);
  const [cardNumber, setCardNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const reset = () => { setStep(0); setCardNumber(""); setAmount(""); setError(""); };
  const digits = cardNumber.replace(/\D/g, "");
  const valid = digits.length === 16 && parseFloat(amount) > 0;
  const amt = parseFloat(amount) || 0;

  const finalize = async () => {
    setProcessing(true); setError("");
    try {
      // Same placeholder caveat as the gateway top-up: raw digits stand in
      // for a real Visa-hosted payment token until that integration exists.
      await api.cards.topupOct(digits, amt);
      await refreshCardAndTransactions();
      setStep(2);
    } catch (err) {
      setError(err.message || "Pull failed. Please try again.");
    } finally {
      setProcessing(false);
    }
  };
  const confirm = () => { if (amt > KYC_THRESHOLD && !kycVerified) setStep("kyc"); else finalize(); };

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="Visa OCT" onBack={step === 1 ? () => setStep(0) : undefined}>
      {step === 0 && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Instantly push money from any Visa card into your MitaPesa card using Visa's Original Credit Transaction (OCT) rails.</p>
          <Field t={t} label="Visa card number"><input style={inputStyle(t)} placeholder="4000 0000 0000 0000" value={cardNumber} onChange={(e) => setCardNumber(formatCardNumber(e.target.value))} /></Field>
          <Field t={t} label="Amount (TZS)"><input style={inputStyle(t)} type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <PrimaryButton t={t} onClick={() => setStep(1)} disabled={!valid} tone="#1A5C97">Continue</PrimaryButton>
        </div>
      )}
      {step === 1 && (
        <div>
          <div className="p-4 rounded-[16px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><p className="text-[12px]" style={{ color: t.inkFaint }}>Pulling from Visa •••• {digits.slice(-4)}</p><p className="text-[22px] font-bold mt-1" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(amt)}</p></div>
          {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={confirm} tone="#1A5C97" disabled={processing}>{processing ? "Pulling funds…" : "Pull funds now"}</PrimaryButton>
        </div>
      )}
      {step === "kyc" && <KycStep t={t} amount={amt} onVerified={() => { setKycVerified(true); finalize(); }} />}
      {step === 2 && <CardSuccess t={t} icon={ArrowDownCircle} title="Funds pulled" amountLabel={`+${fmtTZS(amt)}`} amountColor={t.good} sublabel={`New balance ${fmtTZS(cardBalance)}`} onDone={() => { onClose(); reset(); }} />}
    </BottomSheet>
  );
}

function ReceiveSheet({ t, open, onClose, cardBalance, setCardBalance, addActivity, kycVerified, setKycVerified }) {
  const [step, setStep] = useState("show");
  const [copied, setCopied] = useState(false);
  const [incomingAmt, setIncomingAmt] = useState(0);
  const merchantNumber = useRef(`PSM-${Math.abs(hashCode(uid())).toString().slice(0, 6)}`);

  const reset = () => { setStep("show"); setCopied(false); setIncomingAmt(0); };
  const copy = () => { setCopied(true); setTimeout(() => setCopied(false), 1600); };
  const finalize = (amt) => { setCardBalance((b) => b + amt); addActivity({ id: uid(), type: "receive", amount: amt, label: "Received via merchant QR", sub: merchantNumber.current, date: new Date().toISOString().slice(0, 10) }); setStep("done"); };
  const simulate = () => {
    const amt = Math.round((15000 + Math.random() * 105000) / 500) * 500;
    setIncomingAmt(amt);
    if (amt > KYC_THRESHOLD && !kycVerified) setStep("kyc"); else finalize(amt);
  };

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="Receive money">
      {step === "show" && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Share this code so anyone can pay directly into your MitaPesa card.</p>
          <div className="flex flex-col items-center py-6 mb-4 rounded-[18px]" style={{ background: t.bgSoft, border: `1px dashed ${t.border}` }}>
            <QrCode size={96} color={t.ink} />
            <p className="text-[19px] font-bold tracking-widest mt-3" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{merchantNumber.current}</p>
          </div>
          <div className="flex gap-2 mb-4">
            <button onClick={copy} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy number</>}</button>
            <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent("Pay me on MitaPesa: " + merchantNumber.current)}`, "_blank")} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold flex items-center justify-center gap-1.5" style={{ background: "#25D366", color: "#fff" }}><MessageCircle size={14} /> Share</button>
          </div>
          <PrimaryButton t={t} onClick={simulate}>Simulate a test payment received</PrimaryButton>
        </div>
      )}
      {step === "kyc" && <KycStep t={t} amount={incomingAmt} onVerified={() => { setKycVerified(true); finalize(incomingAmt); }} />}
      {step === "done" && <CardSuccess t={t} icon={ArrowDownCircle} title="Payment received" amountLabel={`+${fmtTZS(incomingAmt)}`} amountColor={t.good} sublabel={`New balance ${fmtTZS(cardBalance + incomingAmt)}`} onDone={() => { onClose(); reset(); }} />}
    </BottomSheet>
  );
}

/* ---- Transfer: menu -> within wallet (card-to-card) / to a bank via TIPS ---- */

function TransferMenuSheet({ t, open, onClose, onNavigate }) {
  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Transfer">
      <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Choose where you'd like to send money.</p>
      <MenuOption t={t} icon={ArrowLeftRight} title="Within wallet" sub="Send to another MitaPesa card" color={t.gold} onClick={() => onNavigate("transfer-wallet")} />
      <MenuOption t={t} icon={Landmark} title="To a bank (TIPS)" sub="Any bank in Tanzania" color="#1A5C97" onClick={() => onNavigate("transfer-bank")} />
    </BottomSheet>
  );
}

function WalletTransferSheet({ t, open, onClose, cardBalance, setCardBalance, addActivity, kycVerified, setKycVerified }) {
  const [step, setStep] = useState(0);
  const [cardNumber, setCardNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const receiptId = useRef(shortId());

  const reset = () => { setStep(0); setCardNumber(""); setAmount(""); setName(""); };
  const digits = cardNumber.replace(/\D/g, "");
  const amt = parseFloat(amount) || 0;
  const insufficient = amt > cardBalance;
  const valid = digits.length === 16 && amt > 0 && !insufficient;

  const lookUp = () => { setName(resolveCardHolder(digits)); receiptId.current = shortId(); setStep(1); };
  const finalize = () => { setCardBalance((b) => b - amt); addActivity({ id: uid(), type: "transfer_out", amount: -amt, label: `Sent to ${name}`, sub: `•••• ${digits.slice(-4)}`, date: new Date().toISOString().slice(0, 10) }); setStep(2); };
  const confirm = () => { if (amt > KYC_THRESHOLD && !kycVerified) setStep("kyc"); else finalize(); };
  const verifyCode = `VC-${Math.abs(hashCode(receiptId.current)).toString(16).toUpperCase().slice(0, 6)}`;

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="Within wallet" onBack={step === 1 ? () => setStep(0) : undefined}>
      {step === 0 && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Send money directly to another MitaPesa card, instantly.</p>
          <Field t={t} label="Recipient's card number"><input style={inputStyle(t)} placeholder="0000 0000 0000 0000" value={cardNumber} onChange={(e) => setCardNumber(formatCardNumber(e.target.value))} /></Field>
          <Field t={t} label="Amount (TZS)"><input style={inputStyle(t)} type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          {insufficient && amt > 0 && <p className="text-[12px] mb-3" style={{ color: t.danger }}>That's more than your card balance of {fmtTZS(cardBalance)}. Top up first.</p>}
          <PrimaryButton t={t} onClick={lookUp} disabled={digits.length !== 16 || amt <= 0 || insufficient}>Continue</PrimaryButton>
        </div>
      )}
      {step === 1 && (
        <div>
          <div className="flex items-center gap-3 p-4 rounded-[16px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: t.accentSoft }}><ArrowLeftRight size={18} color={t.good} /></div>
            <div><p className="text-[11.5px]" style={{ color: t.inkFaint }}>Sending to</p><p className="text-[14.5px] font-bold" style={{ color: t.ink }}>{name}</p><p className="text-[11.5px]" style={{ color: t.inkFaint, fontFamily: "'IBM Plex Mono', monospace" }}>•••• {digits.slice(-4)}</p></div>
          </div>
          <PrimaryButton t={t} onClick={confirm}>Send {fmtTZS(amt)}</PrimaryButton>
        </div>
      )}
      {step === "kyc" && <KycStep t={t} amount={amt} onVerified={() => { setKycVerified(true); finalize(); }} />}
      {step === 2 && (
        <CardSuccess t={t} icon={ArrowLeftRight} title="Transfer sent" amountLabel={`-${fmtTZS(amt)}`} amountColor={t.ink} sublabel={`To ${name} · •••• ${digits.slice(-4)}`}
          showShare shareText={`MitaPesa Receipt\nSent to: ${name}\nAmount: ${fmtTZS(amt)}\nReceipt ID: ${receiptId.current}\nVerification code: ${verifyCode}`}
          extra={<ReceiptBlock t={t} receiptId={receiptId.current} verifyCode={verifyCode} />}
          onDone={() => { onClose(); reset(); }} />
      )}
    </BottomSheet>
  );
}

function BankTransferSheet({ t, open, onClose, cardBalance, setCardBalance, addActivity, kycVerified, setKycVerified }) {
  const [step, setStep] = useState(0);
  const [bank, setBank] = useState(BANKS[0]);
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const receiptId = useRef(shortId());

  const reset = () => { setStep(0); setBank(BANKS[0]); setAccount(""); setAmount(""); setName(""); };
  const amt = parseFloat(amount) || 0;
  const insufficient = amt > cardBalance;
  const valid = account.length >= 6 && amt > 0 && !insufficient;

  const lookUp = () => { setName(resolveBankHolder(account)); receiptId.current = shortId(); setStep(1); };
  const finalize = () => { setCardBalance((b) => b - amt); addActivity({ id: uid(), type: "bank_transfer", amount: -amt, label: `Sent to ${name} · ${bank}`, sub: `TIPS · A/C ${account}`, date: new Date().toISOString().slice(0, 10) }); setStep(2); };
  const confirm = () => { if (amt > KYC_THRESHOLD && !kycVerified) setStep("kyc"); else finalize(); };
  const verifyCode = `VC-${Math.abs(hashCode(receiptId.current)).toString(16).toUpperCase().slice(0, 6)}`;

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="Transfer to a bank" onBack={step === 1 ? () => setStep(0) : undefined}>
      {step === 0 && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Send money to any bank account in Tanzania using the TIPS interbank rails.</p>
          <Field t={t} label="Bank">
            <select style={inputStyle(t)} value={bank} onChange={(e) => setBank(e.target.value)}>{BANKS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          </Field>
          <Field t={t} label="Account number"><input style={inputStyle(t)} placeholder="e.g. 0150123456700" value={account} onChange={(e) => setAccount(e.target.value.replace(/\s/g, ""))} /></Field>
          <Field t={t} label="Amount (TZS)"><input style={inputStyle(t)} type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          {insufficient && amt > 0 && <p className="text-[12px] mb-3" style={{ color: t.danger }}>That's more than your card balance of {fmtTZS(cardBalance)}. Top up first.</p>}
          <PrimaryButton t={t} onClick={lookUp} disabled={!valid} tone="#1A5C97">Continue</PrimaryButton>
        </div>
      )}
      {step === 1 && (
        <div>
          <div className="flex items-center gap-3 p-4 rounded-[16px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: t.accentSoft }}><Landmark size={18} color={t.good} /></div>
            <div><p className="text-[11.5px]" style={{ color: t.inkFaint }}>Sending to</p><p className="text-[14.5px] font-bold" style={{ color: t.ink }}>{name}</p><p className="text-[11.5px]" style={{ color: t.inkFaint }}>{bank} · {account}</p></div>
          </div>
          <PrimaryButton t={t} onClick={confirm} tone="#1A5C97">Send {fmtTZS(amt)}</PrimaryButton>
        </div>
      )}
      {step === "kyc" && <KycStep t={t} amount={amt} onVerified={() => { setKycVerified(true); finalize(); }} />}
      {step === 2 && (
        <CardSuccess t={t} icon={Landmark} title="Transfer sent" amountLabel={`-${fmtTZS(amt)}`} amountColor={t.ink} sublabel={`To ${name} · ${bank}`}
          showShare shareText={`MitaPesa Receipt\nSent to: ${name}\nBank: ${bank}\nAmount: ${fmtTZS(amt)}\nReceipt ID: ${receiptId.current}\nVerification code: ${verifyCode}`}
          extra={<ReceiptBlock t={t} receiptId={receiptId.current} verifyCode={verifyCode} />}
          onDone={() => { onClose(); reset(); }} />
      )}
    </BottomSheet>
  );
}

/* ---- AI expense logger (replaces voice investing for this phase) ---- */

function AiExpenseLogSheet({ t, open, onClose, onAdd, categories }) {
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState(categories[0]?.name || "Other");
  const [errorMsg, setErrorMsg] = useState("");

  const reset = () => { setPhase("idle"); setTranscript(""); setAmount(""); setMerchant(""); setCategory(categories[0]?.name || "Other"); setErrorMsg(""); };

  const handleParse = (text) => {
    const { amount: amt, category: cat, merchant: mer } = parseVoiceExpense(text, categories);
    if (!amt) { setErrorMsg("Sorry, I didn't catch an amount — try again."); setPhase("idle"); return; }
    setAmount(String(amt)); setCategory(cat); setMerchant(mer); setPhase("review");
  };

  const startListening = () => {
    setErrorMsg(""); setTranscript(""); setPhase("listening");
    const SpeechRec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRec) {
      // Never fabricate a fake transcript here — this used to silently
      // pick a random canned phrase and pretend it heard the customer,
      // which meant an unsupported browser produced a made-up expense
      // with no indication anything was wrong.
      setErrorMsg("Voice input isn't supported on this browser. Please use the regular Add button to log this expense instead.");
      setPhase("idle");
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
      rec.onresult = (e) => { const text = e.results[0][0].transcript; setTranscript(text); handleParse(text); };
      rec.onerror = (e) => {
        const messages = {
          "not-allowed": "Microphone access was denied. Please allow microphone access in your browser settings and try again.",
          "no-speech": "Didn't catch anything — please try again.",
          "audio-capture": "No microphone was found on this device.",
          network: "A network issue interrupted voice recognition. Please try again.",
        };
        setErrorMsg(messages[e.error] || "Voice recognition failed. Please try again or add this expense manually.");
        setPhase("idle");
      };
      rec.start();
    } catch {
      setErrorMsg("Couldn't start voice recognition. Please try again or add this expense manually.");
      setPhase("idle");
    }
  };

  const confirm = () => {
    onAdd({ id: uid(), amount: -Math.abs(parseFloat(amount) || 0), merchant: merchant || "Voice entry", category, date: new Date().toISOString().slice(0, 10), wallet: "personal", loggedBy: "You" });
    setPhase("done");
  };

  return (
    <BottomSheet t={t} open={open} onClose={() => { onClose(); reset(); }} title="AI expense log">
      {phase === "idle" && (
        <div className="flex flex-col items-center py-6 text-center">
          <p className="text-[13px] mb-6" style={{ color: t.inkFaint }}>Tap the mic and say something like "I spent 12 on lunch." It'll log straight to your Ledger.</p>
          <button onClick={startListening} className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "#7C6BAE" }}><Mic size={30} color="#fff" /></button>
          {errorMsg && <p className="text-[12.5px] mt-4" style={{ color: t.danger }}>{errorMsg}</p>}
        </div>
      )}
      {phase === "listening" && (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="relative w-20 h-20 flex items-center justify-center mb-4">
            <div className="absolute inset-0 rounded-full" style={{ background: "#EAE4F7", animation: "pulse 1.1s ease-in-out infinite" }} />
            <div className="relative w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "#7C6BAE" }}><Mic size={30} color="#fff" /></div>
          </div>
          <p className="text-[13px] font-medium" style={{ color: t.inkSoft }}>Listening…</p>
        </div>
      )}
      {phase === "review" && (
        <div>
          <div className="p-3.5 rounded-[14px] mb-4" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}><p className="text-[12.5px] italic" style={{ color: t.inkSoft }}>“{transcript}”</p></div>
          <Field t={t} label="Amount (TZS)">
            <input style={inputStyle(t)} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <CurrencyEquivalentHint t={t} amountTZS={amount} />
          </Field>
          <Field t={t} label="Merchant"><input style={inputStyle(t)} value={merchant} onChange={(e) => setMerchant(e.target.value)} /></Field>
          <Field t={t} label="Category"><select style={inputStyle(t)} value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></Field>
          <div className="flex gap-2">
            <button onClick={startListening} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>Try again</button>
            <button onClick={confirm} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: "#7C6BAE", color: "#fff" }}>Add to ledger</button>
          </div>
        </div>
      )}
      {phase === "done" && <CardSuccess t={t} icon={Check} title="Added to ledger" amountLabel={fmt(-Math.abs(parseFloat(amount) || 0))} sublabel={`${merchant} · ${category}`} onDone={() => { onClose(); reset(); }} />}
    </BottomSheet>
  );
}

/* ---- Pay page ---- */

// "Wallet Stacked Card View": overlapping cards, drop-shadow depth hierarchy,
// drag-up (or tap the handle) to fan the stack out, tap any card to bring it
// to focus. Selection ("card in focus") always renders at the front/top —
// other cards recede behind it, peeking out from below with a real shadow.
// Each card manages its own reveal state independently (not lifted to the
// parent carousel) — different cards must never share whether their
// details are currently shown, and this keeps that concern local rather
// than tracked in an array at the parent level.
function CarouselCardFace({ t, c, balanceHidden, onToggleBalanceHidden, onSelect }) {
  const [revealed, setRevealed] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState("");

  const toggleReveal = async (e) => {
    e.stopPropagation();
    if (revealed) { setRevealed(null); return; }
    if (!c.revealFn) return;
    setRevealing(true); setRevealError("");
    try { setRevealed(await c.revealFn()); }
    catch (err) { setRevealError(err.message || "Couldn't load card details."); }
    finally { setRevealing(false); }
  };

  const formattedNumber = revealed ? revealed.fullNumber.replace(/(.{4})/g, "$1 ").trim() : `•••• •••• •••• ${c.last4 || "····"}`;

  return (
    <div
      onClick={() => onSelect(c.id)}
      className="relative shrink-0 rounded-[24px] p-5 cursor-pointer overflow-hidden flex flex-col"
      style={{
        width: "100%",
        height: 240,
        scrollSnapAlign: "center",
        background: c.terminated ? t.bgSoft : `linear-gradient(135deg, ${c.gradientFrom}, ${c.gradientTo})`,
        border: c.terminated ? `1px solid ${t.border}` : "none",
        boxShadow: "0 14px 28px rgba(0,0,0,0.18)",
      }}
    >
      {!c.terminated && (
        <>
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.08)" }} />
          <div className="absolute -right-2 top-14 w-24 h-24 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.06)" }} />
        </>
      )}

      <div className="relative flex items-center justify-between mb-4">
        <div className="w-9 h-6 rounded-[6px] flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #EEDFA8, #C9AA5C)" }}>
          <div className="w-5 h-3.5 rounded-[3px]" style={{ border: "1px solid rgba(0,0,0,0.28)" }} />
        </div>
        <div className="flex items-center gap-1.5">
          {c.frozen && !c.terminated && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)", color: "#fff" }}>FROZEN</span>}
          {c.badge && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: c.terminated ? t.dangerSoft : "rgba(255,255,255,0.25)", color: c.terminated ? t.danger : "#fff" }}>{c.badge}</span>}
          {c.revealFn && !c.terminated && (
            <button onClick={toggleReveal} disabled={revealing} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.18)" }} aria-label={revealed ? "Hide card details" : "View card details"}>
              {revealing ? <RefreshCw size={12} color="#fff" className="animate-spin" /> : revealed ? <EyeOff size={12} color="#fff" /> : <Eye size={12} color="#fff" />}
            </button>
          )}
        </div>
      </div>

      <p className="relative text-[16px] font-semibold tracking-[1.5px] mb-1" style={{ color: c.terminated ? t.inkFaint : "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>
        {formattedNumber}
      </p>
      <p className="relative text-[10.5px] mb-3 truncate" style={{ color: c.terminated ? t.inkFaint : "rgba(255,255,255,0.7)" }}>{c.sublabel}</p>

      {revealError && <p className="relative text-[10px] mb-2" style={{ color: "#FCA5A5" }}>{revealError}</p>}

      {c.revealFn && !c.terminated && (
        <div className="relative flex items-center gap-5 mb-3">
          <div>
            <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>Expires</p>
            <p className="text-[12.5px] font-semibold" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{revealed ? revealed.expiry : "••/••"}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>CVV</p>
            <p className="text-[12.5px] font-semibold" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{revealed ? revealed.cvv : "•••"}</p>
          </div>
        </div>
      )}

      <div className="relative flex items-end justify-between mt-auto">
        <div className="min-w-0 mr-3">
          <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: c.terminated ? t.inkFaint : "rgba(255,255,255,0.65)" }}>Card holder</p>
          <p className="text-[12.5px] font-semibold truncate" style={{ color: c.terminated ? t.inkFaint : "#fff" }}>{c.label}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <p className="text-[17px] font-bold" style={{ color: c.terminated ? t.ink : "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>
            {balanceHidden ? "•••••••" : fmtTZS(c.balance)}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleBalanceHidden(); }}
            className="p-1 rounded-full shrink-0"
            aria-label={balanceHidden ? "Show balance" : "Hide balance"}
          >
            {balanceHidden ? <EyeOff size={14} color={c.terminated ? t.inkFaint : "rgba(255,255,255,0.75)"} /> : <Eye size={14} color={c.terminated ? t.inkFaint : "rgba(255,255,255,0.75)"} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function WalletCardCarousel({ t, cards, selectedId, onSelect, balanceHidden, onToggleBalanceHidden }) {
  const scrollRef = useRef(null);
  const isProgrammaticScroll = useRef(false);

  // Keeps the carousel in sync when selectedId changes from outside (e.g.
  // a future "jump to this card" action elsewhere) as well as from the
  // user's own swipe - both directions stay consistent with each other.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = cards.findIndex((c) => c.id === selectedId);
    if (idx === -1) return;
    const card = el.children[idx];
    if (!card) return;
    isProgrammaticScroll.current = true;
    card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    // scrollIntoView doesn't fire a single, reliable "done" event across
    // browsers - a short timeout clears the guard flag rather than
    // leaving it stuck true if a scroll event never fires.
    const clear = setTimeout(() => { isProgrammaticScroll.current = false; }, 400);
    return () => clearTimeout(clear);
  }, [selectedId, cards.length]);

  // Fires on every scroll frame while swiping - finds whichever card is
  // now closest to center and reports it as selected, so the dots and
  // any other "active card" state track the swipe in real time rather
  // than waiting for the swipe gesture to fully end.
  const handleScroll = () => {
    if (isProgrammaticScroll.current) return;
    const el = scrollRef.current;
    if (!el || !cards.length) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let closestIdx = 0, closestDist = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const dist = Math.abs(child.offsetLeft + child.offsetWidth / 2 - center);
      if (dist < closestDist) { closestDist = dist; closestIdx = i; }
    });
    const closest = cards[closestIdx];
    if (closest && closest.id !== selectedId) onSelect(closest.id);
  };

  return (
    <div className="mb-2">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex overflow-x-auto"
        style={{ scrollSnapType: "x mandatory", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
      >
        {cards.map((c) => (
          <div key={c.id} className="shrink-0" style={{ width: "100%", scrollSnapAlign: "center" }}>
            <CarouselCardFace t={t} c={c} balanceHidden={balanceHidden} onToggleBalanceHidden={onToggleBalanceHidden} onSelect={onSelect} />
          </div>
        ))}
      </div>

      {cards.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {cards.map((c) => (
            <div
              key={c.id}
              className="rounded-full transition-all"
              style={{ width: c.id === selectedId ? 16 : 6, height: 6, background: c.id === selectedId ? t.accent : t.border }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// A proper mock card face — chip, masked/revealed PAN, expiry, CVV, holder
// name — instead of a plain balance row. Real digits only ever arrive via
// the /reveal endpoint on demand; nothing sensitive is fetched or rendered
// until the person explicitly asks to see it.
function CardFace({ t, holderName, last4, revealed, revealing, onToggleReveal, gradientFrom, gradientTo }) {
  const formattedNumber = revealed ? revealed.fullNumber.replace(/(.{4})/g, "$1 ").trim() : `•••• •••• •••• ${last4 || "····"}`;
  return (
    <div className="relative p-5 rounded-[24px] mb-4 overflow-hidden" style={{ background: `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`, boxShadow: "0 18px 40px rgba(0,0,0,0.22)" }}>
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.08)" }} />
      <div className="absolute -right-2 top-14 w-24 h-24 rounded-full pointer-events-none" style={{ background: "rgba(255,255,255,0.06)" }} />

      <div className="relative flex items-center justify-between mb-7">
        <div className="w-10 h-7 rounded-[6px] flex items-center justify-center" style={{ background: "linear-gradient(135deg, #EEDFA8, #C9AA5C)" }}>
          <div className="w-6 h-4 rounded-[3px]" style={{ border: "1px solid rgba(0,0,0,0.28)" }} />
        </div>
        <button onClick={onToggleReveal} disabled={revealing} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.18)" }}>
          {revealing ? <RefreshCw size={14} color="#fff" className="animate-spin" /> : revealed ? <EyeOff size={14} color="#fff" /> : <Eye size={14} color="#fff" />}
        </button>
      </div>

      <p className="relative text-[18px] font-semibold tracking-[2px] mb-6" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{formattedNumber}</p>

      <div className="relative flex items-end justify-between">
        <div className="min-w-0 mr-3">
          <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>Card holder</p>
          <p className="text-[13px] font-semibold truncate" style={{ color: "#fff" }}>{holderName}</p>
        </div>
        <div className="flex gap-4 shrink-0">
          <div>
            <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>Expires</p>
            <p className="text-[13px] font-semibold" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{revealed ? revealed.expiry : "••/••"}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wide mb-0.5" style={{ color: "rgba(255,255,255,0.65)" }}>CVV</p>
            <p className="text-[13px] font-semibold" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>{revealed ? revealed.cvv : "•••"}</p>
          </div>
          <p className="text-[15px] font-bold italic self-end" style={{ color: "rgba(255,255,255,0.9)", fontFamily: "'Space Grotesk', sans-serif" }}>MitaPesa</p>
        </div>
      </div>
    </div>
  );
}

// On-demand modal for viewing full card details — used for BOTH the primary
// card and every add-on card, so the nice card-face design and the real
// reveal endpoint are consistent everywhere, without ever growing the
// height of the page itself (this is a sheet, not inline content).
function CardDetailsSheet({ t, open, onClose, holderName, last4, gradientFrom, gradientTo, revealFn }) {
  const [revealed, setRevealed] = useState(null);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (open) { setRevealed(null); setError(""); } }, [open]);

  const toggle = async () => {
    if (revealed) { setRevealed(null); return; }
    setRevealing(true); setError("");
    try { setRevealed(await revealFn()); }
    catch (err) { setError(err.message || "Couldn't load card details."); }
    finally { setRevealing(false); }
  };

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Card details">
      <CardFace t={t} holderName={holderName} last4={last4} revealed={revealed} revealing={revealing} onToggleReveal={toggle} gradientFrom={gradientFrom} gradientTo={gradientTo} />
      {error && <p className="text-[12px] mb-2 text-center" style={{ color: t.danger }}>{error}</p>}
      <p className="text-[11.5px] text-center" style={{ color: t.inkFaint }}>Use these details for online purchases. Never share your CVV with anyone.</p>
    </BottomSheet>
  );
}

function StatementCard({ t, statement, loading, monthLabel, onPrevMonth, onNextMonth, onDownloadCsv, downloadingCsv, csvError }) {
  return (
    <Card t={t} className="p-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={onPrevMonth} className="p-1.5 rounded-full" style={{ background: t.bgSoft }}><ChevronLeft size={15} color={t.inkSoft} /></button>
        <p className="text-[13px] font-semibold" style={{ color: t.ink }}>{monthLabel}</p>
        <button onClick={onNextMonth} className="p-1.5 rounded-full" style={{ background: t.bgSoft }}><ChevronRight size={15} color={t.inkSoft} /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><RefreshCw size={18} className="animate-spin" color={t.accent} /></div>
      ) : !statement ? (
        <p className="text-center text-[13px] py-6" style={{ color: t.inkFaint }}>Couldn't load this statement.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="p-3 rounded-[14px]" style={{ background: t.bgSoft }}><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Opening balance</p><p className="text-[14px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(statement.openingBalance)}</p></div>
            <div className="p-3 rounded-[14px]" style={{ background: t.bgSoft }}><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Closing balance</p><p className="text-[14px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(statement.closingBalance)}</p></div>
            <div className="p-3 rounded-[14px]" style={{ background: t.accentSoft }}><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Total in</p><p className="text-[14px] font-bold" style={{ color: t.good, fontFamily: "'IBM Plex Mono', monospace" }}>+{fmtTZS(statement.totalCredits)}</p></div>
            <div className="p-3 rounded-[14px]" style={{ background: t.dangerSoft }}><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Total out</p><p className="text-[14px] font-bold" style={{ color: t.danger, fontFamily: "'IBM Plex Mono', monospace" }}>-{fmtTZS(statement.totalDebits)}</p></div>
          </div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10.5px]" style={{ color: t.inkFaint }}>Ref {statement.reference} · {statement.entryCount} transaction{statement.entryCount === 1 ? "" : "s"}</p>
            {onDownloadCsv && (
              <button onClick={onDownloadCsv} disabled={downloadingCsv} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: t.accent }}>
                <Download size={12} /> {downloadingCsv ? "Preparing…" : "CSV"}
              </button>
            )}
          </div>
          {csvError && <p className="text-[11.5px] mb-2" style={{ color: t.danger }}>{csvError}</p>}
          <div style={{ borderTop: `1px solid ${t.border}` }}>
            {statement.entries.length ? statement.entries.map((e, i) => (
              <div key={i} className="flex items-center justify-between py-2.5" style={{ borderBottom: `1px solid ${t.border}` }}>
                <div><p className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{e.label}</p><p className="text-[10.5px]" style={{ color: t.inkFaint }}>{new Date(e.date).toLocaleDateString()} · bal {fmtTZS(e.balanceAfter)}</p></div>
                <p className="text-[12.5px] font-semibold" style={{ color: e.amount > 0 ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{e.amount > 0 ? "+" : ""}{fmtTZS(e.amount)}</p>
              </div>
            )) : <p className="text-center text-[12.5px] py-6" style={{ color: t.inkFaint }}>No transactions this month.</p>}
          </div>
        </>
      )}
    </Card>
  );
}

// Requirement: "Authentication using PIN, biometrics or OTP, depending on
// the applicable risk rules." Amounts over KYC_THRESHOLD reuse the existing
// real OTP step-up (KycStep). For amounts at or under it, this tries the
// device's own platform authenticator (Face ID / fingerprint / Windows
// Hello) as a lightweight confirmation gate. Being precise about what this
// is: it proves the device's biometric prompt was satisfied, not a full
// account-bound WebAuthn credential (that needs a one-time registration
// step this app doesn't have yet) — so it's a real device-capability check,
// not a simulated one, just not the strongest possible binding.
// Requirement: "Authentication using PIN, biometrics or OTP, depending on
// the applicable risk rules." Amounts over KYC_THRESHOLD reuse the existing
// real OTP step-up (KycStep) — a regulatory floor that's never skipped.
// Below that, this offers two real options: the account password (via
// /auth/verify-password) or the device's platform authenticator (Face ID /
// fingerprint / Windows Hello). Being precise about what the biometric
// option is: it proves the device's own biometric prompt was satisfied, not
// a full account-bound WebAuthn credential — that needs a one-time
// registration step this app doesn't have yet. A dedicated app PIN is a
// planned addition, not built yet either — password fills that role today.
function StepUpAuthStep({ t, amount, merchantName, onConfirmed, onCancel }) {
  const [mode, setMode] = useState(null); // null | "password" | "biometric-checking" | "biometric"
  const [bioAvailable, setBioAvailable] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const ok = window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
        setBioAvailable(!!ok);
      } catch {
        setBioAvailable(false);
      }
    })();
  }, []);

  const confirmBiometric = async () => {
    setBusy(true); setError("");
    try {
      await navigator.credentials.create({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rp: { name: "MitaPesa" },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "confirm-payment", displayName: "Confirm payment" },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          timeout: 30000,
        },
      });
      onConfirmed("biometric");
    } catch (err) {
      setError("Biometric confirmation was cancelled.");
    } finally {
      setBusy(false);
    }
  };

  const confirmPassword = async () => {
    if (!password) return;
    setBusy(true); setError("");
    try {
      await api.auth.verifyPassword(password);
      onConfirmed("pin"); // "pin" in the backend's authMethod enum stands in for "account credential" until a dedicated PIN exists
    } catch (err) {
      setError(err.message || "Incorrect password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-center py-4">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: t.accentSoft }}>
        <ShieldCheck size={28} color={t.good} />
      </div>
      <p className="text-[14px] font-semibold mb-1" style={{ color: t.ink }}>Confirm this payment</p>
      <p className="text-[12.5px] mb-6" style={{ color: t.inkFaint }}>{fmtTZS(amount)} to {merchantName} — this is larger than your usual, so we need to double check it's you.</p>
      {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}

      {mode === "password" ? (
        <>
          <Field t={t} label="Your account password"><input style={inputStyle(t)} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus /></Field>
          <PrimaryButton t={t} onClick={confirmPassword} disabled={!password || busy}>{busy ? "Checking…" : "Confirm"}</PrimaryButton>
          <button onClick={() => { setMode(null); setPassword(""); setError(""); }} className="text-[12px] font-semibold mt-3" style={{ color: t.inkFaint }}>Back</button>
        </>
      ) : (
        <>
          {bioAvailable && <PrimaryButton t={t} onClick={confirmBiometric} disabled={busy} className="mb-2.5">{busy ? "Waiting…" : "Confirm with Face ID / fingerprint"}</PrimaryButton>}
          <button onClick={() => setMode("password")} className="w-full py-3 rounded-full font-semibold text-[14px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>Use my password instead</button>
          <button onClick={onCancel} className="text-[12px] font-semibold mt-3" style={{ color: t.inkFaint }}>Cancel</button>
        </>
      )}
    </div>
  );
}

function QrPaymentResult({ t, payment, merchant, onDone, onRetry }) {
  const success = payment.status === "completed";
  const pending = payment.status === "processing";
  const failed = payment.status === "failed" || payment.status === "reversed";

  // Success gets exactly the same receipt/WhatsApp-share treatment as
  // every other payment method in the app — this is deliberately just
  // "Lipa," not a separate experience.
  if (success) {
    const receiptId = payment.reference;
    const verifyCode = `VC-${Math.abs(hashCode(receiptId)).toString(16).toUpperCase().slice(0, 6)}`;
    // Same neutral merge as the confirm screen — MitaPesa fee + partner fee
    // combine into one "Charge" component, VAT stays separate.
    const charge = Number(payment.feeAmount || 0) + Number(payment.mitaPesaFeeAmount || 0);
    const vat = Number(payment.taxAmount || 0);
    const totalCharges = charge + vat;
    const hasFee = totalCharges > 0;
    return (
      <PaySuccess
        t={t} title="Payment successful" amount={payment.amount} sublabel={`Paid to ${merchant?.name}`}
        shareText={`MitaPesa Receipt\nMerchant: ${merchant?.name}\nAmount: ${fmt(-Math.abs(payment.amount))}${hasFee ? `\nTotal charges: ${fmtTZS(totalCharges)}` : ""}\nReceipt ID: ${receiptId}\nVerification code: ${verifyCode}\nRouting: ${payment.isOnUs ? "Instant (on-us)" : "Via TIPS"}`}
        receiptId={receiptId} verifyCode={verifyCode} onDone={onDone}
        extra={hasFee && (
          <div className="py-1.5" style={{ borderTop: `1px solid ${t.border}` }}>
            <div className="flex justify-between mb-0.5">
              <span className="text-[11.5px] font-semibold" style={{ color: t.ink }}>Total charges</span>
              <span className="text-[11.5px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(totalCharges)}</span>
            </div>
            <p className="text-[10.5px]" style={{ color: t.inkFaint }}>{[charge > 0 ? `Charge ${fmtTZS(charge)}` : null, vat > 0 ? `VAT ${fmtTZS(vat)}` : null].filter(Boolean).join(", ")}</p>
          </div>
        )}
      />
    );
  }

  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: pending ? t.goldSoft : t.dangerSoft }}>
        {pending ? <RefreshCw size={26} className="animate-spin" color={t.gold} /> : <X size={28} color={t.danger} />}
      </div>
      <p className="text-[16px] font-bold mb-1" style={{ color: t.ink }}>{pending ? "Payment pending" : payment.status === "reversed" ? "Payment reversed" : "Payment failed"}</p>
      <p className="text-[13px] mb-1" style={{ color: t.inkSoft }}>{fmtTZS(payment.amount)} to {merchant?.name}</p>
      {pending && <p className="text-[12px] mb-4 max-w-[260px]" style={{ color: t.inkFaint }}>We're waiting on the final confirmation from the other bank — your balance will update automatically once it clears.</p>}
      {failed && (payment.reversalReason || payment.failureReason) && <p className="text-[12px] mb-4 max-w-[260px]" style={{ color: t.danger }}>{payment.reversalReason || payment.failureReason}</p>}
      {payment.status === "reversed" && <p className="text-[11.5px] mb-4" style={{ color: t.inkFaint }}>Your wallet has been credited back in full.</p>}

      <Card t={t} className="w-full p-4 mb-4 text-left">
        <div className="flex justify-between py-1.5"><span className="text-[11.5px]" style={{ color: t.inkFaint }}>Reference</span><span className="text-[11.5px] font-semibold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{payment.reference}</span></div>
        <div className="flex justify-between py-1.5" style={{ borderTop: `1px solid ${t.border}` }}><span className="text-[11.5px]" style={{ color: t.inkFaint }}>Routing</span><span className="text-[11.5px] font-semibold" style={{ color: t.ink }}>{payment.isOnUs ? "Instant (on-us)" : "Via TIPS"}</span></div>
        <div className="flex justify-between py-1.5" style={{ borderTop: `1px solid ${t.border}` }}><span className="text-[11.5px]" style={{ color: t.inkFaint }}>Date</span><span className="text-[11.5px] font-semibold" style={{ color: t.ink }}>{new Date(payment.createdAt).toLocaleString()}</span></div>
      </Card>

      {failed ? <PrimaryButton t={t} onClick={onRetry}>Try again</PrimaryButton> : <PrimaryButton t={t} onClick={onDone}>Done</PrimaryButton>}
    </div>
  );
}

// The full BOT TANQR / EMVCo customer journey: camera scan (or manual TIPS
// merchant number) → payload validation → merchant confirmation → amount →
// risk-based auth → settlement → receipt. See docs/TANQR_PAYMENT_FLOW.md in
// the backend for the design this implements against. This is what "Lipa"
// means in the app now — real QR scanning, not a simplified stand-in.
function QrPaymentSheet({ t, open, onClose, cardType, cardId, categories, kycVerified, setKycVerified, onSuccess, tr, language }) {
  const [phase, setPhase] = useState("scan"); // scan | confirm | otp | stepup | processing | result
  const [entryMode, setEntryMode] = useState("camera"); // camera | payload | merchant
  const [resolved, setResolved] = useState(null);
  const [payload, setPayload] = useState(null);
  const [aliasMerchantId, setAliasMerchantId] = useState(null);
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState("");
  const [scanError, setScanError] = useState("");
  const [manualPayload, setManualPayload] = useState("");
  const [merchantNumber, setMerchantNumber] = useState("");
  const [samples, setSamples] = useState(null);
  const [publicSettings, setPublicSettings] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (open) {
      setPhase("scan"); setEntryMode("camera"); setResolved(null); setPayload(null); setAliasMerchantId(null);
      setAmount(""); setError(""); setScanError(""); setManualPayload(""); setMerchantNumber(""); setResult(null);
      setCategoryId(categories.find((c) => c.id)?.id || "");
      api.settingsPublic().then(setPublicSettings).catch(() => setPublicSettings({}));
      api.qr.devSamples().then(setSamples).catch(() => setSamples(null));
    }
  }, [open]);

  const testSamplesEnabled = publicSettings?.qr_test_samples_enabled !== "false";
  const manualPayloadEnabled = publicSettings?.qr_manual_payload_paste_enabled !== "false";

  // Live QR scanning via the official Capacitor Barcode Scanner plugin -
  // genuine native camera access with live auto-detection, not the
  // web-level getUserMedia API. That approach proved unreliable inside
  // Capacitor's iOS WebView (navigator.mediaDevices stayed undefined even
  // after the documented secure-context config fix), and a "take one
  // photo, then decode it" fallback wasn't an acceptable experience for
  // what needs to feel instant. This plugin bypasses the WebView's own
  // camera-API limitations entirely by scanning through real native code.
  const startScan = async () => {
    setScanError("");
    setScanning(true);
    try {
      const result = await CapacitorBarcodeScanner.scanBarcode({ hint: CapacitorBarcodeScannerTypeHint.QR_CODE });
      setScanning(false);
      if (result?.ScanResult) {
        resolvePayload(result.ScanResult);
      }
      // No ScanResult and no thrown error means the customer cancelled
      // the scan screen themselves - nothing to show, just let them try
      // again or switch to entering a merchant number instead.
    } catch (err) {
      setScanning(false);
      console.error("QR scan failed:", err?.message); // eslint-disable-line no-console
      setScanError("Couldn't scan that code. Please try again, or enter the merchant number below.");
    }
  };

  const resolvePayload = async (data) => {
    setError(""); setBusy(true);
    try {
      const r = await api.qr.resolve(data);
      setPayload(data); setAliasMerchantId(null);
      setResolved(r);
      if (r.amountFixed) setAmount(String(r.amount));
      setPhase("confirm");
    } catch (err) {
      setScanError(err.message || "Couldn't read that QR code.");
    } finally {
      setBusy(false);
    }
  };

  // Re-resolves via whichever path originally got us to the confirm
  // screen — used after subscribing to a suggested bundle, so the fee
  // display updates to reflect the new coverage without leaving the
  // screen or re-scanning.
  const refreshQuote = async () => {
    if (payload) {
      try { setResolved(await api.qr.resolve(payload)); } catch { /* keep showing the last known quote if this fails */ }
    } else if (aliasMerchantId) {
      try { setResolved(await api.qr.resolveAlias(aliasMerchantId)); } catch { /* keep showing the last known quote if this fails */ }
    }
  };

  const resolveMerchantNumber = async () => {
    if (merchantNumber.length !== 8) return;
    setError(""); setBusy(true);
    try {
      const r = await api.qr.resolveAlias(merchantNumber);
      setAliasMerchantId(merchantNumber); setPayload(null);
      setResolved(r);
      setPhase("confirm");
    } catch (err) {
      setError(err.message || "Couldn't find that merchant number.");
    } finally {
      setBusy(false);
    }
  };

  const amt = parseFloat(amount) || 0;

  const goToAuth = () => {
    if (!amt || amt <= 0) { setError("Enter a valid amount"); return; }
    if (!categoryId) { setError("Select a category"); return; }
    setError("");
    const stepUpThreshold = Number(publicSettings?.qr_step_up_threshold) || 20000;
    if (amt > KYC_THRESHOLD && !kycVerified) {
      setPhase("otp"); // regulatory floor for a not-yet-verified customer — never skipped
    } else if (amt > stepUpThreshold) {
      setPhase("stepup"); // unusual for this customer — confirm identity
    } else {
      finalizePay("none"); // routine amount — no extra friction
    }
  };

  const finalizePay = async (authMethod) => {
    setPhase("processing"); setError("");
    try {
      const body = { cardType, cardId, categoryId, authMethod };
      if (payload) body.payload = payload; else body.aliasMerchantId = aliasMerchantId;
      if (!resolved.amountFixed) body.amount = amt;
      const { payment } = await api.qr.pay(body);
      setResult(payment);
      setPhase("result");
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Payment failed. Please try again.");
      setPhase("confirm");
    }
  };

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Lipa">
      {phase === "scan" && (
        <div>
          <div className="flex p-1 rounded-full mb-4" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
            <button onClick={() => setEntryMode("camera")} className="flex-1 py-2 rounded-full text-[12px] font-semibold" style={{ background: entryMode === "camera" ? t.card : "transparent", color: entryMode === "camera" ? t.ink : t.inkFaint }}>Scan QR</button>
            <button onClick={() => setEntryMode("merchant")} className="flex-1 py-2 rounded-full text-[12px] font-semibold" style={{ background: entryMode === "merchant" ? t.card : "transparent", color: entryMode === "merchant" ? t.ink : t.inkFaint }}>Merchant number</button>
          </div>

          {entryMode === "camera" && (
            <div className="mb-4">
              <button
                onClick={startScan}
                disabled={scanning}
                className="w-full flex flex-col items-center justify-center gap-2 rounded-[20px] py-10"
                style={{ background: t.bgSoft, border: `1.5px dashed ${t.border}`, opacity: scanning ? 0.6 : 1 }}
              >
                <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: t.accentSoft }}>
                  {scanning ? <RefreshCw size={22} color={t.accent} className="animate-spin" /> : <QrCode size={22} color={t.accent} />}
                </div>
                <p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{scanning ? "Opening scanner…" : "Tap to scan a QR code"}</p>
                <p className="text-[11.5px] max-w-[240px] text-center" style={{ color: t.inkFaint }}>Opens your camera — point it at the QR code, it's picked up automatically.</p>
              </button>
              {scanError && <p className="text-[12.5px] mt-3 text-center" style={{ color: t.danger }}>{scanError}</p>}
            </div>
          )}

          {entryMode === "merchant" && (
            <div className="mb-4">
              <p className="text-[12.5px] mb-3" style={{ color: t.inkFaint }}>Enter the merchant's 8-digit TIPS number (found on their till receipt or signage).</p>
              <Field t={t} label="Merchant number"><input style={inputStyle(t)} inputMode="numeric" value={merchantNumber} onChange={(e) => setMerchantNumber(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="00112349" /></Field>
              {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}
              <PrimaryButton t={t} onClick={resolveMerchantNumber} disabled={merchantNumber.length !== 8 || busy}>{busy ? "Looking up…" : "Continue"}</PrimaryButton>
            </div>
          )}

          {entryMode === "camera" && manualPayloadEnabled && (
            <>
              <Field t={t} label="Or paste a QR payload"><input style={inputStyle(t)} value={manualPayload} onChange={(e) => setManualPayload(e.target.value)} placeholder="00020101..." /></Field>
              <PrimaryButton t={t} onClick={() => manualPayload.trim() && resolvePayload(manualPayload.trim())} disabled={!manualPayload.trim() || busy}>{busy ? "Reading…" : "Use this code"}</PrimaryButton>
            </>
          )}

          {testSamplesEnabled && samples && (
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${t.border}` }}>
              <p className="text-[11px] font-semibold mb-2" style={{ color: t.inkFaint }}>Test payments (no real bank connected yet)</p>
              <div className="flex gap-2">
                <button onClick={() => resolvePayload(samples.onUs.payload)} disabled={busy} className="flex-1 py-2.5 rounded-full text-[12px] font-semibold" style={{ background: t.accentSoft, color: t.good }}>On-us sample</button>
                <button onClick={() => resolvePayload(samples.offUs.payload)} disabled={busy} className="flex-1 py-2.5 rounded-full text-[12px] font-semibold" style={{ background: t.goldSoft, color: t.gold }}>Off-us sample</button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "confirm" && resolved && (
        <div>
          <div className="p-4 rounded-[18px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[15px] font-bold" style={{ color: t.ink }}>{resolved.merchant.name}</p>
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ml-2" style={{ background: resolved.isOnUs ? t.accentSoft : t.goldSoft, color: resolved.isOnUs ? t.good : t.gold }}>{resolved.isOnUs ? "Instant" : "via TIPS"}</span>
            </div>
            {resolved.merchant.city && <p className="text-[12.5px]" style={{ color: t.inkFaint }}>{resolved.merchant.city}</p>}
          </div>

          {resolved.amountFixed ? (
            <div className="text-center py-3 mb-4">
              <p className="text-[12px]" style={{ color: t.inkFaint }}>Amount to pay (TZS)</p>
              <p className="text-[28px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{fmtTZSBase(amt)}</p>
              <CurrencyEquivalentHint t={t} amountTZS={amt} />
            </div>
          ) : (
            <Field t={t} label="Amount (TZS)">
              <input style={inputStyle(t)} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoFocus />
              <CurrencyEquivalentHint t={t} amountTZS={amount} />
            </Field>
          )}
          <Field t={t} label="Category">
            <select style={inputStyle(t)} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categories.filter((c) => c.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          {resolved.fee && amt > 0 && (() => {
            const breakdown = getFeeBreakdown(resolved.fee, amt, language);
            const view = getCustomerChargesView(breakdown);
            return (
              <div className="p-3.5 rounded-[14px] mb-4" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
                {!view.transfersEnabled ? (
                  <ChargesLine t={t} view={view} tr={tr} />
                ) : (
                  <>
                    <div className="flex justify-between mb-1"><span className="text-[12px]" style={{ color: t.inkFaint }}>{tr("feeAmount")}</span><span className="text-[12px] font-semibold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZSBase(amt)}</span></div>
                    <ChargesLine t={t} view={view} tr={tr} />
                    <div className="flex justify-between pt-1.5 mt-1" style={{ borderTop: `1px solid ${t.border}` }}><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{tr("feeTotalAmount")}</span><span className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZSBase(amt + view.totalCharges)}</span></div>
                  </>
                )}
              </div>
            );
          })()}

          {resolved.fee?.suggestedBundle && amt > 0 && (
            <BundleUpsellCard t={t} bundle={resolved.fee.suggestedBundle} onSubscribed={refreshQuote} />
          )}

          {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={goToAuth} disabled={resolved.fee && !getCustomerChargesView(getFeeBreakdown(resolved.fee, amt, language)).transfersEnabled}>Continue</PrimaryButton>
        </div>
      )}

      {phase === "otp" && <KycStep t={t} amount={amt} onVerified={() => { setKycVerified(true); finalizePay("otp"); }} />}
      {phase === "stepup" && <StepUpAuthStep t={t} amount={amt} merchantName={resolved?.merchant?.name} onConfirmed={(method) => finalizePay(method)} onCancel={() => setPhase("confirm")} />}

      {phase === "processing" && (
        <div className="flex flex-col items-center py-14">
          <RefreshCw size={28} className="animate-spin" color={t.accent} />
          <p className="text-[13px] font-semibold mt-4" style={{ color: t.ink }}>Processing your payment…</p>
          <p className="text-[11.5px] mt-1" style={{ color: t.inkFaint }}>{resolved?.isOnUs ? "Settling with the merchant's bank" : "Routing through TIPS"}</p>
        </div>
      )}

      {phase === "result" && result && <QrPaymentResult t={t} payment={result} merchant={resolved?.merchant} onDone={onClose} onRetry={() => setPhase("scan")} />}
    </BottomSheet>
  );
}

function PayComingSoonPage({ t }) {
  return (
    <div className="p-4 pb-24 flex flex-col items-center text-center pt-16">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: t.cardSoft }}><CreditCard size={26} color={t.inkFaint} /></div>
      <p className="text-[15px] font-semibold mb-1.5" style={{ color: t.ink }}>Pay is coming soon</p>
      <p className="text-[13px] max-w-[280px]" style={{ color: t.inkFaint }}>Card payments, QR, Lipa, GePG, and LUKU will unlock here once our banking partner connection is live.</p>
    </div>
  );
}

function PayPage({ t, transactions, categories, categoryIdByName, refreshCardAndTransactions, walletsList, user, cardBalance, setCardBalance, cardLast4, cardActivity, addActivity, cardFrozen, setCardFrozen, cardControls, setCardControls, dailyLimit, setDailyLimit, kycVerified, setKycVerified, tr, language }) {
  const [sheet, setSheet] = useState(null);
  const [subTab, setSubTab] = useState("insights");
  const [balanceHidden, setBalanceHidden] = useState(true); // shared with the "Card balance" row below the stack, so both stay in sync — defaults hidden, standard banking-app privacy convention
  const [statement, setStatement] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementMonth, setStatementMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [csvError, setCsvError] = useState("");
  const downloadStatementCsv = async () => {
    setDownloadingCsv(true); setCsvError("");
    try {
      const { from, to } = monthRange(statementMonth.year, statementMonth.month);
      if (isMain) await api.cards.downloadStatementCsv(from, to);
      else await api.virtualCards.downloadStatementCsv(selectedCardId, from, to);
    } catch (err) {
      setCsvError(err.message || "Couldn't download the statement.");
    } finally {
      setDownloadingCsv(false);
    }
  };
  const holderName = user?.firstName ? `${user.firstName} ${user.lastName ? user.lastName.charAt(0) + "." : ""}`.toUpperCase() : "AMARA N.";

  const monthRange = (year, month) => ({ from: new Date(year, month, 1).toISOString(), to: new Date(year, month + 1, 0, 23, 59, 59).toISOString() });
  const monthLabel = new Date(statementMonth.year, statementMonth.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const shiftMonth = (delta) => setStatementMonth((prev) => { const d = new Date(prev.year, prev.month + delta, 1); return { year: d.getFullYear(), month: d.getMonth() }; });

  // Requirement 6: the carousel. Every add-on card the user owns or holds
  // joins the primary card here — selecting one re-scopes everything below.
  const [virtualCards, setVirtualCards] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState("main");
  const [vcDetail, setVcDetail] = useState(null);
  const [vcActivity, setVcActivity] = useState([]);
  const [vcInsights, setVcInsights] = useState(null);
  const [vcLoading, setVcLoading] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [vcLimitAmt, setVcLimitAmt] = useState("");
  const [airtimeProvider, setAirtimeProvider] = useState("");
  const [airtimeAmt, setAirtimeAmt] = useState("");
  const [airtimeCategory, setAirtimeCategory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.virtualCards.list().then(setVirtualCards).catch(() => {}); }, []);

  const isMain = selectedCardId === "main";
  const sharedWallet = walletsList?.find((w) => w.type === "SHARED");
  const nameFor = (userId) => (userId === user?.id ? "You" : sharedWallet?.members?.find((m) => m.userId === userId)?.user?.firstName || "Member");

  const loadSelectedVc = async () => {
    setVcLoading(true);
    try {
      const [card, activity, insights] = await Promise.all([api.virtualCards.get(selectedCardId), api.virtualCards.activity(selectedCardId), api.virtualCards.insights(selectedCardId)]);
      setVcDetail(card); setVcActivity(activity); setVcInsights(insights); setVcLimitAmt(String(card.dailyLimit));
    } catch (err) {
      console.error("Failed to load add-on card", err); // eslint-disable-line no-console
    } finally {
      setVcLoading(false);
    }
  };
  useEffect(() => {
    if (isMain) { setVcDetail(null); setVcActivity([]); setVcInsights(null); return; }
    setSubTab("insights"); setAirtimeProvider(""); setAirtimeAmt("");
    const defaultCategory = categories.find((c) => c.id)?.id || "";
    setAirtimeCategory(defaultCategory);
    loadSelectedVc();
  }, [selectedCardId]);

  useEffect(() => {
    if (subTab !== "statement") return;
    setStatementLoading(true); setStatement(null);
    const { from, to } = monthRange(statementMonth.year, statementMonth.month);
    const fetcher = isMain ? api.cards.statement(from, to) : api.virtualCards.statement(selectedCardId, from, to);
    fetcher
      .then(setStatement)
      .catch((err) => console.error("Failed to load statement", err)) // eslint-disable-line no-console
      .finally(() => setStatementLoading(false));
  }, [subTab, statementMonth, selectedCardId]);

  const refreshSelectedVc = async () => {
    if (isMain) return;
    const [card, activity, insights] = await Promise.all([api.virtualCards.get(selectedCardId), api.virtualCards.activity(selectedCardId), api.virtualCards.insights(selectedCardId)]);
    setVcDetail(card); setVcActivity(activity); setVcInsights(insights);
    setVirtualCards((prev) => prev.map((c) => (c.id === card.id ? card : c)));
  };

  const canManageSelected = !isMain && vcDetail?.myRole === "owner";
  const canSpendSelected = isMain || (vcDetail && vcDetail.holderId === user?.id);

  // The same generic sheets used everywhere else — undefined pay props
  // mean "use the main card", so one set of instances covers both.
  const gepgPay = isMain ? undefined : (control, amount, biller, catId) => api.virtualCards.payGepg(selectedCardId, control, amount, biller, catId);
  const lukuPay = isMain ? undefined : (meter, amount, catId) => api.virtualCards.payLuku(selectedCardId, meter, amount, catId);

  const runVc = async (fn) => {
    setBusy(true);
    try { await fn(); await refreshSelectedVc(); } catch (err) { console.error("Add-on card action failed", err); } finally { setBusy(false); } // eslint-disable-line no-console
  };

  const actions = [
    { key: "lipa", icon: QrCode, label: "Lipa", color: t.accent },
    { key: "gepg", icon: Landmark, label: "GePG", color: "#B44B36" },
    { key: "luku", icon: Zap, label: "LUKU", color: "#4A8C8C" },
    { key: "topup-menu", icon: ArrowDownCircle, label: "Top up", color: t.gold },
    { key: "transfer-menu", icon: ArrowLeftRight, label: "Transfer", color: "#1A5C97" },
  ];
  const vcActions = [
    { key: "lipa", icon: QrCode, label: "Lipa" },
    { key: "gepg", icon: Landmark, label: "GePG" },
    { key: "luku", icon: Zap, label: "LUKU" },
    { key: "airtime", icon: Phone, label: "Mobile top-up" },
  ];

  const tabs = [
    { key: "insights", label: tr("insights"), icon: BarChart2 },
    { key: "statement", label: "Statement", icon: FileText },
    { key: "controls", label: tr("controls"), icon: SlidersHorizontal },
    { key: "activity", label: tr("activity"), icon: Receipt },
  ];

  return (
    <div className="px-4 pt-2 pb-8">
      <h1 className="text-[22px] font-bold mb-1" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("pay")}</h1>
      <p className="text-[13px] mb-3" style={{ color: t.inkFaint }}>{tr("paySub")}</p>

      <WalletCardCarousel
        t={t}
        selectedId={selectedCardId}
        onSelect={setSelectedCardId}
        balanceHidden={balanceHidden}
        onToggleBalanceHidden={() => setBalanceHidden((v) => !v)}
        cards={[
          { id: "main", label: holderName, sublabel: "Primary card", balance: cardBalance, last4: cardLast4, gradientFrom: t.accent, gradientTo: t.good, frozen: cardFrozen, terminated: false, badge: null, revealFn: api.cards.reveal },
          ...virtualCards.map((c) => ({
            id: c.id,
            label: c.label || `${nameFor(c.holderId)}'s card`,
            sublabel: nameFor(c.holderId),
            balance: c.balance,
            last4: c.last4,
            gradientFrom: t.gold, gradientTo: "#A9782F",
            frozen: c.frozen, terminated: c.terminated,
            badge: c.terminated ? "Terminated" : "Shared",
            revealFn: c.terminated ? null : () => api.virtualCards.reveal(c.id),
          })),
        ]}
      />

      <div className="pt-2">
        {isMain && (
            <>
              <div className="grid grid-cols-4 gap-2 mb-4">
                {actions.map((a) => <RailAction key={a.key} t={t} icon={a.icon} label={a.label} color={a.color} onClick={() => setSheet(a.key)} disabled={cardFrozen} />)}
              </div>

              <div className="flex p-1 rounded-full mb-4" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
                {tabs.map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => setSubTab(key)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[12.5px] font-semibold transition-colors" style={{ background: subTab === key ? t.card : "transparent", color: subTab === key ? t.ink : t.inkFaint, boxShadow: subTab === key ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
                    <Icon size={14} />{label}
                  </button>
                ))}
              </div>

              {subTab === "insights" && <SpendGraphCard t={t} transactions={transactions} categories={categories} wallet="personal" />}
              {subTab === "statement" && <StatementCard t={t} statement={statement} loading={statementLoading} monthLabel={monthLabel} onPrevMonth={() => shiftMonth(-1)} onNextMonth={() => shiftMonth(1)} onDownloadCsv={downloadStatementCsv} downloadingCsv={downloadingCsv} csvError={csvError} />}
              {subTab === "controls" && <CardControls t={t} frozen={cardFrozen} setFrozen={setCardFrozen} controls={cardControls} setControls={setCardControls} dailyLimit={dailyLimit} setDailyLimit={setDailyLimit} noMargin />}
              {subTab === "activity" && (
                <Card t={t} className="px-3">{cardActivity.length ? cardActivity.map((a) => <CardActivityRow key={a.id} t={t} item={a} />) : <p className="py-8 text-center text-[13px]" style={{ color: t.inkFaint }}>{tr("noCardActivity")}</p>}</Card>
              )}
            </>
          )}

          {!isMain && vcLoading && <div className="flex justify-center py-10"><RefreshCw size={20} className="animate-spin" color={t.accent} /></div>}

          {!isMain && !vcLoading && vcDetail && (
            <>
              <div className="flex items-center justify-between mb-4 px-1">
                <div><p className="text-[12px]" style={{ color: t.inkFaint }}>Add-on card balance</p><p className="text-[24px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{fmtTZS(vcDetail.balance)}</p></div>
                {vcDetail.terminated ? (
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: t.dangerSoft, color: t.danger }}>Terminated</span>
                ) : (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: t.goldSoft }}><CreditCard size={13} color={t.gold} /><span className="text-[11px] font-semibold" style={{ color: t.gold }}>{canManageSelected ? "You manage" : `Issued by ${nameFor(vcDetail.ownerId)}`}</span></div>
                )}
              </div>

              {canSpendSelected && !vcDetail.terminated && !vcDetail.frozen && (
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {vcActions.filter((a) => a.key === "airtime" ? (vcDetail.services ? vcDetail.services.topup !== false : true) : (vcDetail.services ? vcDetail.services[a.key] !== false : true)).map((a) => (
                    <RailAction key={a.key} t={t} icon={a.icon} label={a.label} color={t.accent} onClick={() => (a.key === "airtime" ? setSubTab("airtime") : setSheet(a.key))} />
                  ))}
                </div>
              )}
              {vcDetail.frozen && !vcDetail.terminated && <p className="text-[12.5px] text-center mb-4" style={{ color: t.danger }}>This card is frozen — spending is disabled.</p>}

              <div className="flex p-1 rounded-full mb-4" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
                {tabs.map(({ key, label, icon: Icon }) => (
                  <button key={key} onClick={() => setSubTab(key)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[12.5px] font-semibold transition-colors" style={{ background: subTab === key ? t.card : "transparent", color: subTab === key ? t.ink : t.inkFaint, boxShadow: subTab === key ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
                    <Icon size={14} />{label}
                  </button>
                ))}
              </div>

              {subTab === "airtime" && canSpendSelected && (
                <Card t={t} className="p-4 mb-4">
                  <div className="flex items-center justify-between mb-3"><p className="text-[13px] font-semibold" style={{ color: t.ink }}>Mobile top-up</p><button onClick={() => setSubTab("insights")} className="text-[11.5px] font-semibold" style={{ color: t.accent }}>Close</button></div>
                  <Field t={t} label="Provider / number"><input style={inputStyle(t)} value={airtimeProvider} onChange={(e) => setAirtimeProvider(e.target.value)} placeholder="e.g. Vodacom 0712 345 678" /></Field>
                  <Field t={t} label="Amount (TZS)">
                    <input style={inputStyle(t)} type="number" value={airtimeAmt} onChange={(e) => setAirtimeAmt(e.target.value)} />
                    <CurrencyEquivalentHint t={t} amountTZS={airtimeAmt} />
                  </Field>
                  <Field t={t} label="Category"><select style={inputStyle(t)} value={airtimeCategory} onChange={(e) => setAirtimeCategory(e.target.value)}>{categories.filter((c) => c.id && (!vcDetail.allowedCategoryIds || vcDetail.allowedCategoryIds.includes(c.id))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                  <PrimaryButton t={t} disabled={!airtimeProvider || !airtimeAmt || busy} onClick={() => runVc(() => api.virtualCards.spend(selectedCardId, parseFloat(airtimeAmt), airtimeProvider, airtimeCategory, "topup"))}>{busy ? "Processing…" : "Pay"}</PrimaryButton>
                </Card>
              )}

              {subTab === "insights" && vcInsights && (
                <Card t={t} className="p-4">
                  <div className="grid grid-cols-3 gap-2 text-center mb-1">
                    <div><p className="text-[10.5px]" style={{ color: t.inkFaint }}>This month</p><p className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(vcInsights.spentThisMonth)}</p></div>
                    <div><p className="text-[10.5px]" style={{ color: t.inkFaint }}>All time</p><p className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(vcInsights.totalSpent)}</p></div>
                    <div><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Left today</p><p className="text-[13px] font-bold" style={{ color: t.good, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(vcInsights.remainingDailyLimit)}</p></div>
                  </div>
                </Card>
              )}

              {subTab === "statement" && <StatementCard t={t} statement={statement} loading={statementLoading} monthLabel={monthLabel} onPrevMonth={() => shiftMonth(-1)} onNextMonth={() => shiftMonth(1)} onDownloadCsv={downloadStatementCsv} downloadingCsv={downloadingCsv} csvError={csvError} />}

              {subTab === "controls" && (
                canManageSelected ? (
                  !vcDetail.terminated ? (
                    <Card t={t} className="p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <button disabled={busy} onClick={() => runVc(() => api.virtualCards.setFrozen(vcDetail.id, !vcDetail.frozen))} className="flex-1 py-3 rounded-full font-semibold text-[13px] flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>{vcDetail.frozen ? <><Unlock size={14} /> Unfreeze</> : <><Lock size={14} /> Freeze</>}</button>
                      </div>
                      <p className="text-[12px] font-semibold mb-2" style={{ color: t.inkFaint }}>Daily spending limit</p>
                      <div className="flex gap-2 mb-4">
                        <input style={{ ...inputStyle(t), flex: 1 }} type="number" value={vcLimitAmt} onChange={(e) => setVcLimitAmt(e.target.value)} />
                        <button disabled={!vcLimitAmt || busy} onClick={() => runVc(() => api.virtualCards.setLimit(vcDetail.id, parseFloat(vcLimitAmt)))} className="px-4 rounded-[13px] font-semibold text-[13px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>Save</button>
                      </div>
                      <button onClick={() => setManageOpen(true)} className="w-full flex items-center justify-between p-3.5 rounded-[14px]" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
                        <span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>Transfers, services, categories, terminate…</span>
                        <ChevronRight size={16} color={t.inkFaint} />
                      </button>
                    </Card>
                  ) : (
                    <Card t={t} className="p-4"><p className="text-[12.5px] text-center" style={{ color: t.inkFaint }}>This card has been terminated.</p></Card>
                  )
                ) : (
                  <Card t={t} className="p-4"><p className="text-[12.5px] text-center" style={{ color: t.inkFaint }}>Only the primary member can manage this card's controls.</p></Card>
                )
              )}

              {subTab === "activity" && (
                <Card t={t} className="px-3">
                  {vcActivity.length ? vcActivity.map((a) => (
                    <div key={a.id} className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${t.border}` }}>
                      <div><p className="text-[13px] font-semibold" style={{ color: t.ink }}>{a.label}</p><p className="text-[11px]" style={{ color: t.inkFaint }}>{new Date(a.date).toLocaleString()}</p></div>
                      {a.amount !== null && <p className="text-[13px] font-semibold" style={{ color: a.type === "topup" || a.type === "transfer_to_main" ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{a.type === "topup" ? "+" : "-"}{fmtTZS(a.amount)}</p>}
                    </div>
                  )) : <p className="py-8 text-center text-[13px]" style={{ color: t.inkFaint }}>No activity yet.</p>}
                </Card>
              )}
            </>
          )}
        </div>

      <QrPaymentSheet
        t={t} open={sheet === "lipa"} onClose={() => setSheet(null)}
        cardType={isMain ? "main" : "virtual"} cardId={isMain ? "main" : selectedCardId}
        categories={categories} kycVerified={kycVerified} setKycVerified={setKycVerified}
        onSuccess={isMain ? refreshCardAndTransactions : refreshSelectedVc}
        tr={tr} language={language}
      />

      <GepgPaySheet t={t} open={sheet === "gepg"} onClose={() => setSheet(null)} categoryIdByName={categoryIdByName} refreshCardAndTransactions={isMain ? refreshCardAndTransactions : undefined} kycVerified={kycVerified} setKycVerified={setKycVerified} payFn={gepgPay} onSuccess={!isMain ? refreshSelectedVc : undefined} />
      <LukuPaySheet t={t} open={sheet === "luku"} onClose={() => setSheet(null)} categoryIdByName={categoryIdByName} refreshCardAndTransactions={isMain ? refreshCardAndTransactions : undefined} kycVerified={kycVerified} setKycVerified={setKycVerified} payFn={lukuPay} onSuccess={!isMain ? refreshSelectedVc : undefined} />

      <TopUpMenuSheet t={t} open={sheet === "topup-menu"} onClose={() => setSheet(null)} onNavigate={setSheet} />
      <TopUpGatewaySheet t={t} open={sheet === "topup-gateway"} onClose={() => setSheet(null)} cardBalance={cardBalance} refreshCardAndTransactions={refreshCardAndTransactions} kycVerified={kycVerified} setKycVerified={setKycVerified} />
      <VisaOctSheet t={t} open={sheet === "topup-oct"} onClose={() => setSheet(null)} cardBalance={cardBalance} refreshCardAndTransactions={refreshCardAndTransactions} kycVerified={kycVerified} setKycVerified={setKycVerified} />
      <ReceiveSheet t={t} open={sheet === "topup-receive"} onClose={() => setSheet(null)} cardBalance={cardBalance} setCardBalance={setCardBalance} addActivity={addActivity} kycVerified={kycVerified} setKycVerified={setKycVerified} />

      <TransferMenuSheet t={t} open={sheet === "transfer-menu"} onClose={() => setSheet(null)} onNavigate={setSheet} />
      <WalletTransferSheet t={t} open={sheet === "transfer-wallet"} onClose={() => setSheet(null)} cardBalance={cardBalance} setCardBalance={setCardBalance} addActivity={addActivity} kycVerified={kycVerified} setKycVerified={setKycVerified} />
      <BankTransferSheet t={t} open={sheet === "transfer-bank"} onClose={() => setSheet(null)} cardBalance={cardBalance} setCardBalance={setCardBalance} addActivity={addActivity} kycVerified={kycVerified} setKycVerified={setKycVerified} />

      <VirtualCardDetailSheet
        t={t} card={manageOpen ? vcDetail : null} onClose={() => setManageOpen(false)} categories={categories} myUserId={user?.id}
        holderName={vcDetail ? nameFor(vcDetail.holderId) : null}
        onChanged={(updated) => { setVcDetail(updated); setVirtualCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c))); }}
        onMainCardChanged={refreshCardAndTransactions}
        onOpenService={() => {}}
        tr={tr} language={language}
      />
    </div>
  );
}
/* ---------------------------------------------------------------------- */

function InviteSheet({ t, open, onClose, walletId, onInvited }) {
  const [phone, setPhone] = useState("");
  const [createAddOnCard, setCreateAddOnCard] = useState(false);
  const [addOnCardLabel, setAddOnCardLabel] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const valid = phone.length >= 8;

  const send = async () => {
    if (!valid) return;
    setSending(true); setError("");
    try {
      await api.wallets.invite(walletId, phone, { createAddOnCard, addOnCardLabel: addOnCardLabel.trim() || undefined });
      setSent(true);
      onInvited?.();
    } catch (err) {
      setError(err.message || "Couldn't send the invitation.");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { if (open) { setPhone(""); setCreateAddOnCard(false); setAddOnCardLabel(""); setError(""); setSent(false); } }, [open]);

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Invite a family member">
      <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>Invite another MitaPesa user to your Shared Household Wallet by their phone number. They'll need to accept before they're added.</p>
      {sent ? (
        <div className="flex flex-col items-center py-6 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: t.accentSoft }}><Check size={22} color={t.good} /></div>
          <p className="text-[14px] font-semibold" style={{ color: t.ink }}>Invitation sent</p>
          <p className="text-[12.5px] mt-1" style={{ color: t.inkFaint }}>{createAddOnCard ? "A shared add-on card will be created for them once they accept." : "They'll see it next time they check their wallet invites."}</p>
        </div>
      ) : (
        <>
          <Field t={t} label="Mobile number">
            <div className="flex gap-2">
              <div className="px-3.5 flex items-center justify-center rounded-[13px] text-[14px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>+255</div>
              <input style={{ ...inputStyle(t), flex: 1 }} type="tel" inputMode="numeric" placeholder="712 345 678" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 9))} />
            </div>
          </Field>

          <button onClick={() => setCreateAddOnCard((v) => !v)} className="w-full flex items-center justify-between p-3.5 rounded-[14px] mb-3" style={{ background: createAddOnCard ? t.goldSoft : t.cardSoft, border: `1px solid ${createAddOnCard ? t.gold : t.border}` }}>
            <div className="flex items-center gap-2.5 text-left"><CreditCard size={16} color={createAddOnCard ? t.gold : t.inkFaint} /><div><p className="text-[13px] font-semibold" style={{ color: t.ink }}>Also create a shared add-on card</p><p className="text-[11px]" style={{ color: t.inkFaint }}>You fund and control it; they can use it once they accept</p></div></div>
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: createAddOnCard ? t.gold : "transparent", border: `1.5px solid ${createAddOnCard ? t.gold : t.border}` }}>{createAddOnCard && <Check size={12} color="#fff" />}</div>
          </button>
          {createAddOnCard && <Field t={t} label="Card label (optional)"><input style={inputStyle(t)} placeholder="e.g. Amara's card" value={addOnCardLabel} onChange={(e) => setAddOnCardLabel(e.target.value)} /></Field>}

          {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}
          <PrimaryButton t={t} onClick={send} disabled={!valid || sending}>{sending ? "Sending…" : "Send invitation"}</PrimaryButton>
        </>
      )}
    </BottomSheet>
  );
}

function PendingInviteRow({ t, invite, onAccept, onDecline }) {
  const [busy, setBusy] = useState(false);
  const act = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  return (
    <div className="flex items-center justify-between p-3.5 rounded-[14px] mb-2" style={{ background: t.goldSoft, border: `1px solid ${t.border}` }}>
      <div>
        <p className="text-[13px] font-semibold" style={{ color: t.ink }}>{invite.invitedByUser?.firstName} {invite.invitedByUser?.lastName}</p>
        <p className="text-[11.5px]" style={{ color: t.inkFaint }}>invited you to "{invite.wallet?.name || "their wallet"}"</p>
      </div>
      <div className="flex gap-1.5">
        <button disabled={busy} onClick={() => act(() => onDecline(invite.id))} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>Decline</button>
        <button disabled={busy} onClick={() => act(() => onAccept(invite.id))} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: t.gold, color: "#fff" }}>Accept</button>
      </div>
    </div>
  );
}

// Full transaction list for one wallet (personal or shared), with the
// same date-range filtering already used on Ledger and Category
// Performance — reached by tapping "View all" on the compact recent-
// activity widget, which itself only shows the last 4 to avoid the
// scrolling this page exists to move elsewhere.
function WalletActivityPage({ t, transactions, categories, wallet, walletLabel, showLogger, goBack, filterUserId, filterUserName }) {
  const [rangeType, setRangeType] = useState("today");
  const [customFrom, setCustomFrom] = useState(TODAY_STR);
  const [customTo, setCustomTo] = useState(TODAY_STR);

  const filtered = transactions
    .filter((x) => x.wallet === wallet && (!filterUserId || x.loggedByUserId === filterUserId) && inDateRange(x.date, rangeType, customFrom, customTo))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const income = filtered.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const expenses = filtered.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);

  const RANGE_OPTIONS = [["today", "Today"], ["week", "Week"], ["month", "Month"], ["custom", "Custom"], ["all", "All time"]];

  return (
    <div className="px-4 pt-2 pb-6 space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[19px] font-bold flex-1 truncate" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{filterUserName ? `${filterUserName}'s activity` : walletLabel}</h1>
      </div>

      <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {RANGE_OPTIONS.map(([key, label]) => (
          <button key={key} onClick={() => setRangeType(key)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold shrink-0"
            style={rangeType === key ? { background: t.accent, color: "#fff" } : { background: t.cardSoft, color: t.inkSoft, border: `1px solid ${t.border}` }}>
            {label}
          </button>
        ))}
      </div>
      {rangeType === "custom" && (
        <div className="flex gap-2">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={inputStyle(t)} />
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={inputStyle(t)} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Card t={t} className="p-3"><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Income</p><p className="text-[15px] font-bold mt-0.5" style={{ color: t.good, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(income)}</p></Card>
        <Card t={t} className="p-3"><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Expenses</p><p className="text-[15px] font-bold mt-0.5" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(expenses)}</p></Card>
      </div>

      <Card t={t} className="px-3">
        {filtered.length ? filtered.map((tx) => <TxRow key={tx.id} t={t} tx={tx} categories={categories} showLogger={showLogger} />) : <p className="py-8 text-center text-[13px]" style={{ color: t.inkFaint }}>No transactions in this period.</p>}
      </Card>
    </div>
  );
}

// Compact per-member spending comparison for the shared wallet — a
// simple sorted list with proportional bars gives both individual
// visibility and side-by-side comparison in one glance, no separate
// chart needed to satisfy both asks at once. Deliberately just two
// period options (not the full 5-way filter) to stay compact here; full
// filtering is available one tap away via WalletActivityPage.
function MemberSpendCard({ t, transactions, members, user, onSelectMember }) {
  const [period, setPeriod] = useState("month"); // "week" | "month"

  const filtered = transactions.filter((x) => x.wallet === "shared" && x.amount < 0 && inDateRange(x.date, period));
  const grandTotal = filtered.reduce((s, x) => s + Math.abs(x.amount), 0);

  const rows = members
    .map((m) => {
      const isMe = m.userId === user?.id;
      const total = filtered.filter((x) => x.loggedByUserId === m.userId).reduce((s, x) => s + Math.abs(x.amount), 0);
      return { userId: m.userId, name: isMe ? "You" : `${m.user?.firstName || ""} ${m.user?.lastName || ""}`.trim() || "Member", total };
    })
    .sort((a, b) => b.total - a.total);

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <SectionLabel t={t}>By member</SectionLabel>
        <div className="flex gap-0.5 p-0.5 rounded-full" style={{ background: t.cardSoft }}>
          <button onClick={() => setPeriod("week")} className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={period === "week" ? { background: t.ink, color: t.bg } : { color: t.inkFaint }}>Week</button>
          <button onClick={() => setPeriod("month")} className="px-2.5 py-1 rounded-full text-[11px] font-semibold" style={period === "month" ? { background: t.ink, color: t.bg } : { color: t.inkFaint }}>Month</button>
        </div>
      </div>
      <Card t={t} className="p-3.5 space-y-3">
        {rows.length === 0 ? (
          <p className="text-center py-3 text-[12px]" style={{ color: t.inkFaint }}>No members yet.</p>
        ) : rows.map((r) => {
          const pct = grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0;
          return (
            <button key={r.userId} onClick={() => onSelectMember(r.userId, r.name)} className="w-full text-left">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12.5px] font-medium" style={{ color: t.ink }}>{r.name}</span>
                <span className="text-[12.5px] font-semibold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(r.total)}</span>
              </div>
              <div className="w-full h-1.5 rounded-full" style={{ background: t.bgSoft }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: t.gold }} />
              </div>
            </button>
          );
        })}
      </Card>
    </div>
  );
}

function WalletsPage({ t, transactions, onAdd, walletsList, user, myInvites, onAcceptInvite, onDeclineInvite, onCreateSharedWallet, onRefreshWallets, setActive, categories, onAddCategory, onAddSubcategory, tr, onOpenWalletActivity }) {
  const [view, setView] = useState("personal");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [capacity, setCapacity] = useState(null); // { invites, maxMembers, acceptedCount, pendingCount }
  const [revoking, setRevoking] = useState(null);

  const sharedWallet = walletsList.find((w) => w.type === "SHARED");
  const hasShared = !!sharedWallet;
  const myMembership = sharedWallet?.members?.find((m) => m.userId === user?.id);
  const isOwner = myMembership?.role === "owner";
  const otherMembers = (sharedWallet?.members || []).filter((m) => m.userId !== user?.id);

  const loadCapacity = async () => {
    if (!sharedWallet || !isOwner) return;
    try { setCapacity(await api.wallets.sentInvites(sharedWallet.id)); } catch (err) { console.error("Failed to load invite capacity", err); } // eslint-disable-line no-console
  };
  useEffect(() => { loadCapacity(); }, [sharedWallet?.id, isOwner]);

  const revokeInvite = async (inviteId) => {
    setRevoking(inviteId);
    try { await api.wallets.revokeInvite(sharedWallet.id, inviteId); await loadCapacity(); }
    catch (err) { console.error("Failed to revoke invite", err); } // eslint-disable-line no-console
    finally { setRevoking(null); }
  };

  const activeWallet = hasShared ? view : "personal";
  const walletTx = transactions.filter((x) => x.wallet === activeWallet);
  const income = walletTx.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
  const expenses = walletTx.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
  const balance = income + expenses;
  const sorted = [...walletTx].sort((a, b) => new Date(b.date) - new Date(a.date));

  const createShared = async () => {
    setCreating(true);
    try { await onCreateSharedWallet(); setView("shared"); setInviteOpen(true); }
    finally { setCreating(false); }
  };

  const atCapacity = capacity && capacity.acceptedCount + capacity.pendingCount >= capacity.maxMembers;

  return (
    <div className="px-4 pt-2 pb-24 relative">
      <h1 className="text-[22px] font-bold mb-3" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("wallets")}</h1>

      {myInvites.length > 0 && (
        <div className="mb-4">
          <SectionLabel t={t}>Pending invitations</SectionLabel>
          {myInvites.map((inv) => <PendingInviteRow key={inv.id} t={t} invite={inv} onAccept={onAcceptInvite} onDecline={onDeclineInvite} />)}
        </div>
      )}

      {!hasShared ? (
        <Card t={t} className="p-4 mb-4">
          <div className="flex items-center gap-3 mb-3"><div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: t.bgSoft }}><Users size={16} color={t.inkFaint} /></div><div><p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{tr("sharedHouseholdWallet")}</p><p className="text-[11.5px]" style={{ color: t.inkFaint }}>You don't have one yet — your spending stays private.</p></div></div>
          <PrimaryButton t={t} onClick={createShared} disabled={creating}>{creating ? "Creating…" : "Create a shared wallet"}</PrimaryButton>
        </Card>
      ) : (
        <Card t={t} className="p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: t.accentSoft }}><Users size={16} color={t.good} /></div><div><p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{sharedWallet.name || tr("sharedHouseholdWallet")}</p><p className="text-[11.5px]" style={{ color: t.inkFaint }}>{otherMembers.length > 0 ? `Linked with ${otherMembers.map((m) => m.user?.firstName).join(", ")}` : "Just you so far"}</p></div></div>
            {isOwner && <button onClick={() => setInviteOpen(true)} disabled={atCapacity} className="p-2 rounded-full" style={{ background: atCapacity ? t.bgSoft : t.goldSoft, opacity: atCapacity ? 0.5 : 1 }}><UserPlus size={15} color={atCapacity ? t.inkFaint : t.gold} /></button>}
          </div>
          {isOwner && capacity && (
            <>
              <p className="text-[11px] mt-1" style={{ color: t.inkFaint }}>{capacity.acceptedCount + capacity.pendingCount} of {capacity.maxMembers} household slots used{atCapacity ? " — full" : ""}</p>
              {capacity.invites.length > 0 && (
                <div className="mt-3 pt-3 space-y-2" style={{ borderTop: `1px solid ${t.border}` }}>
                  {capacity.invites.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between">
                      <p className="text-[12.5px]" style={{ color: t.inkSoft }}>{inv.invitedUser?.firstName} {inv.invitedUser?.lastName} <span style={{ color: t.inkFaint }}>· pending{inv.createAddOnCard ? " · add-on card" : ""}</span></p>
                      <button disabled={revoking === inv.id} onClick={() => revokeInvite(inv.id)} className="text-[11.5px] font-semibold" style={{ color: t.danger }}>{revoking === inv.id ? "…" : "Revoke"}</button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {hasShared && (
        <div className="flex p-1 rounded-full mb-4" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
          {[{ k: "personal", label: tr("myPersonalWallet"), icon: WalletIcon }, { k: "shared", label: tr("sharedHouseholdWallet"), icon: Users }].map(({ k, label, icon: Icon }) => (
            <button key={k} onClick={() => setView(k)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[12.5px] font-semibold transition-colors" style={{ background: view === k ? t.card : "transparent", color: view === k ? t.ink : t.inkFaint, boxShadow: view === k ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}><Icon size={14} />{label}</button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Card t={t} className="col-span-2 p-5" style={{ background: activeWallet === "shared" ? `linear-gradient(135deg, ${t.gold}, #A9782F)` : `linear-gradient(135deg, ${t.accent}, ${t.good})` }}><p className="text-[12px] font-medium tracking-wide uppercase" style={{ color: "rgba(255,255,255,0.75)" }}>{activeWallet === "personal" ? tr("personalBalance") : tr("householdBalance")}</p><p className="text-[30px] font-bold mt-1" style={{ color: "#fff", fontFamily: "'Space Grotesk', sans-serif" }}>{fmt(balance)}</p></Card>
        <Card t={t} className="p-4"><p className="text-[12px]" style={{ color: t.inkFaint }}>{tr("monthlyIncome")}</p><p className="text-[17px] font-bold mt-0.5" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(income)}</p></Card>
        <Card t={t} className="p-4"><p className="text-[12px]" style={{ color: t.inkFaint }}>{tr("monthlyExpenses")}</p><p className="text-[17px] font-bold mt-0.5" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(expenses)}</p></Card>
      </div>

      {hasShared && activeWallet === "shared" && sharedWallet.members?.length > 0 && (
        <MemberSpendCard t={t} transactions={transactions} members={sharedWallet.members} user={user} onSelectMember={(userId, name) => onOpenWalletActivity({ wallet: "shared", filterUserId: userId, filterUserName: name, showLogger: false })} />
      )}

      {hasShared && activeWallet === "shared" && (
        <button onClick={() => setActive("virtualcards")} className="w-full flex items-center justify-between p-4 rounded-[18px] mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
          <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: t.accentSoft }}><CreditCard size={16} color={t.good} /></div><div className="text-left"><p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>Add-on cards</p><p className="text-[11.5px]" style={{ color: t.inkFaint }}>Issue and manage shared add-on cards</p></div></div>
          <ChevronRight size={17} color={t.inkFaint} />
        </button>
      )}

      <div className="flex items-center justify-between mb-1">
        <SectionLabel t={t}>{activeWallet === "personal" ? tr("recentTransactions") : tr("sharedActivity")}</SectionLabel>
        {sorted.length > 4 && (
          <button onClick={() => onOpenWalletActivity({ wallet: activeWallet, walletLabel: activeWallet === "personal" ? tr("recentTransactions") : tr("sharedActivity"), showLogger: activeWallet === "shared" })} className="text-[11.5px] font-semibold" style={{ color: t.accent }}>View all</button>
        )}
      </div>
      <Card t={t} className="px-3">{sorted.length ? sorted.slice(0, 4).map((tx) => <TxRow key={tx.id} t={t} tx={tx} categories={categories} showLogger={activeWallet === "shared"} />) : <p className="py-8 text-center text-[13px]" style={{ color: t.inkFaint }}>{tr("noActivityWallet")}</p>}</Card>
      <button onClick={() => setSheetOpen(true)} className="fixed z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-lg" style={{ background: activeWallet === "shared" ? t.gold : t.accent, right: "max(1.25rem, calc(50% - 195px))", bottom: 92 }}><Plus size={26} color="#fff" /></button>
      <AddTxSheet t={t} open={sheetOpen} onClose={() => setSheetOpen(false)} onAdd={onAdd} wallet={activeWallet} loggedByOptions={activeWallet === "shared" ? otherMembers.map((m) => m.user?.firstName).concat("You") : undefined} categories={categories} onAddCategory={onAddCategory} onAddSubcategory={onAddSubcategory} />
      {sharedWallet && <InviteSheet t={t} open={inviteOpen} onClose={() => setInviteOpen(false)} walletId={sharedWallet.id} onInvited={async () => { await onRefreshWallets(); await loadCapacity(); }} />}
    </div>
  );
}

function VirtualCardBadge({ t, type }) {
  const isParent = type === "parent_linked";
  return <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: isParent ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.25)", color: "#fff" }}>{isParent ? "Linked" : "Independent"}</span>;
}

function VirtualCardTile({ t, card, holderName, onOpen }) {
  const gradientFrom = card.type === "parent_linked" ? t.gold : t.accent;
  const gradientTo = card.type === "parent_linked" ? "#A9782F" : t.good;
  return (
    <button onClick={onOpen} className="w-full text-left p-4 rounded-[18px] mb-3" style={{ background: card.terminated ? t.bgSoft : `linear-gradient(135deg, ${gradientFrom}, ${gradientTo})`, border: card.terminated ? `1px solid ${t.border}` : "none" }}>
      <div className="flex items-center justify-between mb-3">
        <CreditCard size={20} color={card.terminated ? t.inkFaint : "#fff"} />
        {!card.terminated && card.frozen && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)", color: "#fff" }}>FROZEN</span>}
        {card.terminated && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: t.dangerSoft, color: t.danger }}>TERMINATED</span>}
      </div>
      <p className="text-[12px]" style={{ color: card.terminated ? t.inkFaint : "rgba(255,255,255,0.8)" }}>{card.label || (card.type === "parent_linked" ? `${holderName || "Member"}'s card` : "My independent card")}</p>
      <p className="text-[20px] font-bold mt-1" style={{ color: card.terminated ? t.ink : "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>•••• {card.last4}</p>
      <div className="flex items-center justify-between mt-3">
        <p className="text-[13px] font-semibold" style={{ color: card.terminated ? t.inkFaint : "#fff" }}>{fmtTZS(card.balance)}</p>
        <p className="text-[11px]" style={{ color: card.terminated ? t.inkFaint : "rgba(255,255,255,0.75)" }}>{card.myRole === "owner" ? "You manage this" : "Issued to you"}</p>
      </div>
    </button>
  );
}

function IssueLinkedCardSheet({ t, open, onClose, walletId, members, onIssued }) {
  const [holderId, setHolderId] = useState("");
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setHolderId(members[0]?.userId || ""); setLabel(""); setError(""); } }, [open, members]);

  const issue = async () => {
    if (!holderId) return;
    setSubmitting(true); setError("");
    try {
      await api.virtualCards.createParentLinked(walletId, holderId, label.trim() || undefined);
      onIssued();
    } catch (err) {
      setError(err.message || "Couldn't issue the card.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Issue a linked card">
      <p className="text-[13px] mb-4" style={{ color: t.inkFaint }}>You'll fund and control this card — top-ups, limits, freezing, and terminating all stay with you. The member can view it and spend with it.</p>
      <Field t={t} label="Issue to">
        <select style={inputStyle(t)} value={holderId} onChange={(e) => setHolderId(e.target.value)}>
          {members.map((m) => <option key={m.userId} value={m.userId}>{m.user?.firstName} {m.user?.lastName}</option>)}
        </select>
      </Field>
      <Field t={t} label="Label (optional)"><input style={inputStyle(t)} placeholder="e.g. Amara's card" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
      <PrimaryButton t={t} onClick={issue} disabled={!holderId || submitting} tone={t.gold}>{submitting ? "Issuing…" : "Issue card"}</PrimaryButton>
    </BottomSheet>
  );
}

const VIRTUAL_CARD_SERVICES = [
  { key: "lipa", label: "Lipa", icon: QrCode, defaultCategory: "Shopping" },
  { key: "gepg", label: "GePG", icon: Landmark, defaultCategory: "Other" },
  { key: "luku", label: "LUKU", icon: Zap, defaultCategory: "Housing & Utilities" },
  { key: "topup", label: "Mobile top-up", icon: Phone, defaultCategory: "Bills & Subscriptions" },
];

function VirtualCardDetailSheet({ t, card, onClose, categories, myUserId, holderName, onChanged, onMainCardChanged, onOpenService, tr, language }) {
  const [activity, setActivity] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [insights, setInsights] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [topupAmt, setTopupAmt] = useState("");
  const [transferAmt, setTransferAmt] = useState("");
  const [limitAmt, setLimitAmt] = useState("");
  const [categoryPicker, setCategoryPicker] = useState(null);
  const [servicesPicker, setServicesPicker] = useState(null);
  const [activeService, setActiveService] = useState(null); // only ever "topup" now — lipa/gepg/luku open their real sheets instead
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Airtime top-up form state — the one service with no main-Pay-page
  // equivalent to reuse, so it stays as a simple inline form.
  const [topupProvider, setTopupProvider] = useState("");
  const [topupSpendAmt, setTopupSpendAmt] = useState("");
  const [topupCategory, setTopupCategory] = useState("");

  useEffect(() => {
    if (!card) return;
    setLimitAmt(String(card.dailyLimit));
    setCategoryPicker(card.allowedCategoryIds);
    setServicesPicker(card.services || { lipa: true, gepg: true, luku: true, topup: true });
    setTopupAmt(""); setTransferAmt(""); setError(""); setActiveService(null);
    setTopupProvider(""); setTopupSpendAmt("");
    const defaultCategory = categories.find((c) => c.id)?.id || "";
    setTopupCategory(defaultCategory);
    setLoadingActivity(true);
    api.virtualCards.activity(card.id).then(setActivity).catch(() => {}).finally(() => setLoadingActivity(false));
    api.virtualCards.insights(card.id).then(setInsights).catch(() => {});
  }, [card?.id]);

  if (!card) return null;
  const canManage = card.myRole === "owner";
  const canSpend = card.holderId === myUserId;

  const refreshAll = async (updatedCard) => {
    onChanged(updatedCard);
    api.virtualCards.activity(card.id).then(setActivity).catch(() => {});
    api.virtualCards.insights(card.id).then(setInsights).catch(() => {});
  };

  const run = async (fn) => {
    setBusy(true); setError("");
    try {
      const result = await fn();
      if (!result) throw new Error("No response from server");
      await refreshAll(result.card || result);
      return result;
    } catch (err) {
      setError(err.message || "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  // Transfers move real money on the owner's main card too — that state
  // lives at the App level (Pay page, Home page), so it needs its own
  // refresh call, not just this sheet's local card state.
  const runTransfer = async (fn) => {
    const result = await run(fn);
    if (result) await onMainCardChanged?.();
    return result;
  };

  const toggleCategory = (id) => {
    setCategoryPicker((prev) => (prev === null ? [id] : prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <>
    <BottomSheet t={t} open={!!card} onClose={onClose} title={card.label || (card.type === "parent_linked" ? (canManage ? `${holderName || "Member"}'s card` : "Your linked card") : "Independent card")}>
      <div className="p-4 rounded-[18px] mb-4" style={{ background: `linear-gradient(135deg, ${card.type === "parent_linked" ? t.gold : t.accent}, ${card.type === "parent_linked" ? "#A9782F" : t.good})` }}>
        <div className="flex items-center justify-between mb-3">
          <VirtualCardBadge t={t} type={card.type} />
          {card.terminated ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.3)", color: "#fff" }}>TERMINATED</span> : card.frozen ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.25)", color: "#fff" }}>FROZEN</span> : null}
        </div>
        <p className="text-[20px] font-bold" style={{ color: "#fff", fontFamily: "'IBM Plex Mono', monospace" }}>•••• •••• •••• {card.last4}</p>
        <div className="flex items-center justify-between mt-3">
          <div><p className="text-[11px]" style={{ color: "rgba(255,255,255,0.75)" }}>Balance</p><p className="text-[16px] font-bold" style={{ color: "#fff" }}>{fmtTZS(card.balance)}</p></div>
          <div className="text-right"><p className="text-[11px]" style={{ color: "rgba(255,255,255,0.75)" }}>Daily limit</p><p className="text-[16px] font-bold" style={{ color: "#fff" }}>{fmtTZS(card.dailyLimit)}</p></div>
        </div>
      </div>

      {!card.terminated && (canManage || canSpend) && (
        <button onClick={() => setDetailsOpen(true)} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-[13px] text-[12.5px] font-semibold mb-4" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>
          <Eye size={13} /> Card details for online payment
        </button>
      )}

      {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}

      {insights && (
        <Card t={t} className="p-4 mb-4">
          <p className="text-[12px] font-semibold mb-2.5" style={{ color: t.inkFaint }}>Insights</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-[10.5px]" style={{ color: t.inkFaint }}>This month</p><p className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(insights.spentThisMonth)}</p></div>
            <div><p className="text-[10.5px]" style={{ color: t.inkFaint }}>All time</p><p className="text-[13px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(insights.totalSpent)}</p></div>
            <div><p className="text-[10.5px]" style={{ color: t.inkFaint }}>Left today</p><p className="text-[13px] font-bold" style={{ color: t.good, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(insights.remainingDailyLimit)}</p></div>
          </div>
        </Card>
      )}

      {canSpend && !card.terminated && (
        <Card t={t} className="p-4 mb-4">
          {card.frozen ? (
            <p className="text-[12.5px] text-center py-2" style={{ color: t.danger }}>This card is frozen — spending is disabled.</p>
          ) : !activeService ? (
            <div className="grid grid-cols-4 gap-2">
              {VIRTUAL_CARD_SERVICES.filter((s) => (card.services ? card.services[s.key] !== false : true)).map((s) => (
                <button key={s.key} onClick={() => (s.key === "topup" ? setActiveService("topup") : onOpenService(s.key))} className="flex flex-col items-center gap-1.5 py-3 rounded-[14px]" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
                  <s.icon size={17} color={t.accent} /><span className="text-[10.5px] font-semibold text-center" style={{ color: t.inkSoft }}>{s.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[12.5px] font-semibold" style={{ color: t.ink }}>Mobile top-up</p>
                <button onClick={() => setActiveService(null)} className="text-[11.5px] font-semibold" style={{ color: t.accent }}>Change</button>
              </div>
              <Field t={t} label="Provider / number"><input style={inputStyle(t)} value={topupProvider} onChange={(e) => setTopupProvider(e.target.value)} placeholder="e.g. Vodacom 0712 345 678" /></Field>
              <Field t={t} label="Amount (TZS)">
                <input style={inputStyle(t)} type="number" value={topupSpendAmt} onChange={(e) => setTopupSpendAmt(e.target.value)} />
                <CurrencyEquivalentHint t={t} amountTZS={topupSpendAmt} />
              </Field>
              <Field t={t} label="Category"><select style={inputStyle(t)} value={topupCategory} onChange={(e) => setTopupCategory(e.target.value)}>{categories.filter((c) => c.id && (!card.allowedCategoryIds || card.allowedCategoryIds.includes(c.id))).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <PrimaryButton t={t} disabled={!topupProvider || !topupSpendAmt || busy} onClick={() => run(async () => { const r = await api.virtualCards.spend(card.id, parseFloat(topupSpendAmt), topupProvider, topupCategory, "topup"); setActiveService(null); return r; })}>{busy ? "Processing…" : "Pay"}</PrimaryButton>
            </div>
          )}
        </Card>
      )}

      {canManage && !card.terminated && (
        <>
          <Card t={t} className="p-4 mb-3">
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: t.inkFaint }}>Transfer between cards</p>
            <p className="text-[11px] mb-2" style={{ color: t.inkFaint }}>Main card → this add-on card</p>
            <div className="flex gap-2 mb-3">
              <input style={{ ...inputStyle(t), flex: 1 }} type="number" value={topupAmt} onChange={(e) => setTopupAmt(e.target.value)} placeholder="0" />
              <button disabled={!topupAmt || busy} onClick={() => runTransfer(() => api.virtualCards.topup(card.id, parseFloat(topupAmt)))} className="px-4 rounded-[13px] font-semibold text-[13px]" style={{ background: t.accent, color: "#fff" }}>Send</button>
            </div>
            <p className="text-[11px] mb-2" style={{ color: t.inkFaint }}>This add-on card → main card</p>
            <div className="flex gap-2">
              <input style={{ ...inputStyle(t), flex: 1 }} type="number" value={transferAmt} onChange={(e) => setTransferAmt(e.target.value)} placeholder="0" />
              <button disabled={!transferAmt || busy} onClick={() => runTransfer(() => api.virtualCards.transferToMain(card.id, parseFloat(transferAmt)))} className="px-4 rounded-[13px] font-semibold text-[13px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>Send</button>
            </div>
          </Card>

          <Card t={t} className="p-4 mb-3">
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: t.inkFaint }}>Daily spending limit</p>
            <div className="flex gap-2">
              <input style={{ ...inputStyle(t), flex: 1 }} type="number" value={limitAmt} onChange={(e) => setLimitAmt(e.target.value)} />
              <button disabled={!limitAmt || busy} onClick={() => run(() => api.virtualCards.setLimit(card.id, parseFloat(limitAmt)))} className="px-4 rounded-[13px] font-semibold text-[13px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>Save</button>
            </div>
          </Card>

          <Card t={t} className="p-4 mb-3">
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: t.inkFaint }}>Available services</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {VIRTUAL_CARD_SERVICES.map((s) => {
                const active = servicesPicker?.[s.key] !== false;
                return <button key={s.key} onClick={() => setServicesPicker((prev) => ({ ...prev, [s.key]: !active }))} className="px-2.5 py-1.5 rounded-full text-[11.5px] font-semibold flex items-center gap-1" style={{ background: active ? t.accent : t.bgSoft, color: active ? "#fff" : t.inkSoft }}><s.icon size={12} />{s.label}</button>;
              })}
            </div>
            <button disabled={busy} onClick={() => run(() => api.virtualCards.setServices(card.id, servicesPicker))} className="w-full py-2.5 rounded-full text-[12.5px] font-semibold" style={{ background: t.accent, color: "#fff" }}>Save</button>
          </Card>

          <Card t={t} className="p-4 mb-3">
            <p className="text-[12px] font-semibold mb-2.5" style={{ color: t.inkFaint }}>Permitted categories</p>
            <p className="text-[11.5px] mb-2.5" style={{ color: t.inkFaint }}>{categoryPicker === null ? "Unrestricted — any category" : `${categoryPicker.length} selected`}</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {categories.filter((c) => c.id).map((c) => {
                const active = categoryPicker !== null && categoryPicker.includes(c.id);
                return <button key={c.id} onClick={() => toggleCategory(c.id)} className="px-2.5 py-1 rounded-full text-[11.5px] font-semibold" style={{ background: active ? t.accent : t.bgSoft, color: active ? "#fff" : t.inkSoft }}>{c.name}</button>;
              })}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCategoryPicker(null)} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>Unrestrict</button>
              <button disabled={busy} onClick={() => run(() => api.virtualCards.setCategories(card.id, categoryPicker))} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold" style={{ background: t.accent, color: "#fff" }}>Save</button>
            </div>
          </Card>

          <div className="flex gap-2 mb-4">
            <button disabled={busy} onClick={() => run(() => api.virtualCards.setFrozen(card.id, !card.frozen))} className="flex-1 py-3 rounded-full font-semibold text-[13px] flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>{card.frozen ? <><Unlock size={14} /> Unfreeze</> : <><Lock size={14} /> Freeze</>}</button>
            <button disabled={busy} onClick={() => { if (window.confirm("Terminate this card? This can't be undone.")) run(() => api.virtualCards.terminate(card.id)); }} className="flex-1 py-3 rounded-full font-semibold text-[13px]" style={{ background: t.dangerSoft, color: t.danger }}>Terminate</button>
          </div>
        </>
      )}

      <SectionLabel t={t}>Activity</SectionLabel>
      {loadingActivity ? (
        <div className="flex justify-center py-6"><RefreshCw size={16} className="animate-spin" color={t.accent} /></div>
      ) : (
        <Card t={t} className="px-3">
          {activity.length ? activity.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${t.border}` }}>
              <div><p className="text-[13px] font-semibold" style={{ color: t.ink }}>{a.label}</p><p className="text-[11px]" style={{ color: t.inkFaint }}>{new Date(a.date).toLocaleString()}{a.reference ? ` · ${a.reference}` : ""}</p></div>
              {a.amount !== null && <p className="text-[13px] font-semibold" style={{ color: a.type === "topup" || a.type === "transfer_to_main" ? t.good : t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{a.type === "topup" ? "+" : "-"}{fmtTZS(a.amount)}</p>}
            </div>
          )) : <p className="py-6 text-center text-[13px]" style={{ color: t.inkFaint }}>No activity yet.</p>}
        </Card>
      )}
    </BottomSheet>

      <CardDetailsSheet
        t={t} open={detailsOpen} onClose={() => setDetailsOpen(false)}
        holderName={holderName || "Card holder"} last4={card.last4}
        gradientFrom={card.type === "parent_linked" ? t.gold : t.accent} gradientTo={card.type === "parent_linked" ? "#A9782F" : t.good}
        revealFn={() => api.virtualCards.reveal(card.id)}
      />
    </>
  );
}

function VirtualCardsPage({ t, goBack, categories, categoryIdByName, walletsList, user, tr, language, onMainCardChanged, kycVerified, setKycVerified }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailCard, setDetailCard] = useState(null);
  const [issueSheetOpen, setIssueSheetOpen] = useState(false);
  const [paymentService, setPaymentService] = useState(null); // "lipa" | "gepg" | "luku" — opened on top of the detail sheet

  const sharedWallet = walletsList.find((w) => w.type === "SHARED");
  const myMembership = sharedWallet?.members?.find((m) => m.userId === user?.id);
  const isSharedOwner = myMembership?.role === "owner";
  const invitableMembers = (sharedWallet?.members || []).filter((m) => m.userId !== user?.id);

  const load = async () => {
    setLoading(true);
    try {
      const fresh = await api.virtualCards.list();
      setCards(fresh);
      // Keep the open detail sheet in sync if its card was among those refreshed.
      setDetailCard((prev) => (prev ? fresh.find((c) => c.id === prev.id) || prev : prev));
    } catch (err) {
      console.error("Failed to load virtual cards", err); // eslint-disable-line no-console
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const nameFor = (userId) => sharedWallet?.members?.find((m) => m.userId === userId)?.user?.firstName || "Member";

  // Independent cards are no longer offered here — a member's own primary
  // card already covers personal spending; this page is scoped purely to
  // shared add-on cards, consistent with how it's only reachable from the
  // Shared Household Wallet view.
  const heldForMe = cards.filter((c) => c.myRole === "holder" && c.type === "parent_linked");
  const managed = cards.filter((c) => c.myRole === "owner" && c.type === "parent_linked");

  const refreshDetailCard = async () => {
    if (!detailCard) return;
    try {
      const updated = await api.virtualCards.get(detailCard.id);
      setDetailCard(updated);
      setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      console.error("Failed to refresh card after payment", err); // eslint-disable-line no-console
    }
  };

  return (
    <div className="px-4 pt-2 pb-24">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[20px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Add-on cards</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><RefreshCw size={20} className="animate-spin" color={t.accent} /></div>
      ) : (
        <>
          {heldForMe.length > 0 && (
            <>
              <SectionLabel t={t}>Issued to me</SectionLabel>
              {heldForMe.map((c) => <VirtualCardTile key={c.id} t={t} card={c} onOpen={() => setDetailCard(c)} />)}
            </>
          )}

          {managed.length > 0 && (
            <>
              <SectionLabel t={t}>Cards I manage</SectionLabel>
              {managed.map((c) => <VirtualCardTile key={c.id} t={t} card={c} holderName={nameFor(c.holderId)} onOpen={() => setDetailCard(c)} />)}
            </>
          )}

          {cards.length === 0 && <p className="text-center text-[13px] py-6" style={{ color: t.inkFaint }}>No add-on cards yet.</p>}

          {isSharedOwner && invitableMembers.length > 0 && (
            <button onClick={() => setIssueSheetOpen(true)} className="w-full flex items-center justify-between p-4 rounded-[18px] mt-2" style={{ background: t.goldSoft, border: `1px solid ${t.border}` }}>
              <div className="flex items-center gap-3"><div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: t.card }}><CreditCard size={16} color={t.gold} /></div><div className="text-left"><p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>Issue a linked card</p><p className="text-[11.5px]" style={{ color: t.inkFaint }}>For a member of your shared wallet</p></div></div>
              <ChevronRight size={17} color={t.inkFaint} />
            </button>
          )}
        </>
      )}

      <VirtualCardDetailSheet
        t={t} card={detailCard} onClose={() => setDetailCard(null)} categories={categories} myUserId={user?.id}
        holderName={detailCard ? nameFor(detailCard.holderId) : null}
        onChanged={(updated) => { setCards((prev) => prev.map((c) => (c.id === updated.id ? updated : c))); setDetailCard(updated); }}
        onMainCardChanged={onMainCardChanged}
        onOpenService={(key) => setPaymentService(key)}
        tr={tr} language={language}
      />

      {/* These render on top of the detail sheet above (same fixed z-index,
          later in the DOM wins) — same exact scan/manual/confirm UX as the
          main Pay page, just scoped to this add-on card's balance. */}
      {detailCard && (
        <>
          <QrPaymentSheet
            t={t} open={paymentService === "lipa"} onClose={() => setPaymentService(null)}
            cardType="virtual" cardId={detailCard.id} categories={categories} kycVerified={kycVerified} setKycVerified={setKycVerified}
            onSuccess={refreshDetailCard}
            tr={tr} language={language}
          />
          <GepgPaySheet
            t={t} open={paymentService === "gepg"} onClose={() => setPaymentService(null)}
            categoryIdByName={categoryIdByName} kycVerified={kycVerified} setKycVerified={setKycVerified}
            payFn={(control, amount, biller, catId) => api.virtualCards.payGepg(detailCard.id, control, amount, biller, catId)}
            onSuccess={refreshDetailCard}
          />
          <LukuPaySheet
            t={t} open={paymentService === "luku"} onClose={() => setPaymentService(null)}
            categoryIdByName={categoryIdByName} kycVerified={kycVerified} setKycVerified={setKycVerified}
            payFn={(meter, amount, catId) => api.virtualCards.payLuku(detailCard.id, meter, amount, catId)}
            onSuccess={refreshDetailCard}
          />
        </>
      )}

      <IssueLinkedCardSheet t={t} open={issueSheetOpen} onClose={() => setIssueSheetOpen(false)} walletId={sharedWallet?.id} members={invitableMembers} onIssued={async () => { setIssueSheetOpen(false); await load(); }} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  NAV + HEADER                                                           */
/* ---------------------------------------------------------------------- */

const TABS = [
  { key: "home", label: "navHome", icon: Home },
  { key: "ledger", label: "navLedger", icon: ListChecks },
  { key: "budget", label: "navBudget", icon: Target },
  { key: "pay", label: "navPay", icon: CreditCard },
  { key: "wallets", label: "navWallets", icon: Users },
];

function BottomNav({ t, active, setActive, tr }) {
  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] border-t px-2 pt-2 z-30" style={{ background: t.card, borderColor: t.border, paddingBottom: "max(0.6rem, env(safe-area-inset-bottom))" }}>
      <div className="flex justify-between">
        {TABS.map(({ key, label, icon: Icon }) => {
          const isActive = active === key || (key === "ledger" && active === "ingest");
          return <button key={key} onClick={() => setActive(key)} className="flex-1 flex flex-col items-center gap-1 py-1"><Icon size={20} color={isActive ? t.accent : t.inkFaint} strokeWidth={isActive ? 2.4 : 2} /><span className="text-[10.5px] font-medium" style={{ color: isActive ? t.accent : t.inkFaint }}>{tr(label)}</span></button>;
        })}
      </div>
    </div>
  );
}

function NotificationRow({ t, n, tr, onToggleRead, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = NOTIF_ICON[n.type] || Bell;
  const color = notifTone(n.type, t);

  const toggle = () => { setExpanded((e) => !e); if (!n.read) onToggleRead(n.id, true); };

  return (
    <div className="py-3 px-1 border-b last:border-0" style={{ borderColor: t.border }}>
      <button onClick={toggle} className="w-full flex items-start gap-3 text-left">
        <div className="relative shrink-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${color}1F` }}><Icon size={17} color={color} /></div>
          {!n.read && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: t.danger, border: `2px solid ${t.card}` }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13.5px] truncate" style={{ color: t.ink, fontWeight: n.read ? 500 : 700 }}>{n.title}</p>
            <span className="text-[10.5px] shrink-0" style={{ color: t.inkFaint }}>{new Date(n.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
          </div>
          <p className={expanded ? "text-[12px] mt-1 leading-relaxed" : "text-[12px] mt-0.5 truncate"} style={{ color: t.inkSoft }}>{n.message}</p>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onDelete(n.id); }} className="p-1 rounded-full shrink-0" style={{ background: t.bgSoft }}><Trash2 size={13} color={t.inkFaint} /></button>
      </button>
    </div>
  );
}

function NotificationsPage({ t, notifications, setNotifications, tr, goBack }) {
  const markRead = (id, val) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: val } : n)));
    if (val) api.notifications.markRead(id).catch(() => {});
  };
  const deleteOne = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    api.notifications.delete(id).catch(() => {});
  };
  const clearAll = () => {
    setNotifications([]);
    api.notifications.clearAll().catch(() => {});
  };
  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    api.notifications.markAllRead().catch(() => {});
  };
  const sorted = [...notifications].sort((a, b) => new Date(b.date) - new Date(a.date));

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
          <h1 className="text-[20px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("notifications")}</h1>
        </div>
        {notifications.length > 0 && (
          <button onClick={clearAll} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: t.dangerSoft }}><Trash2 size={14} color={t.danger} /></button>
        )}
      </div>

      {notifications.length > 0 && (
        <button onClick={markAllRead} className="w-full mb-4 py-2.5 rounded-full text-[12.5px] font-semibold flex items-center justify-center gap-1.5" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>
          <CheckCheck size={14} /> {tr("markAllRead")}
        </button>
      )}

      {sorted.length ? (
        <Card t={t} className="px-3">
          {sorted.map((n) => <NotificationRow key={n.id} t={t} n={n} tr={tr} onToggleRead={markRead} onDelete={deleteOne} />)}
        </Card>
      ) : (
        <div className="flex flex-col items-center py-16 text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: t.cardSoft }}><Bell size={22} color={t.inkFaint} /></div>
          <p className="text-[13px]" style={{ color: t.inkFaint }}>{tr("noNotifications")}</p>
        </div>
      )}
    </div>
  );
}

function Avatar({ t, avatarUrl, name, size = 34 }) {
  const initial = (name || "A").charAt(0).toUpperCase();
  return avatarUrl ? (
    <img src={avatarUrl} alt="avatar" className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-bold" style={{ width: size, height: size, background: t.accentSoft, color: t.good, fontSize: size * 0.42, fontFamily: "'Space Grotesk', sans-serif" }}>{initial}</div>
  );
}

function Header({ t, dark, setDark, user, avatarUrl, notifications, language, setLanguage, tr, onAvatarClick, onOpenNotifications }) {
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] z-30 flex items-center justify-between px-4 py-2.5 backdrop-blur" style={{ background: `${t.bg}E6`, borderBottom: `1px solid ${t.border}`, paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}>
      <div className="flex items-center gap-2">
        <MitaPesaMark size={32} />
        <span className="text-[15px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>MitaPesa</span>
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => setLanguage((l) => (l === "en" ? "sw" : "en"))} className="h-8 px-2.5 rounded-full flex items-center gap-1 text-[11.5px] font-bold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>
          <Globe size={13} /> {language.toUpperCase()}
        </button>
        <button onClick={onOpenNotifications} className="relative w-8 h-8 rounded-full flex items-center justify-center" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
          <Bell size={15} color={t.inkSoft} />
          {unread > 0 && <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: t.danger, color: "#fff" }}>{unread > 9 ? "9+" : unread}</span>}
        </button>
        <button onClick={() => setDark((d) => !d)} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>{dark ? <Sun size={15} color={t.gold} /> : <Moon size={15} color={t.inkSoft} />}</button>
        <button onClick={onAvatarClick} className="rounded-full" style={{ border: `2px solid ${t.accent}` }}><Avatar t={t} avatarUrl={avatarUrl} name={user?.firstName} size={30} /></button>
      </div>
    </div>
  );
}

function BundlesSheet({ t, open, onClose, onChanged }) {
  const [bundles, setBundles] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true); setError("");
    Promise.all([api.bundles.list(), api.bundles.mySubscriptions()])
      .then(([b, s]) => { setBundles(b); setSubs(s); })
      .catch((err) => setError(err.message || "Couldn't load bundles."))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (open) load(); }, [open]);

  const activeSubByBundle = Object.fromEntries(subs.filter((s) => s.status === "ACTIVE" && new Date(s.expiresAt) > new Date()).map((s) => [s.bundleId, s]));

  const purchase = async (bundle) => {
    setBusyId(bundle.id); setError("");
    try {
      await api.bundles.purchase(bundle.id);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message || "Couldn't purchase this bundle.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAutoRenew = async (sub) => {
    setBusyId(sub.id); setError("");
    try {
      await api.bundles.setAutoRenew(sub.id, !sub.autoRenew);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message || "Couldn't update auto-renew.");
    } finally {
      setBusyId(null);
    }
  };

  const cancel = async (sub) => {
    setBusyId(sub.id); setError("");
    try {
      await api.bundles.cancel(sub.id);
      load();
      onChanged?.();
    } catch (err) {
      setError(err.message || "Couldn't cancel this bundle.");
    } finally {
      setBusyId(null);
    }
  };

  const validityLabel = { DAILY: "day", WEEKLY: "week", MONTHLY: "month" };

  return (
    <BottomSheet t={t} open={open} onClose={onClose} title="Bundles">
      {loading ? (
        <div className="flex justify-center py-8"><RefreshCw size={18} className="animate-spin" color={t.accent} /></div>
      ) : (
        <>
          {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}
          {bundles.length === 0 ? (
            <p className="text-center text-[13px] py-8" style={{ color: t.inkFaint }}>No bundles available right now.</p>
          ) : (
            <div className="space-y-3">
              {bundles.map((b) => {
                const activeSub = activeSubByBundle[b.id];
                const { vatAmount, totalCharge } = computeBundleVat(b);
                return (
                  <div key={b.id} className="p-3.5 rounded-[16px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[14px] font-bold" style={{ color: t.ink }}>{b.nameEn}</p>
                      <p className="text-[14px] font-bold" style={{ color: t.accent, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(totalCharge)}</p>
                    </div>
                    <p className="text-[11.5px] mb-2" style={{ color: t.inkFaint }}>Per {validityLabel[b.validity]}{b.includedTransactionCount ? ` · ${b.includedTransactionCount} transactions included` : " · Unlimited eligible transactions"}{vatAmount > 0 ? ` · incl. ${fmtTZS(vatAmount)} VAT` : ""}</p>
                    {b.descriptionEn && <p className="text-[12px] mb-2" style={{ color: t.inkSoft }}>{b.descriptionEn}</p>}
                    {activeSub ? (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[11.5px]" style={{ color: t.good }}>Active until {new Date(activeSub.expiresAt).toLocaleDateString()}</p>
                          {b.cancellable && (
                            <button onClick={() => cancel(activeSub)} disabled={busyId === activeSub.id} className="text-[11.5px] font-semibold" style={{ color: t.danger }}>{busyId === activeSub.id ? "…" : "Cancel"}</button>
                          )}
                        </div>
                        <button onClick={() => toggleAutoRenew(activeSub)} disabled={busyId === activeSub.id} className="flex items-center gap-1.5 text-[11px]" style={{ color: t.inkFaint }}>
                          <span className="w-8 h-4.5 rounded-full relative shrink-0 transition-colors" style={{ background: activeSub.autoRenew ? t.accent : t.border }}>
                            <span className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform" style={{ left: activeSub.autoRenew ? 16 : 2 }} />
                          </span>
                          Auto-renew {activeSub.autoRenew ? "on" : "off"}
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => purchase(b)} disabled={busyId === b.id} className="w-full py-2.5 rounded-full font-semibold text-[12.5px]" style={{ background: t.accent, color: "#fff" }}>{busyId === b.id ? "Purchasing…" : "Buy this bundle"}</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}

function BundlesCard({ t }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeSubs, setActiveSubs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.bundles.mySubscriptions()
      .then((subs) => setActiveSubs(subs.filter((s) => s.status === "ACTIVE" && new Date(s.expiresAt) > new Date())))
      .catch(() => setActiveSubs([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <Card t={t} className="p-4">
      <p className="text-[13.5px] font-semibold mb-1" style={{ color: t.ink }}>Bundles</p>
      {loading ? (
        <div className="flex justify-center py-4"><RefreshCw size={16} className="animate-spin" color={t.accent} /></div>
      ) : (
        <>
          {activeSubs.length > 0 ? (
            <div className="mb-3">
              {activeSubs.map((s) => (
                <p key={s.id} className="text-[12.5px]" style={{ color: t.good }}>{s.bundle?.nameEn} active until {new Date(s.expiresAt).toLocaleDateString()}</p>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] mb-3" style={{ color: t.inkFaint }}>Save on transaction fees with a daily, weekly, or monthly bundle.</p>
          )}
          <button onClick={() => setSheetOpen(true)} className="w-full py-3 rounded-full font-semibold text-[13.5px] flex items-center justify-center gap-2" style={{ background: t.accentSoft, color: t.good }}>
            <Package size={15} /> Browse bundles
          </button>
        </>
      )}
      <BundlesSheet t={t} open={sheetOpen} onClose={() => setSheetOpen(false)} onChanged={load} />
    </Card>
  );
}

function PushNotificationsCard({ t }) {
  const [available, setAvailable] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [testSent, setTestSent] = useState(false);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const supported = api.push.isSupported();
      setAvailable(supported);
      if (!supported) return;
      const [settings, sub] = await Promise.all([api.settingsPublic(), api.push.getCurrentSubscription()]);
      setFeatureEnabled(settings.push_notifications_enabled !== "false");
      setSubscribed(!!sub);
    } catch (err) {
      setError(err.message || "Couldn't check notification status.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const enable = async () => {
    setBusy(true); setError(""); setTestSent(false);
    try {
      await api.push.subscribe();
      setSubscribed(true);
    } catch (err) {
      setError(err.message || "Couldn't enable notifications. Check your browser's notification permissions.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true); setError("");
    try {
      await api.push.unsubscribe();
      setSubscribed(false);
    } catch (err) {
      setError(err.message || "Couldn't disable notifications.");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setError(""); setTestSent(false);
    try {
      await api.push.sendTest();
      setTestSent(true);
    } catch (err) {
      setError(err.message || "Couldn't send a test notification.");
    }
  };

  if (!available && !loading) return null; // this browser doesn't support push at all — nothing useful to show

  return (
    <Card t={t} className="p-4">
      <p className="text-[13.5px] font-semibold mb-1" style={{ color: t.ink }}>Push notifications</p>
      {loading ? (
        <div className="flex justify-center py-4"><RefreshCw size={16} className="animate-spin" color={t.accent} /></div>
      ) : !featureEnabled ? (
        <p className="text-[12.5px]" style={{ color: t.inkFaint }}>This feature is currently turned off for the app.</p>
      ) : (
        <>
          <p className="text-[12.5px] mb-3" style={{ color: t.inkFaint }}>Get notified about payments, disputes, and account updates — even when the app isn't open.</p>
          {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}
          {testSent && <p className="text-[12.5px] mb-3" style={{ color: t.good }}>Test notification sent — check your device.</p>}
          {subscribed ? (
            <div className="flex gap-2">
              <button onClick={sendTest} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.ink }}>Send test</button>
              <button onClick={disable} disabled={busy} className="flex-1 py-3 rounded-full font-semibold text-[13.5px]" style={{ background: t.dangerSoft, color: t.danger }}>{busy ? "…" : "Turn off"}</button>
            </div>
          ) : (
            <button onClick={enable} disabled={busy} className="w-full py-3 rounded-full font-semibold text-[13.5px] flex items-center justify-center gap-2" style={{ background: t.accentSoft, color: t.good }}>
              <Bell size={15} /> {busy ? "Enabling…" : "Enable notifications"}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

function BiometricDevicesCard({ t }) {
  const [available, setAvailable] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [creds, settings] = await Promise.all([api.webauthn.listCredentials(), api.settingsPublic()]);
      setDevices(creds);
      setFeatureEnabled(settings.biometric_login_enabled !== "false");
    } catch (err) {
      setError(err.message || "Couldn't load your devices.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setAvailable(api.webauthn.isSupported());
    load();
  }, []);

  const enroll = async () => {
    setEnrolling(true); setError("");
    try {
      const label = navigator.userAgentData?.platform || navigator.platform || "This device";
      await api.webauthn.registerDevice(label);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't set up biometric login on this device.");
    } finally {
      setEnrolling(false);
    }
  };

  const remove = async (id) => {
    setError("");
    try {
      await api.webauthn.removeCredential(id);
      await load();
    } catch (err) {
      setError(err.message || "Couldn't remove this device.");
    }
  };

  if (!available) return null; // this browser/device has no platform authenticator at all — nothing useful to show

  return (
    <Card t={t} className="p-4">
      <p className="text-[13.5px] font-semibold mb-1" style={{ color: t.ink }}>Face ID / fingerprint login</p>
      {!featureEnabled ? (
        <p className="text-[12.5px]" style={{ color: t.inkFaint }}>This feature is currently turned off for the app.</p>
      ) : loading ? (
        <div className="flex justify-center py-4"><RefreshCw size={16} className="animate-spin" color={t.accent} /></div>
      ) : (
        <>
          <p className="text-[12.5px] mb-3" style={{ color: t.inkFaint }}>Skip typing your password on this device next time.</p>
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between py-2" style={{ borderTop: `1px solid ${t.border}` }}>
              <div>
                <p className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{d.deviceLabel || "Device"}</p>
                <p className="text-[10.5px]" style={{ color: t.inkFaint }}>Added {new Date(d.createdAt).toLocaleDateString()}{d.lastUsedAt ? ` · last used ${new Date(d.lastUsedAt).toLocaleDateString()}` : ""}</p>
              </div>
              <button onClick={() => remove(d.id)} className="text-[11.5px] font-semibold" style={{ color: t.danger }}>Remove</button>
            </div>
          ))}
          {error && <p className="text-[12.5px] mt-2 mb-1" style={{ color: t.danger }}>{error}</p>}
          <button onClick={enroll} disabled={enrolling} className="w-full mt-3 py-3 rounded-full font-semibold text-[13.5px] flex items-center justify-center gap-2" style={{ background: t.accentSoft, color: t.good }}>
            <Fingerprint size={15} /> {enrolling ? "Setting up…" : "Set up this device"}
          </button>
        </>
      )}
    </Card>
  );
}

function ChangePasswordCard({ t }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const valid = current.length > 0 && next.length >= 8;

  const submit = async () => {
    setSubmitting(true); setError("");
    try {
      await api.auth.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err.message || "Couldn't change your password. Check your current password and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Card t={t} className="p-4">
        <p className="text-[13.5px] font-semibold mb-1" style={{ color: t.ink }}>Password changed</p>
        <p className="text-[12.5px] mb-3" style={{ color: t.inkFaint }}>For security, you've been logged out everywhere. Please log in again with your new password.</p>
        <PrimaryButton t={t} onClick={() => window.location.reload()}>Log in again</PrimaryButton>
      </Card>
    );
  }

  return (
    <Card t={t} className="p-4">
      <Field t={t} label="Current password"><input style={inputStyle(t)} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field t={t} label="New password"><input style={inputStyle(t)} type="password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
      <PrimaryButton t={t} onClick={submit} disabled={!valid || submitting}>{submitting ? "Changing…" : "Change password"}</PrimaryButton>
    </Card>
  );
}

function NameCorrectionCard({ t, user, onUpdateProfileName, tr }) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [middleName, setMiddleName] = useState(user?.middleName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const nameOk = (v) => v.trim().length > 0 && /^[\p{L} '-]+$/u.test(v.trim());
  const valid = nameOk(firstName) && nameOk(lastName) && (middleName.trim() === "" || nameOk(middleName));
  const startEdit = () => { setFirstName(user?.firstName || ""); setMiddleName(user?.middleName || ""); setLastName(user?.lastName || ""); setError(""); setEditing(true); };

  const save = async () => {
    if (!valid) return;
    setSubmitting(true); setError("");
    try {
      await onUpdateProfileName({ firstName: firstName.trim(), middleName: middleName.trim() || null, lastName: lastName.trim() });
      setEditing(false);
    } catch (err) {
      setError(err.message || "Couldn't save your name. Please check it and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!editing) {
    return (
      <Card t={t} className="p-4 space-y-3.5 mb-5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[12px] font-semibold" style={{ color: t.inkFaint }}>Name</span>
          <button onClick={startEdit} className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: t.accent }}><Pencil size={12} /> Correct name</button>
        </div>
        <div className="flex items-center justify-between"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>{tr("firstName")}</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{user?.firstName || "—"}</span></div>
        {user?.middleName && <div className="flex items-center justify-between"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>Middle name</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{user.middleName}</span></div>}
        <div className="flex items-center justify-between"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>{tr("lastName")}</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{user?.lastName || "—"}</span></div>
        <div className="flex items-center justify-between"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>{tr("email")}</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink }}>{user?.email || "—"}</span></div>
        <div className="flex items-center justify-between"><span className="text-[12.5px]" style={{ color: t.inkFaint }}>{tr("phone")}</span><span className="text-[13.5px] font-semibold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{user?.phone ? `+255 ${user.phone}` : "—"}</span></div>
      </Card>
    );
  }

  return (
    <Card t={t} className="p-4 mb-5">
      <p className="text-[12px] font-semibold mb-3" style={{ color: t.inkFaint }}>Correct your name</p>
      <Field t={t} label="First name"><input style={inputStyle(t)} value={firstName} onChange={(e) => setFirstName(e.target.value)} /></Field>
      <Field t={t} label="Middle name (optional)"><input style={inputStyle(t)} value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="—" /></Field>
      <Field t={t} label="Last name"><input style={inputStyle(t)} value={lastName} onChange={(e) => setLastName(e.target.value)} /></Field>
      {error && <p className="text-[12px] mb-3" style={{ color: t.danger }}>{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setEditing(false)} className="flex-1 py-3 rounded-full font-semibold text-[13px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, color: t.inkSoft }}>Cancel</button>
        <button onClick={save} disabled={!valid || submitting} className="flex-1 py-3 rounded-full font-semibold text-[13px]" style={{ background: t.accent, color: "#fff", opacity: valid && !submitting ? 1 : 0.5 }}>{submitting ? "Saving…" : "Save"}</button>
      </div>
    </Card>
  );
}

function AdminSettingsTab({ t }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const LABELS = {
    household_max_members: "Max household members", card_bin: "Card BIN prefix", cms_provider_label: "CMS provider label",
    partner_bank_acquirer_id: "Partner bank TIPS Acquirer ID", qr_test_samples_enabled: "QR test payment samples",
    qr_manual_payload_paste_enabled: "QR manual payload paste (dev only)", qr_step_up_threshold: "Step-up confirmation threshold (TZS)",
    cbs_simulated_failure_rate: "Simulated CBS failure rate (%)", tips_simulated_failure_rate: "Simulated TIPS failure rate (%)",
    biometric_login_enabled: "Biometric login (Face ID / fingerprint)",
    push_notifications_enabled: "Push notifications",
    receipt_ocr_enabled: "Receipt scanning (OCR)",
    pfm_export_enabled: "Transaction/insights export (CSV)",
    multi_currency_enabled: "Multi-currency PFM (customer running currency)",
    available_currencies: "Available currencies",
    verification_method: "Onboarding verification method",
  };
  const HELP = {
    household_max_members: "Caps invited members per shared wallet (Requirement 1).",
    card_bin: "6-digit prefix used when generating card numbers — mirrors how a real CMS ties BIN to a card Product.",
    cms_provider_label: "Display label only — doesn't change which provider is active (that's an env var).",
    partner_bank_acquirer_id: "5-digit TIPS Acquirer ID — a scanned QR matching this settles on-us; anything else routes via TIPS.",
    qr_test_samples_enabled: "\"true\"/\"false\" — turn off before customers use the live app, so nobody sees a test-payment hint.",
    qr_manual_payload_paste_enabled: "\"true\"/\"false\" — the raw-payload paste field is a developer convenience, never a real customer path. Turn off before launch.",
    qr_step_up_threshold: "Amounts above this (but under the KYC threshold) require password/biometric confirmation; at or below it, payments proceed with no extra step.",
    cbs_simulated_failure_rate: "0-100 — injects simulated CBS posting failures, to test the automatic-reversal logic.",
    tips_simulated_failure_rate: "0-100 — injects simulated TIPS routing failures/pending states.",
    biometric_login_enabled: "\"true\"/\"false\" — turns off BOTH new device enrollment and login for every customer's existing enrolled devices, immediately.",
    push_notifications_enabled: "\"true\"/\"false\" — turns off both new subscriptions and sending, immediately. The in-app notification list still works either way.",
    receipt_ocr_enabled: "\"true\"/\"false\" — turns off receipt scanning immediately; customers are directed to add expenses manually instead. Which OCR provider actually runs (mock / openai_vision / gemini_vision) is set via OCR_PROVIDER, an environment variable, not here.",
    pfm_export_enabled: "\"true\"/\"false\" — turns off the customer-facing transaction/insights CSV export immediately. Separate from the card statement export, which isn't affected by this.",
    multi_currency_enabled: "\"true\"/\"false\" — turns off the ability for customers to change their running currency immediately. Doesn't affect anyone already set to a non-TZS currency; they keep their current setting, they just can't change it further while this is off.",
    available_currencies: "Comma-separated ISO 4217 codes, e.g. \"TZS,USD,KES,ZAR\" — which currencies customers can choose as their running currency. The actual conversion rate source is set via EXCHANGE_RATE_PROVIDER, an environment variable, not here.",
    verification_method: "Exactly \"sms\" or \"email\" — which channel new customers verify through during onboarding. Only one is ever active; setting this to one automatically means the other is off.",
  };

  const load = async () => {
    setLoading(true); setError("");
    try { setSettings(await api.admin.listSettings()); }
    catch (err) { setError(err.message || "Couldn't load settings."); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const save = async (key) => {
    setSaving(true); setError("");
    try { await api.admin.updateSetting(key, editValue); await load(); setEditingKey(null); }
    catch (err) { setError(err.message || "Couldn't save."); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex justify-center py-10"><RefreshCw size={20} className="animate-spin" color={t.accent} /></div>;

  return (
    <div className="space-y-3">
      {error && <p className="text-[12.5px]" style={{ color: t.danger }}>{error}</p>}
      {Object.entries(settings || {}).map(([key, value]) => (
        <Card t={t} key={key} className="p-4">
          <p className="text-[12.5px] font-semibold mb-0.5" style={{ color: t.ink }}>{LABELS[key] || key}</p>
          <p className="text-[11px] mb-2.5" style={{ color: t.inkFaint }}>{HELP[key] || ""}</p>
          {editingKey === key ? (
            <div className="flex gap-2">
              <input style={{ ...inputStyle(t), flex: 1 }} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
              <button onClick={() => save(key)} disabled={saving} className="px-4 rounded-[13px] font-semibold text-[13px]" style={{ background: t.accent, color: "#fff" }}>{saving ? "…" : "Save"}</button>
              <button onClick={() => setEditingKey(null)} className="px-3 rounded-[13px]" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}><X size={14} color={t.inkFaint} /></button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <p className="text-[14px] font-bold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{value}</p>
              <button onClick={() => { setEditingKey(key); setEditValue(value); }} className="text-[12px] font-semibold" style={{ color: t.accent }}>Edit</button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function AdminUsersTab({ t }) {
  const pageSize = 20;
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [overview, setOverview] = useState(null);
  const [kyc, setKyc] = useState(null);
  const [kycLoading, setKycLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await api.admin.listUsers(search, page, pageSize); setUsers(r.users); setTotal(r.total); }
    catch (err) { console.error("Failed to load users", err); } // eslint-disable-line no-console
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [page]);
  const doSearch = () => { setPage(1); load(); };

  const openUser = async (u) => {
    setSelected(u); setOverview(null); setKyc(null);
    try { setOverview(await api.admin.getUserOverview(u.id)); }
    catch (err) { console.error("Failed to load user overview", err); } // eslint-disable-line no-console
  };
  const loadKyc = async () => {
    setKycLoading(true);
    try { setKyc(await api.admin.getUserKyc(selected.id)); }
    catch (err) { setKyc({ error: err.message || "No NIDA profile on file." }); }
    finally { setKycLoading(false); }
  };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input style={{ ...inputStyle(t), flex: 1 }} placeholder="Search name, email, phone" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        <button onClick={doSearch} className="px-4 rounded-[13px]" style={{ background: t.accent }}><Search size={15} color="#fff" /></button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><RefreshCw size={18} className="animate-spin" color={t.accent} /></div>
      ) : (
        <>
          <Card t={t} className="px-3 mb-3">
            {users.length ? users.map((u) => (
              <button key={u.id} onClick={() => openUser(u)} className="w-full flex items-center justify-between py-3 text-left" style={{ borderBottom: `1px solid ${t.border}` }}>
                <div><p className="text-[13px] font-semibold" style={{ color: t.ink }}>{u.firstName} {u.lastName}</p><p className="text-[11px]" style={{ color: t.inkFaint }}>{u.email} · {u.phone}</p></div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ml-2" style={{ background: u.kycStatus === "VERIFIED" ? t.accentSoft : t.bgSoft, color: u.kycStatus === "VERIFIED" ? t.good : t.inkFaint }}>{u.kycStatus}</span>
              </button>
            )) : <p className="text-center text-[13px] py-6" style={{ color: t.inkFaint }}>No users found.</p>}
          </Card>
          <div className="flex items-center justify-between">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, opacity: page <= 1 ? 0.4 : 1 }}>Prev</button>
            <p className="text-[11.5px]" style={{ color: t.inkFaint }}>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</p>
            <button disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, opacity: page * pageSize >= total ? 0.4 : 1 }}>Next</button>
          </div>
        </>
      )}

      <BottomSheet t={t} open={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.firstName} ${selected.lastName}` : ""}>
        {!overview ? (
          <div className="flex justify-center py-8"><RefreshCw size={18} className="animate-spin" color={t.accent} /></div>
        ) : (
          <>
            <Card t={t} className="p-4 mb-3 space-y-2">
              <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>Email</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{overview.user.email}</span></div>
              <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>Phone</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>+255 {overview.user.phone}</span></div>
              <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>KYC status</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{overview.user.kycStatus}</span></div>
              <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>Role</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{overview.user.role}</span></div>
              {overview.card && <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>Card balance</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmtTZS(overview.card.balance)}</span></div>}
              {overview.card?.processorRef && <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>CMS wallet ref</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{overview.card.processorRef}</span></div>}
              <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>Add-on cards</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{overview.virtualCardCount}</span></div>
              <div className="flex justify-between"><span className="text-[12px]" style={{ color: t.inkFaint }}>Wallets</span><span className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{overview.walletCount}</span></div>
            </Card>

            {overview.kyc && (
              <Card t={t} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[12.5px] font-semibold" style={{ color: t.ink }}>NIDA profile ({overview.kyc.syncStatus})</p>
                  {!kyc && <button onClick={loadKyc} disabled={kycLoading} className="text-[11.5px] font-semibold" style={{ color: t.accent }}>{kycLoading ? "Loading…" : "View (audit-logged)"}</button>}
                </div>
                {kyc && !kyc.error && (
                  <div className="space-y-1.5">
                    {Object.entries(kyc).filter(([k]) => !["sourceProvider", "syncStatus", "syncError", "syncedAt", "lastAttemptAt", "photoUrl"].includes(k)).map(([k, v]) => (
                      <div key={k} className="flex justify-between"><span className="text-[11.5px]" style={{ color: t.inkFaint }}>{k}</span><span className="text-[11.5px] font-semibold" style={{ color: t.ink }}>{v || "—"}</span></div>
                    ))}
                  </div>
                )}
                {kyc?.error && <p className="text-[12px]" style={{ color: t.danger }}>{kyc.error}</p>}
              </Card>
            )}
          </>
        )}
      </BottomSheet>
    </div>
  );
}

function AdminAuditTab({ t }) {
  const pageSize = 25;
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { const r = await api.admin.listAuditLogs({ action: actionFilter, page, pageSize }); setLogs(r.logs); setTotal(r.total); }
    catch (err) { console.error("Failed to load audit logs", err); } // eslint-disable-line no-console
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [page]);
  const applyFilter = () => { setPage(1); load(); };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input style={{ ...inputStyle(t), flex: 1 }} placeholder="Filter by action (e.g. virtualcard)" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyFilter()} />
        <button onClick={applyFilter} className="px-4 rounded-[13px]" style={{ background: t.accent }}><Search size={15} color="#fff" /></button>
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><RefreshCw size={18} className="animate-spin" color={t.accent} /></div>
      ) : (
        <>
          <Card t={t} className="px-3 mb-3">
            {logs.length ? logs.map((l) => (
              <div key={l.id} className="py-2.5" style={{ borderBottom: `1px solid ${t.border}` }}>
                <div className="flex items-center justify-between"><p className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{l.action}</p><p className="text-[10.5px]" style={{ color: t.inkFaint }}>{new Date(l.createdAt).toLocaleString()}</p></div>
                <p className="text-[10.5px]" style={{ color: t.inkFaint }}>{l.userId ? `user ${l.userId.slice(0, 8)}…` : "system"}{l.ip ? ` · ${l.ip}` : ""}{l.amount !== null ? ` · ${fmtTZS(l.amount)}` : ""}</p>
              </div>
            )) : <p className="text-center text-[13px] py-6" style={{ color: t.inkFaint }}>No matching entries.</p>}
          </Card>
          <div className="flex items-center justify-between">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, opacity: page <= 1 ? 0.4 : 1 }}>Prev</button>
            <p className="text-[11.5px]" style={{ color: t.inkFaint }}>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</p>
            <button disabled={page * pageSize >= total} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: t.cardSoft, border: `1px solid ${t.border}`, opacity: page * pageSize >= total ? 0.4 : 1 }}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}

function AdminPage({ t, goBack }) {
  const [tab, setTab] = useState("settings");
  const tabs = [
    { key: "settings", label: "Settings", icon: SlidersHorizontal },
    { key: "users", label: "Users", icon: Users },
    { key: "audit", label: "Audit log", icon: FileText },
  ];
  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[20px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Admin portal</h1>
      </div>
      <div className="flex p-1 rounded-full mb-5" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-full text-[12.5px] font-semibold transition-colors" style={{ background: tab === key ? t.card : "transparent", color: tab === key ? t.ink : t.inkFaint, boxShadow: tab === key ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>
      {tab === "settings" && <AdminSettingsTab t={t} />}
      {tab === "users" && <AdminUsersTab t={t} />}
      {tab === "audit" && <AdminAuditTab t={t} />}
    </div>
  );
}

const TICKET_CATEGORIES = [
  { key: "dispute", label: "Transaction dispute" },
  { key: "fraud", label: "Fraud / unauthorized activity" },
  { key: "complaint", label: "Complaint" },
  { key: "inquiry", label: "General inquiry" },
];

function TicketStatusBadge({ t, status }) {
  const tones = { open: [t.dangerSoft, t.danger], in_progress: [t.goldSoft, t.gold], resolved: [t.accentSoft, t.good], closed: [t.bgSoft, t.inkFaint] };
  const [bg, color] = tones[status] || tones.closed;
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: bg, color }}>{status.replace("_", " ").toUpperCase()}</span>;
}

function NewTicketForm({ t, transactions, onSubmitted }) {
  const [category, setCategory] = useState("dispute");
  const [txMode, setTxMode] = useState(null); // null | "none" | "pick" | "manual"
  const [selectedTx, setSelectedTx] = useState(null);
  const [txSearch, setTxSearch] = useState("");
  const [manualRef, setManualRef] = useState("");
  const [manualDate, setManualDate] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualMerchant, setManualMerchant] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const isTransactionCategory = category === "dispute" || category === "fraud";
  const filteredTx = transactions.filter((x) => !txSearch || x.merchant.toLowerCase().includes(txSearch.toLowerCase())).slice(0, 30);

  const canSubmit =
    subject.trim().length >= 3 &&
    description.trim().length >= 3 &&
    (!isTransactionCategory || txMode === "none" || (txMode === "pick" && selectedTx) || (txMode === "manual" && manualAmount));

  const submit = async () => {
    setSubmitting(true); setError("");
    try {
      const body = { category, subject: subject.trim(), description: description.trim() };
      if (isTransactionCategory && txMode === "pick" && selectedTx) {
        body.relatedTransactionId = selectedTx.id;
      } else if (isTransactionCategory && txMode === "manual") {
        if (manualRef) body.disputedReference = manualRef;
        if (manualDate) body.disputedDate = new Date(manualDate).toISOString();
        if (manualAmount) body.disputedAmount = parseFloat(manualAmount);
        if (manualMerchant) body.disputedMerchant = manualMerchant;
      }
      const ticket = await api.support.createTicket(body);
      setDone(true);
      onSubmitted?.(ticket);
    } catch (err) {
      setError(err.message || "Couldn't submit your request.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center py-10 text-center">
        <div className="w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: t.accentSoft }}><Check size={22} color={t.good} /></div>
        <p className="text-[14px] font-semibold" style={{ color: t.ink }}>Request submitted</p>
        <p className="text-[12.5px] mt-1 max-w-[260px]" style={{ color: t.inkFaint }}>We'll follow up by email or in-app. Check its status anytime under "My requests."</p>
      </div>
    );
  }

  return (
    <div>
      <SectionLabel t={t}>What's this about?</SectionLabel>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {TICKET_CATEGORIES.map((c) => (
          <button key={c.key} onClick={() => { setCategory(c.key); setTxMode(null); setSelectedTx(null); }} className="p-3 rounded-[14px] text-left" style={{ background: category === c.key ? t.accent : t.cardSoft, border: `1px solid ${category === c.key ? t.accent : t.border}` }}>
            <span className="text-[12.5px] font-semibold" style={{ color: category === c.key ? "#fff" : t.ink }}>{c.label}</span>
          </button>
        ))}
      </div>

      {isTransactionCategory && (
        <>
          <SectionLabel t={t}>Is this about a specific transaction?</SectionLabel>
          <div className="flex gap-2 mb-2">
            <button onClick={() => setTxMode("pick")} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold" style={{ background: txMode === "pick" ? t.accent : t.cardSoft, color: txMode === "pick" ? "#fff" : t.inkSoft, border: `1px solid ${t.border}` }}>Pick from my transactions</button>
            <button onClick={() => setTxMode("manual")} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold" style={{ background: txMode === "manual" ? t.accent : t.cardSoft, color: txMode === "manual" ? "#fff" : t.inkSoft, border: `1px solid ${t.border}` }}>Enter from a statement</button>
          </div>
          <button onClick={() => setTxMode("none")} className="text-[12px] font-semibold mb-4 block" style={{ color: txMode === "none" ? t.accent : t.inkFaint }}>Not about a specific transaction →</button>

          {txMode === "pick" && (
            <div className="mb-4">
              {!selectedTx ? (
                <>
                  <Field t={t} label="Search your transactions"><input style={inputStyle(t)} placeholder="Merchant name…" value={txSearch} onChange={(e) => setTxSearch(e.target.value)} /></Field>
                  <Card t={t} className="px-3 max-h-64 overflow-y-auto">
                    {filteredTx.length ? filteredTx.map((tx) => (
                      <button key={tx.id} onClick={() => setSelectedTx(tx)} className="w-full flex items-center justify-between py-2.5 text-left" style={{ borderBottom: `1px solid ${t.border}` }}>
                        <div><p className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{tx.merchant}</p><p className="text-[11px]" style={{ color: t.inkFaint }}>{tx.date}{tx.reference ? ` · ${tx.reference}` : ""}</p></div>
                        <p className="text-[12.5px] font-semibold shrink-0 ml-2" style={{ color: t.ink, fontFamily: "'IBM Plex Mono', monospace" }}>{fmt(tx.amount)}</p>
                      </button>
                    )) : <p className="text-center text-[12.5px] py-6" style={{ color: t.inkFaint }}>No matching transactions.</p>}
                  </Card>
                </>
              ) : (
                <div className="p-3.5 rounded-[14px]" style={{ background: t.accentSoft }}>
                  <div className="flex items-center justify-between mb-1"><p className="text-[12.5px] font-semibold" style={{ color: t.ink }}>{selectedTx.merchant}</p><button onClick={() => setSelectedTx(null)} className="text-[11.5px] font-semibold" style={{ color: t.accent }}>Change</button></div>
                  <p className="text-[11.5px]" style={{ color: t.inkSoft }}>{selectedTx.date} · {fmt(selectedTx.amount)}{selectedTx.reference ? ` · Ref ${selectedTx.reference}` : ""}</p>
                </div>
              )}
            </div>
          )}

          {txMode === "manual" && (
            <div className="mb-4">
              <Field t={t} label="Transaction reference (if known)"><input style={inputStyle(t)} value={manualRef} onChange={(e) => setManualRef(e.target.value)} placeholder="e.g. PSM-A1B2C3" /></Field>
              <Field t={t} label="Transaction date"><input style={inputStyle(t)} type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} /></Field>
              <Field t={t} label="Amount (TZS)">
                <input style={inputStyle(t)} type="number" value={manualAmount} onChange={(e) => setManualAmount(e.target.value)} placeholder="0.00" />
                <CurrencyEquivalentHint t={t} amountTZS={manualAmount} />
              </Field>
              <Field t={t} label="Merchant / description (optional)"><input style={inputStyle(t)} value={manualMerchant} onChange={(e) => setManualMerchant(e.target.value)} /></Field>
            </div>
          )}
        </>
      )}

      <SectionLabel t={t}>Tell us more</SectionLabel>
      <Field t={t} label="Subject"><input style={inputStyle(t)} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" /></Field>
      <Field t={t} label="Details"><textarea style={{ ...inputStyle(t), height: 110, resize: "none" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What happened?" /></Field>

      {error && <p className="text-[12.5px] mb-3" style={{ color: t.danger }}>{error}</p>}
      <PrimaryButton t={t} disabled={!canSubmit || submitting} onClick={submit}>{submitting ? "Submitting…" : "Submit request"}</PrimaryButton>
    </div>
  );
}

function MyTicketsList({ t }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => { api.support.listTickets().then(setTickets).catch(() => {}).finally(() => setLoading(false)); }, []);

  if (loading) return <div className="flex justify-center py-10"><RefreshCw size={18} className="animate-spin" color={t.accent} /></div>;
  if (!tickets.length) return <p className="text-center text-[13px] py-10" style={{ color: t.inkFaint }}>No requests yet.</p>;

  return (
    <div className="space-y-2">
      {tickets.map((tk) => (
        <Card t={t} key={tk.id} className="p-4">
          <button onClick={() => setExpandedId(expandedId === tk.id ? null : tk.id)} className="w-full text-left">
            <div className="flex items-center justify-between mb-1 gap-2">
              <p className="text-[13px] font-semibold" style={{ color: t.ink }}>{tk.subject}</p>
              <TicketStatusBadge t={t} status={tk.status} />
            </div>
            <p className="text-[11.5px]" style={{ color: t.inkFaint }}>{TICKET_CATEGORIES.find((c) => c.key === tk.category)?.label} · {new Date(tk.createdAt).toLocaleDateString()}</p>
          </button>
          {expandedId === tk.id && (
            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${t.border}` }}>
              <p className="text-[12.5px] mb-2" style={{ color: t.inkSoft }}>{tk.description}</p>
              {tk.disputedAmount !== null && tk.disputedAmount !== undefined && (
                <p className="text-[11.5px]" style={{ color: t.inkFaint }}>Disputed: {tk.disputedMerchant || "—"} · {fmt(-Math.abs(tk.disputedAmount))}{tk.disputedReference ? ` · Ref ${tk.disputedReference}` : ""}{tk.disputedDate ? ` · ${new Date(tk.disputedDate).toLocaleDateString()}` : ""}</p>
              )}
              {tk.resolutionNotes && (
                <div className="mt-2 p-2.5 rounded-[10px]" style={{ background: t.bgSoft }}>
                  <p className="text-[11px] font-semibold mb-0.5" style={{ color: t.inkFaint }}>Resolution</p>
                  <p className="text-[12px]" style={{ color: t.ink }}>{tk.resolutionNotes}</p>
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function SupportPage({ t, transactions, goBack }) {
  const [view, setView] = useState("new");
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[20px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>Help & support</h1>
      </div>

      <div className="flex p-1 rounded-full mb-5" style={{ background: t.bgSoft, border: `1px solid ${t.border}` }}>
        {[{ key: "new", label: "New request" }, { key: "mine", label: "My requests" }].map(({ key, label }) => (
          <button key={key} onClick={() => setView(key)} className="flex-1 py-2.5 rounded-full text-[12.5px] font-semibold" style={{ background: view === key ? t.card : "transparent", color: view === key ? t.ink : t.inkFaint, boxShadow: view === key ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>{label}</button>
        ))}
      </div>

      {view === "new" && <NewTicketForm t={t} transactions={transactions} onSubmitted={() => { setView("mine"); setRefreshKey((k) => k + 1); }} />}
      {view === "mine" && <MyTicketsList key={refreshKey} t={t} />}
    </div>
  );
}

function CurrencyPreferenceCard({ t }) {
  const [available, setAvailable] = useState(false);
  const [currencies, setCurrencies] = useState([]);
  const [current, setCurrent] = useState("TZS");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = async () => {
    setLoading(true); setLoadError("");
    try {
      const [settings, me] = await Promise.all([api.settingsPublic(), api.auth.me()]);
      const enabled = settings.multi_currency_enabled !== "false";
      setAvailable(enabled);
      if (!enabled) return;
      setCurrencies((settings.available_currencies || "TZS").split(",").map((c) => c.trim()).filter(Boolean));
      setCurrent(me.preferredCurrency || "TZS");
    } catch (err) {
      setLoadError(err.message || "Couldn't load currency settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const change = async (currency) => {
    if (currency === current) return;
    setSaving(true); setSaveError(""); setSaved(false);
    try {
      const user = await api.auth.setCurrency(currency);
      setDisplayCurrency(user.preferredCurrency, user.currencyRate);
      setSaved(true);
      // A full reload is the simplest reliable way to guarantee every
      // already-rendered amount across the app picks up the new
      // currency — matches the same approach already used for logout,
      // for the same reason (this app doesn't thread currency through
      // component props, by design — see the note near fmt/fmtTZS).
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      setSaveError(err.message || "Couldn't update your currency.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;
  if (loadError) {
    return (
      <Card t={t} className="p-4">
        <p className="text-[12.5px]" style={{ color: t.danger }}>{loadError}</p>
      </Card>
    );
  }
  if (!available) return null; // the admin toggle is a real kill switch here, not just a disabled-state message — this feature isn't ready for general display until fmt()/fmtTZS() also respect it

  return (
    <Card t={t} className="p-4">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: t.accentSoft }}><Globe size={16} color={t.accent} /></div>
        <div>
          <p className="text-[13.5px] font-semibold" style={{ color: t.ink }}>Running currency</p>
          <p className="text-[11.5px]" style={{ color: t.inkFaint }}>Your wallet balance stays TZS — this is just how your Insights, Budget, and Ledger figures are shown.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        {currencies.map((c) => (
          <button
            key={c} onClick={() => change(c)} disabled={saving}
            className="px-3 py-1.5 rounded-full text-[12.5px] font-semibold"
            style={c === current ? { background: t.accent, color: "#fff" } : { background: t.cardSoft, color: t.inkSoft, border: `1px solid ${t.border}` }}
          >
            {c}
          </button>
        ))}
      </div>
      {saved && <p className="text-[11.5px] mt-2" style={{ color: t.good }}>Updated.</p>}
      {saveError && <p className="text-[11.5px] mt-2" style={{ color: t.danger }}>{saveError}</p>}
    </Card>
  );
}

// One parameterized page for every Profile setting that used to be an
// inline card directly on the Profile page — each was taking up real
// vertical space whether or not the customer cared about it right now.
// A single page keyed by `setting` avoids duplicating the same back-
// button/title wrapper six separate times for what's otherwise the same
// shape of screen.
function ProfileSettingPage({ t, setting, goBack, user, onUpdateProfileName, tr }) {
  const CONFIG = {
    accountDetails: { title: tr("accountDetails"), render: () => <NameCorrectionCard t={t} user={user} onUpdateProfileName={onUpdateProfileName} tr={tr} /> },
    bundles: { title: "Transactional bundles", render: () => <BundlesCard t={t} /> },
    pushNotifications: { title: "Push notifications", render: () => <PushNotificationsCard t={t} /> },
    currency: { title: "Running currency", render: () => <CurrencyPreferenceCard t={t} /> },
    biometric: { title: "Face ID / biometric login", render: () => <BiometricDevicesCard t={t} /> },
    password: { title: "Change password", render: () => <ChangePasswordCard t={t} /> },
  };
  const entry = CONFIG[setting];
  if (!entry) return null;

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center gap-2 mb-4">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[19px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{entry.title}</h1>
      </div>
      {entry.render()}
    </div>
  );
}

function ProfilePage({ t, user, avatarUrl, setAvatarUrl, goBack, tr, onLogout, onUpdateProfileName, onGoAdmin, onGoSupport, onOpenSetting, kycVerified }) {
  const fileRef = useRef(null);
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(reader.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center gap-2 mb-5">
        <button onClick={goBack} className="p-1.5 -ml-1.5 rounded-full" style={{ background: t.cardSoft }}><ArrowLeft size={16} color={t.inkSoft} /></button>
        <h1 className="text-[20px] font-bold" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{tr("profile")}</h1>
      </div>

      <div className="flex flex-col items-center mb-6">
        <div className="relative">
          <Avatar t={t} avatarUrl={avatarUrl} name={user?.firstName} size={92} />
          <button onClick={() => fileRef.current?.click()} className="absolute bottom-0 right-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: t.accent, border: `2px solid ${t.bg}` }}><Camera size={14} color="#fff" /></button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        <p className="text-[16px] font-bold mt-3" style={{ color: t.ink, fontFamily: "'Space Grotesk', sans-serif" }}>{user?.firstName} {user?.lastName}</p>
        <p className="text-[12.5px]" style={{ color: t.inkFaint }}>{user?.email}</p>
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full mt-2" style={{ background: kycVerified ? t.accentSoft : t.bgSoft }}>
          {kycVerified ? <BadgeCheck size={13} color={t.good} /> : <Fingerprint size={13} color={t.inkFaint} />}
          <span className="text-[11px] font-semibold" style={{ color: kycVerified ? t.good : t.inkFaint }}>{kycVerified ? tr("nidaVerified") : tr("basicUpTo", fmtTZS(KYC_THRESHOLD))}</span>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => fileRef.current?.click()} className="px-3.5 py-2 rounded-full text-[12.5px] font-semibold flex items-center gap-1.5" style={{ background: t.accentSoft, color: t.good }}><ImageIcon size={13} /> {tr("changePhoto")}</button>
          {avatarUrl && <button onClick={() => setAvatarUrl(null)} className="px-3.5 py-2 rounded-full text-[12.5px] font-semibold flex items-center gap-1.5" style={{ background: t.dangerSoft, color: t.danger }}><Trash2 size={13} /> {tr("removePhoto")}</button>}
        </div>
      </div>

      <SectionLabel t={t}>Settings</SectionLabel>
      {[
        { key: "accountDetails", label: tr("accountDetails"), icon: User },
        { key: "currency", label: "Running currency", icon: Globe },
        { key: "biometric", label: "Face ID / biometric login", icon: Fingerprint },
        { key: "password", label: "Change password", icon: Lock },
        { key: "bundles", label: "Transactional bundles", icon: Package },
        { key: "pushNotifications", label: "Push notifications", icon: Bell },
      ].map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => onOpenSetting(key)} className="w-full flex items-center justify-between p-3.5 rounded-[14px] mb-2.5" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
          <div className="flex items-center gap-2.5"><Icon size={16} color={t.inkSoft} /><span className="text-[13px] font-semibold" style={{ color: t.ink }}>{label}</span></div>
          <ChevronRight size={16} color={t.inkFaint} />
        </button>
      ))}

      <button onClick={onGoSupport} className="w-full flex items-center justify-between p-3.5 rounded-[14px] mb-3" style={{ background: t.cardSoft, border: `1px solid ${t.border}` }}>
        <div className="flex items-center gap-2.5"><MessageSquareWarning size={16} color={t.accent} /><span className="text-[13px] font-semibold" style={{ color: t.ink }}>Help & support</span></div>
        <ChevronRight size={16} color={t.inkFaint} />
      </button>

      {user?.role?.startsWith("admin_") && (
        <button onClick={onGoAdmin} className="w-full flex items-center justify-between p-3.5 rounded-[14px] mb-3" style={{ background: t.goldSoft, border: `1px solid ${t.border}` }}>
          <div className="flex items-center gap-2.5"><ShieldCheck size={16} color={t.gold} /><span className="text-[13px] font-semibold" style={{ color: t.ink }}>Admin portal</span></div>
          <ChevronRight size={16} color={t.inkFaint} />
        </button>
      )}

      <button onClick={onLogout} className="w-full py-3.5 rounded-full font-semibold text-[14px] flex items-center justify-center gap-2" style={{ background: t.dangerSoft, color: t.danger }}><LogOut size={16} /> Log out</button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  ROOT APP                                                               */
/* ---------------------------------------------------------------------- */

// If any component throws during render, this catches it and shows a
// recoverable screen instead of leaving a blank white page with no way
// back in — the failure mode that motivated adding this in the first place.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error?.message, "\nStack:", error?.stack, "\nComponent stack:", info?.componentStack); // eslint-disable-line no-console
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center" style={{ background: "#F6F5F1" }}>
          <p className="text-[16px] font-bold mb-2" style={{ color: "#1A1D1C", fontFamily: "'Space Grotesk', sans-serif" }}>Something went wrong</p>
          <p className="text-[13px] mb-5" style={{ color: "#8A8F8C", maxWidth: 280 }}>The app hit an unexpected error. Your data is safe — reloading should fix it.</p>
          <button onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-full text-[13px] font-semibold" style={{ background: "#1F6F5C", color: "#fff" }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const [dark, setDark] = useState(() => localStorage.getItem("mitapesa_dark_mode") === "true");
  const t = dark ? THEME.dark : THEME.light;
  useEffect(() => {
    // Makes the status bar transparent so the app's own background shows
    // through it, rather than a separate opaque bar — this only needs
    // setting once, it isn't theme-dependent. Safe to call on web too;
    // the native plugin no-ops outside a native platform.
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  }, []);
  useEffect(() => {
    localStorage.setItem("mitapesa_dark_mode", dark ? "true" : "false");
    // Keep the now-transparent status bar's text/icon color legible
    // against whichever background is actually showing — dark background
    // needs light content, light background needs dark content.
    // Style.Dark = light text, for a dark background. Style.Light = dark
    // text, for a light background — the naming is the opposite of what
    // it sounds like, easy to get backwards (confirmed we did, initially).
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  }, [dark]);
  const [onboarded, setOnboarded] = useState(false);
  const [authChecking, setAuthChecking] = useState(true); // trying to restore a session before showing onboarding
  const [dataLoading, setDataLoading] = useState(false);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(null);
  // Sets the flag Onboarding checks to skip the welcome slides for a
  // returning customer — called at every point a session becomes valid
  // (session restore, register, login, biometric login), not just once.
  const markLoggedIn = (u) => {
    setUser(u);
    localStorage.setItem("mitapesa_has_account", "true");
  };
  const [active, setActive] = useState("home");
  const [walletActivityParams, setWalletActivityParams] = useState(null);
  const openWalletActivity = (params) => { setWalletActivityParams(params); setActive("walletActivity"); };
  const [profileSetting, setProfileSetting] = useState(null);
  const openProfileSetting = (key) => { setProfileSetting(key); setActive("profileSetting"); };
  const [profileReturnTab, setProfileReturnTab] = useState("home");
  const [notificationsReturnTab, setNotificationsReturnTab] = useState("home");
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState(initialBudgets); // replaced by api.budgets.list() once loadAllData runs
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [walletsList, setWalletsList] = useState([]); // [{ id, type }] from the backend
  const [myInvites, setMyInvites] = useState([]); // pending wallet invites addressed to me

  const [cardBalance, setCardBalance] = useState(0);
  const [cardLast4, setCardLast4] = useState("");
  const [cardActivity, setCardActivity] = useState([]);
  const [cardFrozen, setCardFrozen] = useState(false);
  const [cardControls, setCardControls] = useState({ online: true, contactless: true, atm: true });
  const [dailyLimit, setDailyLimit] = useState(500000);
  const [kycVerified, setKycVerified] = useState(false);
  const [payModuleEnabled, setPayModuleEnabled] = useState(true); // defaults true — matches the backend's own default, and avoids a flash of "Coming soon" while the real setting is still loading

  const [language, setLanguage] = useState("en");
  const [notifications, setNotifications] = useState([]);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const tr = makeTr(language);

  // --- lookup context passed to api.transactions.* to translate between
  // this component tree's name-based shapes and the backend's id-based ones ---
  const walletIdByType = { personal: walletsList.find((w) => w.type === "PERSONAL")?.id, shared: walletsList.find((w) => w.type === "SHARED")?.id };
  const walletTypeById = Object.fromEntries(walletsList.map((w) => [w.id, w.type]));
  const categoryIdByName = Object.fromEntries(categories.filter((c) => c.id).map((c) => [c.name, c.id]));
  const subcategoryIdByName = Object.fromEntries(categories.filter((c) => c.id).flatMap((c) => c.subcategories.filter((s) => s.__real).map((s) => [s.name, s.id])));
  const txCtx = { walletIdByType, walletTypeById, categoryIdByName, subcategoryIdByName };

  const loadAllData = async () => {
    setDataLoading(true);
    try {
      const [cats, wallets] = await Promise.all([api.categories.list(), api.wallets.list()]);
      const catsShaped = cats.map((c) => ({ ...c, subcategories: c.subcategories.map((s) => ({ ...s, __real: true })) }));
      setCategories(catsShaped);
      setWalletsList(wallets);

      const ctx = {
        walletIdByType: { personal: wallets.find((w) => w.type === "PERSONAL")?.id, shared: wallets.find((w) => w.type === "SHARED")?.id },
        walletTypeById: Object.fromEntries(wallets.map((w) => [w.id, w.type])),
      };
      const [txs, kycStatus, cardData, remoteBudgets, invites, remoteNotifications, publicSettings] = await Promise.all([
        api.transactions.list(ctx),
        api.kyc.status().catch(() => ({ status: "NONE" })),
        api.cards.me().catch(() => null),
        api.budgets.list().catch(() => []),
        api.wallets.myInvites().catch(() => []),
        api.notifications.list().catch(() => []),
        api.settingsPublic().catch(() => ({})),
      ]);
      setTransactions(txs);
      setBudgets(remoteBudgets);
      setMyInvites(invites);
      setNotifications(remoteNotifications);
      setKycVerified(kycStatus.status === "VERIFIED");
      setPayModuleEnabled(publicSettings.pay_module_enabled !== "false");
      if (cardData) {
        setCardBalance(Number(cardData.card.balance));
        setCardLast4(cardData.card.last4);
        setCardActivity(cardData.activity);
        setCardFrozen(cardData.card.frozen);
        setCardControls(cardData.card.controls);
        setDailyLimit(Number(cardData.card.dailyLimit));
      }
    } catch (err) {
      console.error("Failed to load account data", err); // eslint-disable-line no-console
    } finally {
      setDataLoading(false);
    }
  };

  // Fetches the customer's current display currency + conversion rate
  // from the server and applies it globally (see setDisplayCurrency
  // near fmt/fmtTZS). Called after every point the user object changes —
  // login, register, session restore, profile update — so the display
  // currency is always correctly synced regardless of entry point,
  // without needing every one of those endpoints to also return it.
  const syncDisplayCurrency = async () => {
    try {
      const me = await api.auth.me();
      setDisplayCurrency(me.preferredCurrency, me.currencyRate);
    } catch {
      // Not critical enough to block anything on — worst case, amounts
      // stay shown in whatever currency was last successfully synced.
    }
  };

  // Called after any real money-movement (top-up, OCT, Lipa, GePG, LUKU)
  // succeeds server-side. Re-fetches the card snapshot and transaction list
  // from the backend rather than trying to guess the new state locally —
  // the server is the source of truth for both balance and activity.
  const refreshCardAndTransactions = async () => {
    try {
      const [cardData, txs] = await Promise.all([
        api.cards.me().catch(() => null),
        api.transactions.list({ walletTypeById }),
      ]);
      if (cardData) {
        setCardBalance(Number(cardData.card.balance));
        setCardLast4(cardData.card.last4);
        setCardActivity(cardData.activity);
        setCardFrozen(cardData.card.frozen);
        setCardControls(cardData.card.controls);
        setDailyLimit(Number(cardData.card.dailyLimit));
      }
      setTransactions(txs);
    } catch (err) {
      console.error("Failed to refresh card/transactions after money movement", err); // eslint-disable-line no-console
    }
  };

  // On first load, try to resume a session from the stored refresh token.
  useEffect(() => {
    (async () => {
      const restoredUser = await api.auth.restoreSession().catch(() => null);
      if (restoredUser) {
        markLoggedIn(restoredUser);
        setOnboarded(true);
        await Promise.all([loadAllData(), syncDisplayCurrency()]);
      }
      setAuthChecking(false);
    })();
  }, []);

  const handleRegister = async (profile) => {
    setAuthSubmitting(true); setAuthError("");
    try {
      const registeredUser = await api.auth.register(profile);
      markLoggedIn(registeredUser);
      setOnboarded(true);
      await Promise.all([loadAllData(), syncDisplayCurrency()]);
    } catch (err) {
      setAuthError(err.message || "Couldn't create your account. Please try again.");
    } finally {
      setAuthSubmitting(false);
    }
  };

  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");
  const handleLogin = async ({ email, password }) => {
    setLoginSubmitting(true); setLoginError("");
    try {
      const loggedInUser = await api.auth.login({ email, password });
      markLoggedIn(loggedInUser);
      setOnboarded(true);
      await Promise.all([loadAllData(), syncDisplayCurrency()]);
    } catch (err) {
      setLoginError(err.message || "Couldn't log in. Please try again.");
    } finally {
      setLoginSubmitting(false);
    }
  };

  const [biometricSubmitting, setBiometricSubmitting] = useState(false);
  const [biometricError, setBiometricError] = useState("");
  const handleBiometricLogin = async (email) => {
    setBiometricSubmitting(true); setBiometricError("");
    try {
      const loggedInUser = await api.webauthn.loginWithDevice(email);
      markLoggedIn(loggedInUser);
      setOnboarded(true);
      await Promise.all([loadAllData(), syncDisplayCurrency()]);
    } catch (err) {
      setBiometricError(err.message || "Couldn't sign in with biometrics. Use your password instead.");
    } finally {
      setBiometricSubmitting(false);
    }
  };

  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotMessage, setForgotMessage] = useState("");
  const handleForgotPassword = async (email) => {
    setForgotSubmitting(true); setForgotError(""); setForgotMessage("");
    try {
      const { message } = await api.auth.forgotPassword(email);
      setForgotMessage(message || "If that email has an account, a reset code has been sent.");
      return true;
    } catch (err) {
      setForgotError(err.message || "Something went wrong. Please try again.");
      return false;
    } finally {
      setForgotSubmitting(false);
    }
  };

  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const handleResetPassword = async (token, newPassword) => {
    setResetSubmitting(true); setResetError(""); setResetMessage("");
    try {
      await api.auth.resetPassword(token, newPassword);
      setResetMessage("Password updated — log in with your new password.");
      return true;
    } catch (err) {
      setResetError(err.message || "That code didn't work. Please request a new one.");
      return false;
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await api.auth.logout().catch(() => {});
    // Simplest reliable way to clear the dozen-plus pieces of state this app
    // holds — a full reload guarantees nothing stale survives into the next session.
    window.location.reload();
  };

  // Requirement 1: name correction from the Profile page. Server validates
  // and audit-logs the change; we just reconcile local state on success.
  const updateProfileName = async (patch) => {
    const updated = await api.auth.updateProfile(patch);
    setUser(updated);
    return updated;
  };

  // Wallet invitation module — consent-based, refreshed after any action
  // that changes membership or invite state.
  const refreshWallets = async () => {
    try {
      const [wallets, invites] = await Promise.all([api.wallets.list(), api.wallets.myInvites()]);
      setWalletsList(wallets);
      setMyInvites(invites);
    } catch (err) {
      console.error("Failed to refresh wallets", err); // eslint-disable-line no-console
    }
  };
  const handleCreateSharedWallet = async () => {
    await api.wallets.create("Household Wallet");
    await refreshWallets();
  };
  const handleAcceptInvite = async (inviteId) => {
    await api.wallets.acceptInvite(inviteId);
    await refreshWallets();
  };
  const handleDeclineInvite = async (inviteId) => {
    await api.wallets.declineInvite(inviteId);
    await refreshWallets();
  };

  const addTransaction = (tx) => {
    setTransactions((prev) => [tx, ...prev]);
    api.transactions.create(tx, txCtx)
      .then((saved) => setTransactions((prev) => prev.map((x) => (x.id === tx.id ? saved : x))))
      .catch((err) => { console.error("Failed to save transaction", err); setTransactions((prev) => prev.filter((x) => x.id !== tx.id)); }); // eslint-disable-line no-console
  };
  const addMany = (txs) => {
    setTransactions((prev) => [...txs, ...prev]);
    api.transactions.createMany(txs, txCtx)
      .then((saved) => {
        const byOldId = new Map(txs.map((tx, i) => [tx.id, saved[i]]));
        setTransactions((prev) => prev.map((x) => byOldId.get(x.id) || x));
      })
      .catch((err) => console.error("Failed to import transactions", err)); // eslint-disable-line no-console
  };
  const updateTransaction = (id, updates) => {
    setTransactions((prev) => prev.map((x) => (x.id === id ? { ...x, ...updates } : x)));
    api.transactions.update(id, updates, txCtx).catch((err) => console.error("Failed to update transaction", err)); // eslint-disable-line no-console
  };
  const deleteTransaction = (id) => {
    setTransactions((prev) => prev.filter((x) => x.id !== id));
    api.transactions.remove(id).catch((err) => console.error("Failed to delete transaction", err)); // eslint-disable-line no-console
  };
  const deleteManyTransactions = (ids) => {
    setTransactions((prev) => prev.filter((x) => !ids.includes(x.id)));
    api.transactions.removeMany(ids).catch((err) => console.error("Failed to delete transactions", err)); // eslint-disable-line no-console
  };
  const addCardActivity = (item) => setCardActivity((prev) => [item, ...prev]);

  const addCategory = (rawName) => {
    const name = (rawName || "").trim();
    if (!name) return null;
    const exists = categories.some((c) => c.name.toLowerCase() === name.toLowerCase());
    if (exists) return name;
    const used = categories.map((c) => c.color);
    const color = COLOR_POOL.find((c) => !used.includes(c)) || COLOR_POOL[categories.length % COLOR_POOL.length];
    setCategories((prev) => { const others = prev.filter((c) => c.name !== "Other"); const other = prev.find((c) => c.name === "Other") || { name: "Other", color: "#8A8578", subcategories: [] }; return [...others, { name, color, subcategories: [] }, other]; });
    api.categories.create(name)
      .then((real) => setCategories((prev) => prev.map((c) => (c.name === name ? { ...c, id: real.id, color: real.color } : c))))
      .catch((err) => console.error("Failed to save category", err)); // eslint-disable-line no-console
    return name;
  };

  const renameCategory = (oldName, newName) => {
    const trimmed = (newName || "").trim();
    if (!trimmed || trimmed === oldName) return;
    const target = categories.find((c) => c.name === oldName);
    setCategories((prev) => prev.map((c) => (c.name === oldName ? { ...c, name: trimmed } : c)));
    setTransactions((prev) => prev.map((x) => (x.category === oldName ? { ...x, category: trimmed } : x)));
    setBudgets((prev) => prev.map((b) => (b.category === oldName ? { ...b, category: trimmed } : b)));
    if (target?.id) api.categories.rename(target.id, trimmed).catch((err) => console.error("Failed to rename category", err)); // eslint-disable-line no-console
  };

  const deleteCategoryMain = (name) => {
    if (name === "Other") return;
    const target = categories.find((c) => c.name === name);
    setTransactions((prev) => prev.map((x) => (x.category === name ? { ...x, category: "Other", subcategory: null } : x)));
    setBudgets((prev) => prev.filter((b) => b.category !== name));
    setCategories((prev) => prev.filter((c) => c.name !== name));
    if (target?.id) api.categories.remove(target.id).catch((err) => console.error("Failed to delete category", err)); // eslint-disable-line no-console
  };

  const addSubcategory = (mainName, subName) => {
    const trimmed = (subName || "").trim();
    if (!trimmed) return null;
    let created = null;
    const parent = categories.find((c) => c.name === mainName);
    setCategories((prev) => prev.map((c) => {
      if (c.name !== mainName) return c;
      const exists = c.subcategories.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
      if (exists) { created = trimmed; return c; }
      created = trimmed;
      return { ...c, subcategories: [...c.subcategories, { id: uid(), name: trimmed }] };
    }));
    if (parent?.id) {
      api.categories.addSubcategory(parent.id, trimmed)
        .then((real) => setCategories((prev) => prev.map((c) => (c.name !== mainName ? c : { ...c, subcategories: c.subcategories.map((s) => (s.name === trimmed && !s.__real ? { ...real, __real: true } : s)) }))))
        .catch((err) => console.error("Failed to save subcategory", err)); // eslint-disable-line no-console
    }
    return created;
  };

  const updateSubcategory = (mainName, subId, newName) => {
    const trimmed = (newName || "").trim();
    if (!trimmed) return;
    setCategories((prev) => prev.map((c) => (c.name !== mainName ? c : { ...c, subcategories: c.subcategories.map((s) => (s.id === subId ? { ...s, name: trimmed } : s)) })));
    api.categories.renameSubcategory(subId, trimmed).catch((err) => console.error("Failed to rename subcategory", err)); // eslint-disable-line no-console
  };

  const deleteSubcategory = (mainName, subId) => {
    setCategories((prev) => prev.map((c) => (c.name !== mainName ? c : { ...c, subcategories: c.subcategories.filter((s) => s.id !== subId) })));
    api.categories.removeSubcategory(subId).catch((err) => console.error("Failed to delete subcategory", err)); // eslint-disable-line no-console
  };

  // Persists a budget's limit for `category`, creating it if it doesn't exist yet.
  // If the category was itself just created (real id not back from the API yet),
  // retries shortly rather than dropping the write.
  const upsertBudgetRemote = (category, limit, attempt = 0) => {
    const cat = categories.find((c) => c.name === category);
    if (cat?.id) {
      api.budgets.upsert(cat.id, limit)
        .then((real) => setBudgets((prev) => prev.map((b) => (b.category === category ? { ...b, id: real.id, categoryId: real.categoryId } : b))))
        .catch((err) => console.error("Failed to save budget", err)); // eslint-disable-line no-console
    } else if (attempt < 10) {
      setTimeout(() => upsertBudgetRemote(category, limit, attempt + 1), 400);
    } else {
      console.error(`Gave up saving budget for "${category}" — its category never got a server id`); // eslint-disable-line no-console
    }
  };

  const upsertBudget = (category, limit) => {
    const safeLimit = Math.max(0, limit);
    setBudgets((prev) => (prev.some((b) => b.category === category) ? prev.map((b) => (b.category === category ? { ...b, limit: safeLimit } : b)) : [...prev, { category, limit: safeLimit }]));
    upsertBudgetRemote(category, safeLimit);
  };

  const removeBudget = (category) => {
    const target = budgets.find((b) => b.category === category);
    setBudgets((prev) => prev.filter((b) => b.category !== category));
    if (target?.id) api.budgets.remove(target.id).catch((err) => console.error("Failed to delete budget", err)); // eslint-disable-line no-console
  };

  const openProfile = () => { setProfileReturnTab(active); setActive("profile"); };
  const openNotifications = () => {
    setNotificationsReturnTab(active);
    setActive("notifications");
    api.notifications.list().then(setNotifications).catch(() => {});
  };

  // Native push arrives outside any specific screen, so it's handled at
  // the app root rather than inside NotificationsPage or the profile
  // card - a received notification just refreshes the badge count
  // quietly, while tapping one opens the notifications screen the same
  // way tapping the bell icon does.
  // A tapped notification may cold-start the app fresh (it wasn't already
  // running) — session restore and data loading haven't necessarily
  // finished yet at the moment the tap event fires. Navigating to the
  // notifications tab before that completes would render into an empty,
  // not-yet-populated app state. The flag below just remembers the tap
  // happened; the effect after it flushes the actual navigation once the
  // app is confirmed ready.
  const pendingNotificationTap = useRef(false);

  useEffect(() => {
    if (!api.push.isNative()) return;
    const receivedPromise = PushNotifications.addListener("pushNotificationReceived", () => {
      api.notifications.list().then(setNotifications).catch(() => {});
    });
    const actionPromise = PushNotifications.addListener("pushNotificationActionPerformed", () => {
      pendingNotificationTap.current = true;
    });
    return () => { receivedPromise.then((h) => h.remove()); actionPromise.then((h) => h.remove()); };
  }, []);

  useEffect(() => {
    if (pendingNotificationTap.current && !authChecking && onboarded && !dataLoading) {
      pendingNotificationTap.current = false;
      openNotifications();
    }
  }, [authChecking, dataLoading, onboarded]);

  const globalStyle = (
    <style>{`
      * { box-sizing: border-box; }
      html, body { background: ${t.bg}; margin: 0; padding: 0; }
      #root { background: ${t.bg}; min-height: 100vh; }
      input::placeholder, textarea::placeholder { color: ${t.inkFaint}; }
      select { -webkit-appearance: none; appearance: none; }
      @keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }
      @keyframes shine { 0%, 100% { background-position: 220% 220%; } 50% { background-position: -40% -40%; } }
      @keyframes scanline { 0% { top: 2%; } 50% { top: 92%; } 100% { top: 2%; } }
    `}</style>
  );

  if (authChecking || (onboarded && dataLoading)) {
    return (
      <div style={{ background: t.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif" }}>
        {globalStyle}
        <RefreshCw size={22} className="animate-spin" color={t.accent} />
      </div>
    );
  }

  if (!onboarded) {
    return (
      <div style={{ background: t.bg, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>
        {globalStyle}
        <div className="max-w-[430px] mx-auto relative" style={{ background: t.bg, minHeight: "100vh" }}>
          <Onboarding
            t={t}
            onFinish={handleRegister} submitting={authSubmitting} error={authError}
            onLogin={handleLogin} loginSubmitting={loginSubmitting} loginError={loginError}
            onBiometricLogin={handleBiometricLogin} biometricSubmitting={biometricSubmitting} biometricError={biometricError}
            onForgotPassword={handleForgotPassword} forgotSubmitting={forgotSubmitting} forgotError={forgotError} forgotMessage={forgotMessage}
            onResetPassword={handleResetPassword} resetSubmitting={resetSubmitting} resetError={resetError} resetMessage={resetMessage}
          />
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: t.bgSoft, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }}>
      {globalStyle}
      <div className="max-w-[430px] mx-auto relative" style={{ background: t.bg, minHeight: "100vh" }}>
        <Header t={t} dark={dark} setDark={setDark} user={user} avatarUrl={avatarUrl} notifications={notifications} language={language} setLanguage={setLanguage} tr={tr} onAvatarClick={openProfile} onOpenNotifications={openNotifications} />
        <div style={{ paddingBottom: 84, paddingTop: "calc(56px + env(safe-area-inset-top))" }}>
          {active === "home" && <HomePage t={t} transactions={transactions} budgets={budgets} categories={categories} categoryIdByName={categoryIdByName} refreshCardAndTransactions={refreshCardAndTransactions} user={user} tr={tr} language={language} setActive={setActive} onAdd={addTransaction} onUpdate={updateTransaction} onAddCategory={addCategory} onAddSubcategory={addSubcategory} kycVerified={kycVerified} setKycVerified={setKycVerified} />}
          {active === "insights" && <InsightsPage t={t} transactions={transactions} budgets={budgets} categories={categories} tr={tr} goBack={() => setActive("home")} onViewCategoryPerformance={() => setActive("categoryPerformance")} />}
          {active === "categoryPerformance" && <CategoryPerformancePage t={t} transactions={transactions} categories={categories} goBack={() => setActive("insights")} />}
          {active === "ledger" && <LedgerPage t={t} transactions={transactions} onAdd={addTransaction} onUpdate={updateTransaction} onDelete={deleteTransaction} onDeleteMany={deleteManyTransactions} goImport={() => setActive("ingest")} categories={categories} onAddCategory={addCategory} onAddSubcategory={addSubcategory} tr={tr} />}
          {active === "ingest" && <IngestPage t={t} onCommit={addMany} goBack={() => setActive("ledger")} categories={categories} />}
          {active === "budget" && <BudgetPage t={t} budgets={budgets} onUpsertBudget={upsertBudget} onRemoveBudget={removeBudget} transactions={transactions} categories={categories} onAddCategory={addCategory} tr={tr} setActive={setActive} />}
          {active === "pay" && !payModuleEnabled && <PayComingSoonPage t={t} />}
          {active === "pay" && payModuleEnabled && (
            <PayPage t={t} transactions={transactions} categories={categories} categoryIdByName={categoryIdByName} refreshCardAndTransactions={refreshCardAndTransactions} walletsList={walletsList} user={user}
              cardBalance={cardBalance} setCardBalance={setCardBalance} cardLast4={cardLast4} cardActivity={cardActivity} addActivity={addCardActivity}
              cardFrozen={cardFrozen} setCardFrozen={setCardFrozen} cardControls={cardControls} setCardControls={setCardControls}
              dailyLimit={dailyLimit} setDailyLimit={setDailyLimit} kycVerified={kycVerified} setKycVerified={setKycVerified} tr={tr} language={language} />
          )}
          {active === "wallets" && <WalletsPage t={t} transactions={transactions} onAdd={addTransaction} walletsList={walletsList} user={user} myInvites={myInvites} onAcceptInvite={handleAcceptInvite} onDeclineInvite={handleDeclineInvite} onCreateSharedWallet={handleCreateSharedWallet} onRefreshWallets={refreshWallets} setActive={setActive} categories={categories} onAddCategory={addCategory} onAddSubcategory={addSubcategory} tr={tr} onOpenWalletActivity={openWalletActivity} />}
          {active === "walletActivity" && walletActivityParams && <WalletActivityPage t={t} transactions={transactions} categories={categories} goBack={() => setActive("wallets")} {...walletActivityParams} />}
          {active === "virtualcards" && <VirtualCardsPage t={t} goBack={() => setActive("wallets")} categories={categories} categoryIdByName={categoryIdByName} walletsList={walletsList} user={user} tr={tr} language={language} onMainCardChanged={refreshCardAndTransactions} kycVerified={kycVerified} setKycVerified={setKycVerified} />}
          {active === "profile" && <ProfilePage t={t} user={user} avatarUrl={avatarUrl} setAvatarUrl={setAvatarUrl} goBack={() => setActive(profileReturnTab)} tr={tr} onLogout={handleLogout} onUpdateProfileName={updateProfileName} onGoAdmin={() => setActive("admin")} onGoSupport={() => setActive("support")} onOpenSetting={openProfileSetting} kycVerified={kycVerified} />}
          {active === "profileSetting" && <ProfileSettingPage t={t} setting={profileSetting} goBack={() => setActive("profile")} user={user} onUpdateProfileName={updateProfileName} tr={tr} />}
          {active === "notifications" && <NotificationsPage t={t} notifications={notifications} setNotifications={setNotifications} tr={tr} goBack={() => setActive(notificationsReturnTab)} />}
          {active === "admin" && <AdminPage t={t} goBack={() => setActive("profile")} />}
          {active === "support" && <SupportPage t={t} transactions={transactions} goBack={() => setActive("profile")} />}
          {active === "categories" && <CategoryManagementPage t={t} categories={categories} goBack={() => setActive("budget")} onAddCategory={addCategory} onAddSubcategory={addSubcategory} onUpdateSubcategory={updateSubcategory} onDeleteSubcategory={deleteSubcategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategoryMain} />}
        </div>
        {active !== "profile" && active !== "categories" && active !== "notifications" && <BottomNav t={t} active={active} setActive={setActive} tr={tr} />}
      </div>
    </div>
  );
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
