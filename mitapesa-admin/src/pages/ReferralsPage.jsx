import { useEffect, useState, useCallback, useRef } from "react";
import { adminApi } from "../api.js";
import { Card, StatCard, Input, Select, Button, Badge, Spinner, EmptyState, fmtTZS } from "../components/ui.jsx";

const api = adminApi.referrals;
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "campaigns", label: "Campaigns" },
  { key: "rewards", label: "Rewards & partners" },
  { key: "referrals", label: "Referrals & fraud" },
  { key: "fulfilment", label: "Fulfilment" },
  { key: "appeals", label: "Appeals" },
  { key: "rules", label: "Fraud rules" },
];
const TONE = { qualified: "good", fulfilled: "good", active: "good", upheld: "good", pending: "neutral", pending_maturity: "neutral", queued: "warn", available: "warn", under_review: "warn", open: "warn", draft: "neutral", paused: "warn", capped: "warn", rejected: "bad", failed: "bad", cancelled: "bad", ended: "neutral", dismissed: "neutral", expired: "neutral", high: "bad", medium: "warn", low: "good" };
const B = ({ v }) => <Badge tone={TONE[v] || "neutral"}>{String(v).replace(/_/g, " ")}</Badge>;
const when = (d) => (d ? new Date(d).toLocaleDateString() : "—");

function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true); setError("");
    fn().then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}
const Err = ({ msg }) => (msg ? <p className="text-[12.5px] text-danger mb-3">{msg}</p> : null);
const Field = ({ label, children, hint }) => (
  <label className="block mb-3">
    <span className="block text-[12px] font-semibold text-inkSoft mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-inkFaint mt-1">{hint}</span>}
  </label>
);

/* ───────────── Overview ───────────── */
function Overview() {
  const [campaignId, setCampaignId] = useState("");
  const { data, error, loading } = useLoad(() => api.dashboard(campaignId), [campaignId]);
  if (loading && !data) return <div className="py-16 flex justify-center"><Spinner size={26} /></div>;
  if (error) return <Err msg={error} />;
  const k = data.kpis;
  return (
    <div>
      <div className="flex justify-end mb-4 w-64 ml-auto">
        <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.nameEn} ({c.status})</option>)}
        </Select>
      </div>
      <p className="text-[12px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Funnel</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Invite link opens" value={k.clicks} hint={`${k.codesCreated} customers with a code`} />
        <StatCard label="Sign-ups via referral" value={k.signups} />
        <StatCard label="Qualified" value={k.qualified} tone="accent" hint={`${k.conversionRate}% of sign-ups`} />
        <StatCard label="Still in progress" value={k.pending} />
      </div>
      <p className="text-[12px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Rewards & cost</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Rewards delivered" value={k.rewardsFulfilled} tone="accent" />
        <StatCard label="Waiting in fulfilment queue" value={k.rewardsQueued} tone={k.rewardsQueued ? "gold" : "ink"} />
        <StatCard label="Held (maturity / review)" value={k.rewardsWaiting} />
        <StatCard label="Delivery failed" value={k.rewardsFailed} tone={k.rewardsFailed ? "danger" : "ink"} />
        <StatCard label="Reward cost" value={fmtTZS(k.rewardCostTzs)} hint="rewards created, excluding cancelled / capped" />
        <StatCard label="Cost per qualified referral" value={fmtTZS(k.costPerQualifiedTzs)} />
        <StatCard label="AI credits granted" value={k.aiCreditsGranted} hint={`${k.aiCreditsUsed} used`} />
        <StatCard label="Open appeals" value={k.openAppeals} tone={k.openAppeals ? "gold" : "ink"} />
      </div>
      <p className="text-[12px] font-semibold text-inkFaint uppercase tracking-wide mb-2">Fraud control</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="High-risk referrals" value={k.fraudFlagged} tone={k.fraudFlagged ? "danger" : "ink"} />
        <StatCard label="Under review" value={k.underReview} tone={k.underReview ? "gold" : "ink"} />
        <StatCard label="Rejected" value={k.rejected} />
      </div>
      <Card className="p-5">
        <p className="text-[13px] font-semibold text-ink mb-3">Top referrers</p>
        {data.topReferrers.length === 0 ? <EmptyState title="No referrals yet" /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-inkFaint text-[11.5px]"><th className="pb-2">Referrer</th><th>Joined</th><th>Qualified</th><th>Flagged</th></tr></thead>
            <tbody>{data.topReferrers.map((t) => (
              <tr key={t.userId} className="border-t border-border"><td className="py-2">{t.referrer}</td><td>{t.joined}</td><td>{t.qualified}</td><td>{t.flagged ? <Badge tone="bad">{t.flagged}</Badge> : "0"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ───────────── Campaigns ───────────── */
const EVENTS = [
  { v: "signed_up", l: "Joined MitaPesa" }, { v: "budget_created", l: "Created a budget" },
  { v: "transaction_logged", l: "Logged transactions" }, { v: "daily_active", l: "Active on different days" },
  { v: "kyc_verified", l: "Verified identity (KYC)" }, { v: "topup_completed", l: "Topped up the card" }, { v: "payment_completed", l: "Completed a payment" },
];

function CampaignForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({
    slug: "", nameEn: "", nameSw: "", descriptionEn: "", descriptionSw: "", termsEn: "", termsSw: "",
    startsAt: "", endsAt: "", maxReferralsPerReferrer: 0, maxRewardsPerReferrer: 0, maxRewardsTotal: 0, budgetTzs: "", qualifyWithinDays: 30,
    ...(initial ? { ...initial, startsAt: initial.startsAt ? initial.startsAt.slice(0, 10) : "", endsAt: initial.endsAt ? initial.endsAt.slice(0, 10) : "", budgetTzs: initial.budgetTzs ?? "" } : {}),
  }));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = {
        slug: f.slug, nameEn: f.nameEn, nameSw: f.nameSw, descriptionEn: f.descriptionEn, descriptionSw: f.descriptionSw, termsEn: f.termsEn, termsSw: f.termsSw,
        startsAt: f.startsAt ? new Date(f.startsAt).toISOString() : null, endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : null,
        maxReferralsPerReferrer: Number(f.maxReferralsPerReferrer), maxRewardsPerReferrer: Number(f.maxRewardsPerReferrer), maxRewardsTotal: Number(f.maxRewardsTotal),
        budgetTzs: f.budgetTzs === "" ? null : Number(f.budgetTzs), qualifyWithinDays: Number(f.qualifyWithinDays),
      };
      if (initial) { delete body.slug; await api.updateCampaign(initial.id, body); } else await api.createCampaign(body);
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5 mb-5">
      <p className="text-[14px] font-semibold text-ink mb-4">{initial ? "Edit campaign" : "New campaign"}</p>
      <Err msg={err} />
      <div className="grid md:grid-cols-2 gap-x-5">
        {!initial && <Field label="Slug" hint="lowercase-with-dashes, can't be changed later"><Input value={f.slug} onChange={set("slug")} /></Field>}
        <Field label="Qualify within (days)" hint="how long a friend has to finish every step"><Input type="number" value={f.qualifyWithinDays} onChange={set("qualifyWithinDays")} /></Field>
        <Field label="Name (English)"><Input value={f.nameEn} onChange={set("nameEn")} /></Field>
        <Field label="Name (Swahili)"><Input value={f.nameSw} onChange={set("nameSw")} /></Field>
        <Field label="Description (English)"><textarea className="w-full px-3.5 py-2.5 rounded-lg border border-border text-[13.5px]" rows={3} value={f.descriptionEn} onChange={set("descriptionEn")} /></Field>
        <Field label="Description (Swahili)"><textarea className="w-full px-3.5 py-2.5 rounded-lg border border-border text-[13.5px]" rows={3} value={f.descriptionSw} onChange={set("descriptionSw")} /></Field>
        <Field label="Terms (English)"><textarea className="w-full px-3.5 py-2.5 rounded-lg border border-border text-[13.5px]" rows={4} value={f.termsEn} onChange={set("termsEn")} /></Field>
        <Field label="Terms (Swahili)"><textarea className="w-full px-3.5 py-2.5 rounded-lg border border-border text-[13.5px]" rows={4} value={f.termsSw} onChange={set("termsSw")} /></Field>
        <Field label="Starts"><Input type="date" value={f.startsAt} onChange={set("startsAt")} /></Field>
        <Field label="Ends"><Input type="date" value={f.endsAt} onChange={set("endsAt")} /></Field>
        <Field label="Max referrals per customer" hint="0 = unlimited"><Input type="number" value={f.maxReferralsPerReferrer} onChange={set("maxReferralsPerReferrer")} /></Field>
        <Field label="Max rewards per referrer" hint="0 = unlimited"><Input type="number" value={f.maxRewardsPerReferrer} onChange={set("maxRewardsPerReferrer")} /></Field>
        <Field label="Max rewards in total" hint="0 = unlimited"><Input type="number" value={f.maxRewardsTotal} onChange={set("maxRewardsTotal")} /></Field>
        <Field label="Budget ceiling (TZS)" hint="total reward COST; blank = none. Rewards beyond it are 'capped', not delivered."><Input type="number" value={f.budgetTzs} onChange={set("budgetTzs")} /></Field>
      </div>
      <div className="flex gap-2 mt-2"><Button variant="accent" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </Card>
  );
}

function MilestoneForm({ campaignId, initial, rewards, onSaved, onCancel }) {
  const [f, setF] = useState(() => ({ sequence: 1, eventName: "budget_created", threshold: 1, titleEn: "", titleSw: "", required: true, maturityDays: 0, active: true, ...(initial || {}), referrerRewardId: initial?.referrerRewardId || "", referredRewardId: initial?.referredRewardId || "" }));
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr("");
    const body = { sequence: Number(f.sequence), eventName: f.eventName, threshold: Number(f.threshold), titleEn: f.titleEn, titleSw: f.titleSw, required: f.required, active: f.active, maturityDays: Number(f.maturityDays), referrerRewardId: f.referrerRewardId || null, referredRewardId: f.referredRewardId || null };
    try { initial ? await api.updateMilestone(initial.id, body) : await api.addMilestone(campaignId, body); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const rewardOpts = (<><option value="">No reward</option>{rewards.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.nameEn}</option>)}</>);
  return (
    <div className="bg-bgSoft rounded-xl p-4 mt-3">
      <Err msg={err} />
      <div className="grid md:grid-cols-3 gap-x-4">
        <Field label="Order"><Input type="number" value={f.sequence} onChange={set("sequence")} /></Field>
        <Field label="What the friend does"><Select value={f.eventName} onChange={set("eventName")}>{EVENTS.map((e) => <option key={e.v} value={e.v}>{e.l}</option>)}</Select></Field>
        <Field label="How many times / days"><Input type="number" value={f.threshold} onChange={set("threshold")} /></Field>
        <Field label="Step title (English)"><Input value={f.titleEn} onChange={set("titleEn")} /></Field>
        <Field label="Step title (Swahili)"><Input value={f.titleSw} onChange={set("titleSw")} /></Field>
        <Field label="Required to qualify"><Select value={f.required ? "y" : "n"} onChange={(e) => setF({ ...f, required: e.target.value === "y" })}><option value="y">Yes</option><option value="n">No (bonus step)</option></Select></Field>
        <Field label="Reward for the friend (referred)"><Select value={f.referredRewardId} onChange={set("referredRewardId")}>{rewardOpts}</Select></Field>
        <Field label="Reward for the inviter (referrer)"><Select value={f.referrerRewardId} onChange={set("referrerRewardId")}>{rewardOpts}</Select></Field>
        <Field label="Hold inviter's reward (days)" hint="released after a second fraud check"><Input type="number" value={f.maturityDays} onChange={set("maturityDays")} /></Field>
      </div>
      <div className="flex gap-2"><Button variant="accent" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save step"}</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </div>
  );
}

function Campaigns({ user }) {
  const isSuper = user.role === "admin_super";
  const { data, error, loading, reload } = useLoad(async () => ({ campaigns: await api.campaigns(), rewards: await api.rewards() }));
  const [form, setForm] = useState(null); // "new" | campaign
  const [ms, setMs] = useState(null); // {campaignId, milestone?}
  const [msg, setMsg] = useState("");
  const act = async (fn) => { setMsg(""); try { await fn(); reload(); } catch (e) { setMsg(e.message); } };
  if (loading && !data) return <div className="py-16 flex justify-center"><Spinner size={26} /></div>;
  if (error) return <Err msg={error} />;
  const rewardName = (id) => (data.rewards.find((r) => r.id === id) || {}).nameEn;
  return (
    <div>
      <Err msg={msg} />
      {isSuper && !form && (
        <div className="flex gap-2 mb-4">
          <Button variant="accent" onClick={() => setForm("new")}>New campaign</Button>
          <Button variant="ghost" onClick={() => act(async () => { const r = await api.seedRecommended(); setMsg(r.created ? "Created “Pamoja Budget Challenge” as a draft. Review, then Activate." : "The recommended campaign already exists."); })}>Create recommended campaign</Button>
        </div>
      )}
      {form && <CampaignForm initial={form === "new" ? null : form} onSaved={() => { setForm(null); reload(); }} onCancel={() => setForm(null)} />}
      {data.campaigns.length === 0 && <EmptyState title="No campaigns yet" sub={isSuper ? "Use “Create recommended campaign” to start from the Pamoja Budget Challenge." : "A super admin needs to create one."} />}
      {data.campaigns.map((c) => (
        <Card key={c.id} className="p-5 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold text-ink">{c.nameEn} <span className="text-inkFaint font-normal">· {c.nameSw}</span></p>
              <p className="text-[12px] text-inkFaint mt-0.5">{c.slug} · {when(c.startsAt)} → {c.endsAt ? when(c.endsAt) : "no end date"} · qualify within {c.qualifyWithinDays} days · budget {c.budgetTzs ? fmtTZS(c.budgetTzs) : "none"}</p>
            </div>
            <B v={c.status} />
          </div>
          <table className="w-full text-[12.5px] mt-4">
            <thead><tr className="text-left text-inkFaint text-[11.5px]"><th className="pb-1">#</th><th>Step</th><th>Needs</th><th>Friend gets</th><th>Inviter gets</th><th /></tr></thead>
            <tbody>{c.milestones.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="py-1.5">{m.sequence}</td>
                <td>{m.titleEn}{!m.required && <span className="text-inkFaint"> (bonus)</span>}{!m.active && <span className="text-danger"> (off)</span>}</td>
                <td>{(EVENTS.find((e) => e.v === m.eventName) || {}).l} ×{m.threshold}</td>
                <td>{rewardName(m.referredRewardId) || "—"}</td>
                <td>{rewardName(m.referrerRewardId) || "—"}{m.maturityDays ? ` (after ${m.maturityDays}d)` : ""}</td>
                <td className="text-right">{isSuper && <button className="text-accent text-[12px] font-semibold" onClick={() => setMs({ campaignId: c.id, milestone: m })}>Edit</button>}</td>
              </tr>
            ))}</tbody>
          </table>
          {ms && ms.campaignId === c.id && <MilestoneForm key={ms.milestone?.id || "new"} campaignId={c.id} initial={ms.milestone} rewards={data.rewards} onSaved={() => { setMs(null); reload(); }} onCancel={() => setMs(null)} />}
          {isSuper && (
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="ghost" onClick={() => setMs({ campaignId: c.id })}>Add step</Button>
              <Button variant="ghost" onClick={() => setForm(c)}>Edit campaign</Button>
              {c.status !== "active" && c.status !== "ended" && <Button variant="accent" onClick={() => act(() => api.setCampaignStatus(c.id, "active"))}>Activate</Button>}
              {c.status === "active" && <Button variant="ghost" onClick={() => act(() => api.setCampaignStatus(c.id, "paused"))}>Pause</Button>}
              {c.status !== "ended" && <Button variant="danger" onClick={() => window.confirm("End this campaign? Friends still in progress will no longer earn rewards.") && act(() => api.setCampaignStatus(c.id, "ended"))}>End</Button>}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ───────────── Rewards & partners ───────────── */
const TYPES = ["ai_credits", "fee_waiver", "airtime", "data_bundle", "voucher", "discount", "cash_bonus", "other"];
function RewardForm({ initial, partners, feeTypes, onSaved, onCancel }) {
  const [f, setF] = useState({ type: "ai_credits", nameEn: "", nameSw: "", descriptionEn: "", descriptionSw: "", fulfilment: "auto", aiCredits: 5, aiValidDays: 90, valueTzs: 0, costTzs: 0, validityDays: 30, waiverDays: 30, stockLimit: 0, active: true, ...(initial || {}), waiverTransactionTypeId: initial?.waiverTransactionTypeId || "", partnerId: initial?.partnerId || "", aiFeature: initial?.aiFeature || "all" });
  const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isAi = f.type === "ai_credits";
  const isWaiver = f.type === "fee_waiver";
  const save = async () => {
    setBusy(true); setErr("");
    const body = { type: f.type, nameEn: f.nameEn, nameSw: f.nameSw, descriptionEn: f.descriptionEn, descriptionSw: f.descriptionSw, fulfilment: isAi || isWaiver ? "auto" : "manual", aiFeature: isAi ? f.aiFeature : null, aiCredits: isAi ? Number(f.aiCredits) : 0, aiValidDays: Number(f.aiValidDays), valueTzs: Number(f.valueTzs), costTzs: Number(f.costTzs), partnerId: f.partnerId || null, validityDays: Number(f.validityDays), waiverDays: isWaiver ? Number(f.waiverDays) : 0, waiverTransactionTypeId: isWaiver ? f.waiverTransactionTypeId || null : null, stockLimit: Number(f.stockLimit), active: f.active };
    try { initial ? await api.updateReward(initial.id, body) : await api.createReward(body); onSaved(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5 mb-4">
      <Err msg={err} />
      <div className="grid md:grid-cols-3 gap-x-4">
        <Field label="Type"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, fulfilment: ["ai_credits", "fee_waiver"].includes(e.target.value) ? "auto" : "manual" })}>{TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}</Select></Field>
        <Field label="Name (English)"><Input value={f.nameEn} onChange={set("nameEn")} /></Field>
        <Field label="Name (Swahili)"><Input value={f.nameSw} onChange={set("nameSw")} /></Field>
        <Field label="Description (English)"><Input value={f.descriptionEn} onChange={set("descriptionEn")} /></Field>
        <Field label="Description (Swahili)"><Input value={f.descriptionSw} onChange={set("descriptionSw")} /></Field>
        <Field label="Value to customer (TZS)"><Input type="number" value={f.valueTzs} onChange={set("valueTzs")} /></Field>
        <Field label="Cost to MitaPesa (TZS)" hint="counts against the campaign budget"><Input type="number" value={f.costTzs} onChange={set("costTzs")} /></Field>
        {isAi ? (<>
          <Field label="AI credits"><Input type="number" value={f.aiCredits} onChange={set("aiCredits")} /></Field>
          <Field label="Works for"><Select value={f.aiFeature} onChange={set("aiFeature")}><option value="all">Voice logging + Ask AI</option><option value="voice">Voice logging only</option><option value="analytics">Ask AI only</option></Select></Field>
          <Field label="Credits expire after (days)" hint="0 = never"><Input type="number" value={f.aiValidDays} onChange={set("aiValidDays")} /></Field>
        </>) : isWaiver ? (<>
          <Field label="Fee-free for (days)" hint="starts automatically; waits until the Pay module is on"><Input type="number" value={f.waiverDays} onChange={set("waiverDays")} /></Field>
          <Field label="Applies to" hint="uses the existing fee exemption, so the fee engine needs no change"><Select value={f.waiverTransactionTypeId} onChange={set("waiverTransactionTypeId")}><option value="">All fees</option>{feeTypes.map((x) => <option key={x.id} value={x.id}>{x.nameEn || x.code}</option>)}</Select></Field>
        </>) : (<>
          <Field label="Partner"><Select value={f.partnerId} onChange={set("partnerId")}><option value="">None / in-house</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Valid for (days) after delivery"><Input type="number" value={f.validityDays} onChange={set("validityDays")} /></Field>
        </>)}
        <Field label="Stock limit" hint="0 = unlimited"><Input type="number" value={f.stockLimit} onChange={set("stockLimit")} /></Field>
        <Field label="Status"><Select value={f.active ? "y" : "n"} onChange={(e) => setF({ ...f, active: e.target.value === "y" })}><option value="y">Active</option><option value="n">Inactive</option></Select></Field>
      </div>
      <div className="flex gap-2"><Button variant="accent" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save reward"}</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </Card>
  );
}
function PartnerForm({ initial, onSaved, onCancel }) {
  const [f, setF] = useState({ name: "", type: "other", contactName: "", contactEmail: "", contactPhone: "", integration: "manual", notes: "", active: true, ...(initial || {}) });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setErr("");
    const body = { name: f.name, type: f.type, contactName: f.contactName || null, contactEmail: f.contactEmail || null, contactPhone: f.contactPhone || null, integration: f.integration, notes: f.notes || null, active: f.active };
    try { initial ? await api.updatePartner(initial.id, body) : await api.createPartner(body); onSaved(); } catch (e) { setErr(e.message); }
  };
  return (
    <Card className="p-5 mb-4"><Err msg={err} />
      <div className="grid md:grid-cols-3 gap-x-4">
        <Field label="Partner name"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Type"><Select value={f.type} onChange={set("type")}><option value="telco">Telco</option><option value="merchant">Merchant</option><option value="bank">Bank</option><option value="other">Other</option></Select></Field>
        <Field label="Integration" hint="API automation arrives in a later phase"><Select value={f.integration} onChange={set("integration")}><option value="manual">Manual (CSV / individual)</option><option value="api">API (future)</option></Select></Field>
        <Field label="Contact name"><Input value={f.contactName || ""} onChange={set("contactName")} /></Field>
        <Field label="Contact email"><Input value={f.contactEmail || ""} onChange={set("contactEmail")} /></Field>
        <Field label="Contact phone"><Input value={f.contactPhone || ""} onChange={set("contactPhone")} /></Field>
      </div>
      <Field label="Notes"><Input value={f.notes || ""} onChange={set("notes")} /></Field>
      <div className="flex gap-2"><Button variant="accent" onClick={save}>Save partner</Button><Button variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </Card>
  );
}
function Rewards({ user }) {
  const isSuper = user.role === "admin_super";
  const { data, error, loading, reload } = useLoad(async () => ({ rewards: await api.rewards(), partners: await api.partners(), feeTypes: await adminApi.fees.transactionTypes.list().catch(() => []) }));
  const [rf, setRf] = useState(null); const [pf, setPf] = useState(null);
  if (loading && !data) return <div className="py-16 flex justify-center"><Spinner size={26} /></div>;
  if (error) return <Err msg={error} />;
  return (
    <div>
      <div className="flex items-center justify-between mb-3"><p className="text-[14px] font-semibold text-ink">Reward catalogue</p>{isSuper && !rf && <Button variant="accent" onClick={() => setRf("new")}>New reward</Button>}</div>
      {rf && <RewardForm initial={rf === "new" ? null : rf} partners={data.partners} feeTypes={data.feeTypes} onSaved={() => { setRf(null); reload(); }} onCancel={() => setRf(null)} />}
      <Card className="p-4 mb-8">
        {data.rewards.length === 0 ? <EmptyState title="No rewards yet" /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-inkFaint text-[11.5px]"><th className="pb-2">Reward</th><th>Type</th><th>Delivery</th><th>Value</th><th>Cost</th><th>Issued</th><th>Status</th><th /></tr></thead>
            <tbody>{data.rewards.map((r) => (
              <tr key={r.id} className="border-t border-border"><td className="py-2">{r.nameEn}</td><td>{r.type.replace(/_/g, " ")}</td><td>{r.fulfilment === "auto" ? "Automatic" : "Manual"}</td><td>{fmtTZS(r.valueTzs)}</td><td>{fmtTZS(r.costTzs)}</td><td>{r.issuedCount}{r.stockLimit ? ` / ${r.stockLimit}` : ""}</td><td><B v={r.active ? "active" : "paused"} /></td>
                <td className="text-right">{isSuper && <button className="text-accent text-[12px] font-semibold" onClick={() => setRf(r)}>Edit</button>}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <div className="flex items-center justify-between mb-3"><p className="text-[14px] font-semibold text-ink">Partners</p>{isSuper && !pf && <Button variant="accent" onClick={() => setPf("new")}>New partner</Button>}</div>
      {pf && <PartnerForm initial={pf === "new" ? null : pf} onSaved={() => { setPf(null); reload(); }} onCancel={() => setPf(null)} />}
      <Card className="p-4">
        {data.partners.length === 0 ? <EmptyState title="No partners yet" sub="Add telcos or merchants whose rewards you fulfil by CSV." /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-inkFaint text-[11.5px]"><th className="pb-2">Partner</th><th>Type</th><th>Contact</th><th>Integration</th><th /></tr></thead>
            <tbody>{data.partners.map((p) => (
              <tr key={p.id} className="border-t border-border"><td className="py-2">{p.name}</td><td>{p.type}</td><td>{[p.contactName, p.contactEmail, p.contactPhone].filter(Boolean).join(" · ") || "—"}</td><td>{p.integration}</td>
                <td className="text-right">{isSuper && <button className="text-accent text-[12px] font-semibold" onClick={() => setPf(p)}>Edit</button>}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ───────────── Referrals & fraud review ───────────── */
function ReferralDetail({ id, user, onClose, onChanged }) {
  const canAct = user.role !== "admin_viewer";
  const { data, error, loading, reload } = useLoad(() => api.get(id), [id]);
  const [note, setNote] = useState(""); const [err, setErr] = useState("");
  const review = async (action) => {
    setErr("");
    try { await api.review(id, action, note); setNote(""); reload(); onChanged(); } catch (e) { setErr(e.message); }
  };
  if (loading && !data) return <div className="py-6 flex justify-center"><Spinner /></div>;
  if (error) return <Err msg={error} />;
  const { referral: r } = data;
  return (
    <Card className="p-5 mb-4 border-accent/40">
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="text-[14px] font-semibold text-ink">{data.referrer.name} invited {data.referred.name}</p>
          <p className="text-[12px] text-inkFaint">Code {r.code} · joined {when(r.createdAt)} · expires {when(r.expiresAt)}</p>
          {data.referrer.phone && <p className="text-[12px] text-inkFaint">Referrer {data.referrer.phone} · referred {data.referred.phone}</p>}
        </div>
        <div className="flex items-center gap-2"><B v={r.status} /><Badge tone={TONE[r.riskLevel]}>risk {r.riskScore}</Badge><button className="text-inkFaint text-[12px]" onClick={onClose}>Close</button></div>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <p className="text-[12px] font-semibold text-inkSoft mb-1">Progress (event counts only — no financial data)</p>
          {data.steps.map((s) => <p key={s.id} className="text-[12.5px]">{s.achievedAt ? "✓" : "○"} {s.titleEn} <span className="text-inkFaint">({s.progress}/{s.threshold})</span></p>)}
          <p className="text-[12px] font-semibold text-inkSoft mt-3 mb-1">Rewards</p>
          {data.entitlements.length === 0 ? <p className="text-[12.5px] text-inkFaint">None yet</p> : data.entitlements.map((e) => <p key={e.id} className="text-[12.5px]">{e.recipient}: <B v={e.status} /> {fmtTZS(e.valueTzs)}</p>)}
        </div>
        <div>
          <p className="text-[12px] font-semibold text-inkSoft mb-1">Why it was scored this way</p>
          {data.evaluations.length === 0 ? <p className="text-[12.5px] text-inkFaint">No evaluation recorded</p> : data.evaluations.map((ev) => (
            <div key={ev.id} className="mb-2"><p className="text-[12px] text-inkFaint">{ev.stage} · score {ev.score} · {when(ev.createdAt)}</p>
              {ev.reasons.length === 0 ? <p className="text-[12.5px]">No signals</p> : ev.reasons.map((x, i) => <p key={i} className="text-[12.5px]">• {x.reason} <span className="text-inkFaint">(+{x.weight})</span></p>)}</div>
          ))}
          {r.reviewNote && <p className="text-[12.5px] mt-2"><b>Last review note:</b> {r.reviewNote}</p>}
        </div>
      </div>
      {data.appeals.length > 0 && <p className="text-[12.5px] mt-3"><b>Appeals:</b> {data.appeals.map((a) => `${a.status}: “${a.message}”`).join(" · ")}</p>}
      {canAct && (
        <div className="mt-4 border-t border-border pt-4">
          <Err msg={err} />
          <Input placeholder="Reason / note (required, kept in the audit log)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2 mt-2">
            <Button variant="accent" disabled={note.trim().length < 3} onClick={() => review("approve")}>Approve</Button>
            <Button variant="ghost" disabled={note.trim().length < 3} onClick={() => review("hold")}>Hold for review</Button>
            <Button variant="danger" disabled={note.trim().length < 3} onClick={() => review("reject")}>Reject</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
function Referrals({ user }) {
  const [status, setStatus] = useState(""); const [risk, setRisk] = useState(""); const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useLoad(() => api.list({ status, risk }), [status, risk]);
  return (
    <div>
      <div className="flex gap-3 mb-4 max-w-md">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{["pending", "qualified", "under_review", "rejected", "expired", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
        <Select value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">Any risk</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
      </div>
      {open && <ReferralDetail id={open} user={user} onClose={() => setOpen(null)} onChanged={reload} />}
      <Err msg={error} />
      <Card className="p-4">
        {loading && !data ? <div className="py-10 flex justify-center"><Spinner /></div> : !data || data.referrals.length === 0 ? <EmptyState title="No referrals match" /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-inkFaint text-[11.5px]"><th className="pb-2">Referrer</th><th>Referred</th><th>Status</th><th>Risk</th><th>Joined</th><th /></tr></thead>
            <tbody>{data.referrals.map((r) => (
              <tr key={r.id} className="border-t border-border"><td className="py-2">{r.referrer}</td><td>{r.referred}</td><td><B v={r.status} /></td><td><Badge tone={TONE[r.riskLevel]}>{r.riskScore}</Badge></td><td>{when(r.createdAt)}</td>
                <td className="text-right"><button className="text-accent text-[12px] font-semibold" onClick={() => setOpen(r.id)}>Open</button></td></tr>
            ))}</tbody>
          </table>
        )}
        {data && data.total > data.referrals.length && <p className="text-[11.5px] text-inkFaint mt-3">Showing the latest {data.referrals.length} of {data.total}. Use the filters to narrow down.</p>}
      </Card>
    </div>
  );
}

/* ───────────── Fulfilment ───────────── */
function Fulfilment({ user }) {
  const canAct = user.role !== "admin_viewer";
  const [status, setStatus] = useState("queued");
  const { data, error, loading, reload } = useLoad(() => api.entitlements(status), [status]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState(""); const [result, setResult] = useState(null);
  const fileRef = useRef(null);
  const run = async (fn, ok) => { setErr(""); setMsg(""); try { await fn(); if (ok) setMsg(ok); reload(); } catch (e) { setErr(e.message); } };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setErr(""); setResult(null);
    try { setResult(await api.importResults(await f.text())); reload(); } catch (ex) { setErr(ex.message); }
    e.target.value = "";
  };
  return (
    <div>
      <Card className="p-5 mb-5">
        <p className="text-[13px] font-semibold text-ink mb-1">Manual fulfilment</p>
        <p className="text-[12px] text-inkFaint mb-3">Export the queue as CSV, deliver the rewards (airtime, vouchers…) with your partner, fill in the <b>result</b> column (<code>fulfilled</code> or <code>failed</code>) plus <b>reference</b> / <b>failure_reason</b>, and upload the same file back. Rows you leave blank stay in the queue. Uploading twice is safe.</p>
        {canAct ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" onClick={() => run(() => api.exportQueue({}), "Exported. The queued rewards are now marked with a batch id.")}>Export queue (CSV)</Button>
            <Button variant="ghost" onClick={() => fileRef.current?.click()}>Upload results (CSV)</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
          </div>
        ) : <p className="text-[12px] text-inkFaint">Read-only access.</p>}
        {msg && <p className="text-[12.5px] text-accent mt-3">{msg}</p>}
        <Err msg={err} />
        {result && (
          <div className="mt-3 text-[12.5px]">
            <p><b>{result.fulfilled}</b> delivered · <b>{result.failed}</b> failed · <b>{result.skipped}</b> unchanged · <b>{result.errors.length}</b> problems</p>
            {result.errors.map((x, i) => <p key={i} className="text-danger">Line {x.line}: {x.error}</p>)}
          </div>
        )}
      </Card>
      <div className="w-56 mb-3"><Select value={status} onChange={(e) => setStatus(e.target.value)}>{["queued", "failed", "pending_maturity", "under_review", "capped", "fulfilled", "cancelled"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select></div>
      <Err msg={error} />
      <Card className="p-4">
        {loading && !data ? <div className="py-10 flex justify-center"><Spinner /></div> : !data || data.entitlements.length === 0 ? <EmptyState title="Nothing here" /> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-inkFaint text-[11.5px]"><th className="pb-2">Customer</th><th>Phone</th><th>Reward</th><th>Value</th><th>Status</th><th>Ref / reason</th><th /></tr></thead>
            <tbody>{data.entitlements.map((e) => (
              <tr key={e.id} className="border-t border-border"><td className="py-2">{e.user}</td><td>{e.phone || "—"}</td><td>{e.reward}</td><td>{fmtTZS(e.valueTzs)}</td><td><B v={e.status} /></td><td className="text-inkFaint">{e.externalRef || e.failureReason || (e.maturesAt ? `matures ${when(e.maturesAt)}` : "")}</td>
                <td className="text-right whitespace-nowrap">{canAct && (<>
                  {["queued", "failed"].includes(e.status) && <button className="text-accent text-[12px] font-semibold mr-3" onClick={() => { const ref = window.prompt("Reference (voucher code / airtime transaction id), optional:"); if (ref !== null) run(() => api.fulfil(e.id, ref || undefined)); }}>Mark delivered</button>}
                  {e.status === "queued" && <button className="text-danger text-[12px] font-semibold mr-3" onClick={() => { const r = window.prompt("Why could it not be delivered?"); if (r) run(() => api.fail(e.id, r)); }}>Mark failed</button>}
                  {["failed", "capped"].includes(e.status) && <button className="text-inkSoft text-[12px] font-semibold mr-3" onClick={() => run(() => api.requeue(e.id))}>Re-queue</button>}
                  {user.role === "admin_super" && !["fulfilled", "cancelled"].includes(e.status) && <button className="text-danger text-[12px] font-semibold" onClick={() => { const r = window.prompt("Reason for cancelling this reward:"); if (r) run(() => api.cancel(e.id, r)); }}>Cancel</button>}
                </>)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/* ───────────── Appeals ───────────── */
function Appeals({ user }) {
  const canAct = user.role !== "admin_viewer";
  const [status, setStatus] = useState("open");
  const { data, error, loading, reload } = useLoad(() => api.appeals(status), [status]);
  const [err, setErr] = useState("");
  const resolve = async (id, decision) => {
    const note = window.prompt(decision === "upheld" ? "Note (the referral will be reinstated):" : "Reason for dismissing:");
    if (!note) return;
    setErr(""); try { await api.resolveAppeal(id, decision, note); reload(); } catch (e) { setErr(e.message); }
  };
  return (
    <div>
      <div className="w-48 mb-3"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="upheld">Upheld</option><option value="dismissed">Dismissed</option><option value="">All</option></Select></div>
      <Err msg={error || err} />
      <Card className="p-4">
        {loading && !data ? <div className="py-10 flex justify-center"><Spinner /></div> : !data || data.length === 0 ? <EmptyState title="No appeals" /> : data.map((a) => (
          <div key={a.id} className="border-t first:border-t-0 border-border py-3">
            <div className="flex justify-between"><p className="text-[13px] font-semibold text-ink">{a.user} <span className="text-inkFaint font-normal">· {when(a.createdAt)}</span></p><B v={a.status} /></div>
            <p className="text-[13px] mt-1">“{a.message}”</p>
            {a.resolutionNote && <p className="text-[12px] text-inkFaint mt-1">Resolution: {a.resolutionNote}</p>}
            {canAct && a.status === "open" && <div className="flex gap-2 mt-2"><Button variant="accent" onClick={() => resolve(a.id, "upheld")}>Uphold & reinstate</Button><Button variant="ghost" onClick={() => resolve(a.id, "dismissed")}>Dismiss</Button></div>}
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ───────────── Fraud rules ───────────── */
function Rules({ user }) {
  const isSuper = user.role === "admin_super";
  const { data, error, loading, reload } = useLoad(() => api.fraudRules());
  const [err, setErr] = useState("");
  const save = async (rule, patch) => { setErr(""); try { await api.updateFraudRule(rule.key, patch); reload(); } catch (e) { setErr(e.message); } };
  if (loading && !data) return <div className="py-16 flex justify-center"><Spinner size={26} /></div>;
  if (error) return <Err msg={error} />;
  return (
    <div>
      <p className="text-[12.5px] text-inkFaint mb-3">Each signal adds its weight to a referral's risk score. At <b>{data.holdScore}</b> the referral is held for manual review; at <b>{data.rejectScore}</b> it is refused automatically (change these two numbers in Settings → referral_fraud_*).</p>
      <Err msg={err} />
      <Card className="p-4">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-inkFaint text-[11.5px]"><th className="pb-2">Signal</th><th>When</th><th>Weight</th><th>Settings</th><th>On</th></tr></thead>
          <tbody>{data.rules.map((r) => (
            <tr key={r.key} className="border-t border-border align-top">
              <td className="py-2">{r.label}<span className="block text-[11px] text-inkFaint">{r.key}</span></td>
              <td>{r.stage === "any" ? "signup + payout" : r.stage}</td>
              <td className="w-24"><Input type="number" defaultValue={r.weight} disabled={!isSuper} onBlur={(e) => Number(e.target.value) !== r.weight && save(r, { weight: Number(e.target.value) })} /></td>
              <td className="w-56">{Object.entries(r.params).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2 text-[11.5px] text-inkFaint mb-1">{k}<Input type="number" defaultValue={v} disabled={!isSuper} className="!py-1" onBlur={(e) => Number(e.target.value) !== v && save(r, { params: { [k]: Number(e.target.value) } })} /></label>
              ))}</td>
              <td><input type="checkbox" checked={r.enabled} disabled={!isSuper} onChange={(e) => save(r, { enabled: e.target.checked })} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

export default function ReferralsPage({ user }) {
  const [tab, setTab] = useState("overview");
  return (
    <div>
      <h1 className="font-display text-[22px] font-bold text-ink mb-1">Referrals & rewards</h1>
      <p className="text-[13px] text-inkFaint mb-5">Invite campaigns, rewards, fulfilment and fraud review. Referrers never see a friend's financial data — and neither does this page.</p>
      <div className="flex flex-wrap gap-1.5 mb-6">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-3.5 py-2 rounded-lg text-[13px] font-semibold ${tab === t.key ? "bg-ink text-white" : "bg-white border border-border text-inkSoft hover:bg-bgSoft"}`}>{t.label}</button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "campaigns" && <Campaigns user={user} />}
      {tab === "rewards" && <Rewards user={user} />}
      {tab === "referrals" && <Referrals user={user} />}
      {tab === "fulfilment" && <Fulfilment user={user} />}
      {tab === "appeals" && <Appeals user={user} />}
      {tab === "rules" && <Rules user={user} />}
    </div>
  );
}
