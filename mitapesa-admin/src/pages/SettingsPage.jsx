import { useEffect, useState } from "react";
import { Card, Button, Input, Spinner } from "../components/ui.jsx";
import { adminApi } from "../api.js";

const LABELS = {
  household_max_members: "Max household members per shared wallet",
  card_bin: "Card BIN prefix",
  cms_provider_label: "CMS provider label",
  partner_bank_acquirer_id: "Partner bank TIPS Acquirer ID",
  qr_test_samples_enabled: "QR test payment samples",
  qr_manual_payload_paste_enabled: "QR manual payload paste (dev only)",
  qr_step_up_threshold: "Step-up confirmation threshold (TZS)",
  cbs_simulated_failure_rate: "Simulated CBS failure rate (%)",
  tips_simulated_failure_rate: "Simulated TIPS failure rate (%)",
  biometric_login_enabled: "Biometric login (Face ID / fingerprint)",
  push_notifications_enabled: "Push notifications",
  receipt_ocr_enabled: "Receipt scanning (OCR)",
  pfm_export_enabled: "Transaction/insights export (CSV)",
  pay_module_enabled: "Pay module (cards, QR, Lipa, GePG, LUKU)",
  multi_currency_enabled: "Multi-currency PFM (customer running currency)",
  available_currencies: "Available currencies",
  verification_method: "Onboarding verification method",
  voice_free_monthly_limit: "Free voice logs per customer/month",
  voice_monthly_spend_ceiling_usd: "Voice AI monthly spend ceiling (USD)",
  voice_promo_free_until: "Voice AI promo — free until (YYYY-MM-DD)",
  voice_credit_pack_size: "Voice credit pack — logs per purchase",
  voice_credit_pack_price_tzs: "Voice credit pack — price (TZS)",
  voice_credit_purchase_simulated_failure_rate: "Voice credit purchase — simulated decline rate (%)",
};
const HELP = {
  household_max_members: "Caps how many people can be invited to a single shared wallet.",
  card_bin: "6-digit prefix used when generating card numbers — mirrors how a real CMS ties a BIN to a card Product.",
  cms_provider_label: "Display-only label. Does not change which provider is active — that's set via an environment variable, not here.",
  partner_bank_acquirer_id: "5-digit TIPS Acquirer ID. A scanned QR matching this settles on-us; anything else routes via TIPS.",
  qr_test_samples_enabled: "\"true\" or \"false\" — turn off before customers use the live app.",
  qr_manual_payload_paste_enabled: "\"true\" or \"false\" — the raw-payload paste field is a developer convenience only. Turn off before launch.",
  qr_step_up_threshold: "Amounts above this (but under the KYC threshold) require password/biometric confirmation from the customer.",
  cbs_simulated_failure_rate: "0-100. Injects simulated CBS posting failures, for testing the automatic-reversal logic.",
  tips_simulated_failure_rate: "0-100. Injects simulated TIPS routing failures/pending states.",
  biometric_login_enabled: "\"true\" or \"false\" — turns off both new device enrollment and login for every customer's existing devices, immediately.",
  push_notifications_enabled: "\"true\" or \"false\" — turns off both new subscriptions and sending, immediately. The in-app notification list still works either way.",
  receipt_ocr_enabled: "\"true\" or \"false\" — turns off receipt scanning immediately; customers are directed to add expenses manually. Which OCR provider actually runs (mock / openai_vision / gemini_vision) is set via the OCR_PROVIDER environment variable, not here.",
  pfm_export_enabled: "\"true\" or \"false\" — turns off the customer-facing transaction/insights CSV export immediately. Separate from the card statement export, which isn't affected by this.",
  pay_module_enabled: "\"true\" or \"false\" — turns off the entire Pay module (card top-up/management, QR, Lipa, GePG, LUKU) immediately, while a banking partner connection is pending. No card is issued at signup while this is off; any customer who signed up during that time gets their card provisioned automatically the moment they first open Pay after this is switched back on — no separate migration step needed.",
  multi_currency_enabled: "\"true\" or \"false\" — turns off the ability for customers to change their running currency immediately. Doesn't affect anyone already set to a non-TZS currency; they keep their current setting, they just can't change it further while this is off.",
  available_currencies: "Comma-separated ISO 4217 codes, e.g. \"TZS,USD,KES,ZAR\" — which currencies customers can choose as their running currency. The actual conversion rate source is set via EXCHANGE_RATE_PROVIDER, an environment variable, not here.",
  verification_method: "Exactly \"sms\" or \"email\" — which channel new customers verify through during onboarding. Only one is ever active; setting this to one automatically means the other is off. Which SMS provider (mock/africastalking) or email provider (mock/resend) actually sends is set via SMS_PROVIDER / EMAIL_PROVIDER environment variables, not here.",
  voice_free_monthly_limit: "How many voice-logged expenses each customer gets free per calendar month before they're asked to add expenses manually, or buy more — see the AI usage page for actual spend against this.",
  voice_monthly_spend_ceiling_usd: "Once this month's total estimated voice-AI cost (all customers combined) reaches this dollar amount, voice logging automatically turns itself off for everyone until next month — a hard backstop independent of the per-customer limit above. Also set a real spend limit directly in OpenAI's own dashboard as a further safeguard; this setting only controls this app's own behavior.",
  voice_promo_free_until: "Leave blank for no active promotion. Set a future date (YYYY-MM-DD) to make voice logging free and unlimited for every customer until that date, ignoring the per-customer limit above — the monthly spend ceiling above still applies even during a promotion.",
  voice_credit_pack_size: "How many extra voice logs one purchase unlocks, once a customer has used their free monthly allowance. These never expire, unlike the free allowance.",
  voice_credit_pack_price_tzs: "Price of one credit pack, in TZS. Charged via the payment gateway configured for PAYMENT_GATEWAY_PROVIDER — currently the mock provider (always succeeds unless the decline-rate setting below is raised) until a real gateway is connected.",
  voice_credit_purchase_simulated_failure_rate: "0-100. Injects simulated card declines on the mock payment gateway, to test the failure-handling path before a real gateway is connected.",
};

export default function SettingsPage({ user }) {
  const canEdit = user.role === "admin_super";
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true); setError("");
    adminApi.settings.list().then(setSettings).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const save = async (key) => {
    setSaving(true); setError("");
    try { await adminApi.settings.update(key, editValue); load(); setEditingKey(null); }
    catch (err) { setError(err.message || "Couldn't save."); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h1 className="text-[22px] font-bold font-display text-ink mb-1">Settings</h1>
      <p className="text-[13.5px] text-inkFaint mb-6">{canEdit ? "System-wide configuration — changes take effect immediately, no redeploy needed." : "Read-only for your access level."}</p>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="space-y-3 max-w-xl">
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
          {Object.entries(settings || {}).map(([key, value]) => (
            <Card key={key} className="p-5">
              <p className="text-[13px] font-semibold text-ink mb-0.5">{LABELS[key] || key}</p>
              <p className="text-[11.5px] text-inkFaint mb-3">{HELP[key] || ""}</p>
              {editingKey === key ? (
                <div className="flex gap-2">
                  <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                  <Button variant="accent" disabled={saving} onClick={() => save(key)}>{saving ? "…" : "Save"}</Button>
                  <Button variant="ghost" onClick={() => setEditingKey(null)}>Cancel</Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-[15px] font-bold font-mono text-ink">{value}</p>
                  {canEdit && <Button variant="ghost" onClick={() => { setEditingKey(key); setEditValue(value); }}>Edit</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
