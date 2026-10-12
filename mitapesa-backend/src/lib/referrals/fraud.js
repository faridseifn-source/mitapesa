const prisma = require("../prisma");
const { getSettingNumber } = require("../settings");

const HOUR = 3600000;
const DISPOSABLE_DOMAINS = ["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com"];

// Each rule: default weight/params, which stage it runs at, and a check that
// returns a short human reason (or null). Admins can switch rules off and
// change weight/params from the dashboard (FraudRule rows override these).
const RULES = [
  {
    key: "blocked_user", stage: "any", weight: 100, label: "Referrer or referred account is blocked",
    check: async ({ referrer, referred }) => ((referrer && referrer.blockedByAdmin) || (referred && referred.blockedByAdmin) ? "Blocked account involved" : null),
  },
  {
    key: "self_referral_device", stage: "any", weight: 100, label: "Referred device was already used by the referrer",
    check: async ({ referral }) => {
      if (!referral.deviceHash) return null;
      const seen = await prisma.referralDevice.findMany({ where: { deviceHash: referral.deviceHash } });
      return seen.some((d) => d.userId === referral.referrerUserId) ? "Same device as the referrer" : null;
    },
  },
  {
    key: "device_reuse", stage: "any", weight: 60, params: { max: 1 }, label: "Same device behind several referred accounts",
    check: async ({ referral, params }) => {
      if (!referral.deviceHash) return null;
      const others = await prisma.referral.findMany({ where: { deviceHash: referral.deviceHash } });
      const n = others.filter((r) => r.id !== referral.id && r.referredUserId !== referral.referredUserId).length;
      return n >= (params.max ?? 1) ? `Device already linked to ${n} other referred account(s)` : null;
    },
  },
  {
    key: "ip_burst", stage: "any", weight: 30, params: { max: 3, hours: 24 }, label: "Many referred sign-ups from one network in a short time",
    check: async ({ referral, params }) => {
      if (!referral.ipHash) return null;
      const since = Date.now() - (params.hours ?? 24) * HOUR;
      const rows = await prisma.referral.findMany({ where: { ipHash: referral.ipHash } });
      const n = rows.filter((r) => r.id !== referral.id && new Date(r.createdAt).getTime() >= since).length;
      return n + 1 >= (params.max ?? 3) ? `${n + 1} sign-ups from one network within ${params.hours ?? 24}h` : null;
    },
  },
  {
    key: "same_network_as_referrer", stage: "any", weight: 15, label: "Referred sign-up from the referrer's own network",
    check: async ({ referral }) => {
      if (!referral.ipHash) return null;
      const seen = await prisma.referralDevice.findMany({ where: { userId: referral.referrerUserId } });
      return seen.some((d) => d.ipHash && d.ipHash === referral.ipHash) ? "Same network as the referrer (may be a household)" : null;
    },
  },
  {
    key: "referrer_velocity", stage: "any", weight: 40, params: { max: 10, hours: 24 }, label: "Referrer gaining referrals unusually fast",
    check: async ({ referral, params }) => {
      const since = Date.now() - (params.hours ?? 24) * HOUR;
      const rows = await prisma.referral.findMany({ where: { referrerUserId: referral.referrerUserId } });
      const n = rows.filter((r) => new Date(r.createdAt).getTime() >= since).length;
      return n >= (params.max ?? 10) ? `${n} referrals in ${params.hours ?? 24}h` : null;
    },
  },
  {
    key: "disposable_email", stage: "signup", weight: 25, label: "Disposable email address",
    check: async ({ referred }) => {
      const domain = String((referred && referred.email) || "").split("@")[1] || "";
      return DISPOSABLE_DOMAINS.includes(domain.toLowerCase()) ? "Disposable email domain" : null;
    },
  },
  {
    key: "no_device_id", stage: "signup", weight: 10, label: "No device fingerprint supplied",
    check: async ({ referral }) => (referral.deviceHash ? null : "No device information (old app version or tampered client)"),
  },
  {
    key: "rapid_completion", stage: "maturity", weight: 40, params: { minutes: 10, minEvents: 3 }, label: "All activity completed in a few minutes",
    // Only event TIMESTAMPS are read — never amounts, merchants or balances.
    check: async ({ referral, params }) => {
      const events = await prisma.referralEvent.findMany({ where: { userId: referral.referredUserId, eventName: "transaction_logged" } });
      if (events.length < (params.minEvents ?? 3)) return null;
      const times = events.map((e) => new Date(e.createdAt).getTime());
      const span = Math.max(...times) - Math.min(...times);
      return span <= (params.minutes ?? 10) * 60000 ? `${events.length} transactions logged within ${Math.round(span / 60000)} min` : null;
    },
  },
];

async function loadRuleConfig() {
  const rows = await prisma.fraudRule.findMany({});
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  return RULES.map((rule) => {
    const o = byKey[rule.key];
    return {
      key: rule.key, label: rule.label, stage: rule.stage,
      enabled: o ? o.enabled : true,
      weight: o ? o.weight : rule.weight,
      params: { ...(rule.params || {}), ...((o && o.params) || {}) },
      defaultWeight: rule.weight, defaultParams: rule.params || {},
      check: rule.check,
    };
  });
}

async function thresholds() {
  const hold = (await getSettingNumber("referral_fraud_hold_score")) ?? 50;
  const reject = (await getSettingNumber("referral_fraud_reject_score")) ?? 100;
  return { hold, reject };
}

/**
 * Scores a referral. stage "signup" runs at attribution, "maturity" runs
 * again just before a reward is released (behaviour is only visible then).
 * Returns {score, level, decision: allow|hold|reject, reasons:[{key,reason,weight}]}.
 * Every reason is stored (RiskEvaluation) so a reviewer sees WHY.
 */
async function evaluateReferral({ referral, referrer, referred, stage }) {
  const rules = await loadRuleConfig();
  const reasons = [];
  let score = 0;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.stage !== "any" && rule.stage !== stage) continue;
    let reason = null;
    try {
      reason = await rule.check({ referral, referrer, referred, params: rule.params });
    } catch (err) {
      console.error(`Fraud rule ${rule.key} failed:`, err.message); // eslint-disable-line no-console
    }
    if (reason) {
      reasons.push({ key: rule.key, reason, weight: rule.weight });
      score += rule.weight;
    }
  }
  score = Math.min(100, score);
  const t = await thresholds();
  const decision = score >= t.reject ? "reject" : score >= t.hold ? "hold" : "allow";
  const level = score >= t.hold ? "high" : score >= 25 ? "medium" : "low";
  return { score, level, decision, reasons };
}

module.exports = { evaluateReferral, loadRuleConfig, RULES };
