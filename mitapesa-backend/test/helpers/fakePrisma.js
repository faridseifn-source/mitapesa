// Minimal in-memory stand-in for the Prisma client, covering exactly the
// operations the referral module uses, including unique constraints (P2002)
// and schema defaults, so idempotency can be tested without a database.
let seq = 0;
const cuid = () => `id${++seq}`;

const UNIQUES = {
  referralCode: [["userId"], ["code"]],
  referral: [["referredUserId"]],
  referralEvent: [["userId", "eventName", "eventRef"]],
  referralMilestoneProgress: [["referralId", "milestoneId"]],
  referralDevice: [["userId", "deviceHash"]],
  rewardEntitlement: [["idempotencyKey"]],
  aiRewardCredit: [["entitlementId"]],
  referralCampaign: [["slug"]],
  user: [["email"], ["phone"]],
  fraudRule: [["key"]],
  systemSetting: [["key"]],
};
const DEFAULTS = {
  referralCampaign: { status: "draft", qualifyWithinDays: 30, maxReferralsPerReferrer: 0, maxRewardsPerReferrer: 0, maxRewardsTotal: 0, budgetTzs: null, startsAt: null, endsAt: null, descriptionEn: "", descriptionSw: "", termsEn: "", termsSw: "" },
  referralMilestone: { sequence: 1, threshold: 1, required: true, referrerRewardId: null, referredRewardId: null, maturityDays: 0, active: true },
  referralCode: { active: true },
  referral: { status: "pending", riskScore: 0, riskLevel: "low", deviceHash: null, ipHash: null, qualifiedAt: null, reviewNote: null },
  referralMilestoneProgress: { progress: 0, achievedAt: null },
  rewardDefinition: { fulfilment: "manual", aiFeature: null, aiCredits: 0, aiValidDays: 90, valueTzs: 0, costTzs: 0, validityDays: 30, stockLimit: 0, issuedCount: 0, active: true, partnerId: null, descriptionEn: "", descriptionSw: "" },
  rewardEntitlement: { status: "pending_maturity", valueTzs: 0, costTzs: 0, maturesAt: null, fulfilmentBatchId: null, externalRef: null, failureReason: null, fulfilledAt: null, expiresAt: null },
  rewardTransaction: { actor: "system", note: null, amountTzs: null },
  aiRewardCredit: { feature: "all", creditsUsed: 0, expiresAt: null, status: "active" },
  user: { language: "en", blockedByAdmin: false, deletedAt: null, role: "customer" },
  fraudRule: { enabled: true, weight: 20, params: null },
  voiceCreditPurchase: { creditsUsed: 0 },
  feeExemption: { isActive: true, endDate: null },
};

function matches(row, where = {}) {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return cond.some((w) => matches(row, w));
    if (k === "AND") return cond.every((w) => matches(row, w));
    const v = row[k];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, x]) => {
        if (op === "in") return x.includes(v);
        if (op === "not") return v !== x;
        if (op === "lt") return v < x;
        if (op === "lte") return v <= x;
        if (op === "gt") return v > x;
        if (op === "gte") return v >= x;
        throw new Error(`fake prisma: unsupported operator ${op}`);
      });
    }
    return (v === undefined ? null : v) === cond;
  });
}

function makeModel(name, store) {
  const rows = () => (store[name] ||= []);
  const uniqueClash = (data, ignoreId) => {
    for (const cols of UNIQUES[name] || []) {
      if (cols.every((c) => data[c] !== undefined && data[c] !== null) && rows().some((r) => r.id !== ignoreId && cols.every((c) => r[c] === data[c]))) {
        const e = new Error(`Unique constraint failed on ${cols.join(",")}`); e.code = "P2002"; return e;
      }
    }
    return null;
  };
  const apply = (row, data) => {
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && typeof v === "object" && !(v instanceof Date) && "increment" in v) row[k] = (row[k] || 0) + v.increment;
      else if (v !== undefined) row[k] = v;
    }
  };
  const resolveWhere = (where) => {
    // compound unique selector e.g. { referralId_milestoneId: {referralId, milestoneId} }
    const flat = {};
    for (const [k, v] of Object.entries(where)) {
      if (v && typeof v === "object" && !(v instanceof Date) && k.includes("_") && !["in", "not"].some((o) => o in v)) Object.assign(flat, v); else flat[k] = v;
    }
    return flat;
  };
  const sortRows = (arr, orderBy) => {
    if (!orderBy) return arr;
    const [[k, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy);
    return [...arr].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (dir === "desc" ? -1 : 1));
  };
  return {
    async findUnique({ where }) { return rows().find((r) => matches(r, resolveWhere(where))) || null; },
    async findUniqueOrThrow({ where }) { const r = await this.findUnique({ where }); if (!r) throw new Error("not found"); return r; },
    async findFirst({ where = {}, orderBy } = {}) { return sortRows(rows().filter((r) => matches(r, where)), orderBy)[0] || null; },
    async findMany({ where = {}, orderBy } = {}) { return sortRows(rows().filter((r) => matches(r, where)), orderBy); },
    async count({ where = {} } = {}) { return rows().filter((r) => matches(r, where)).length; },
    async create({ data }) {
      const clash = uniqueClash({ ...(DEFAULTS[name] || {}), ...data });
      if (clash) throw clash;
      const row = { id: cuid(), createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[name] || {}) };
      apply(row, data);
      rows().push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows().find((r) => matches(r, resolveWhere(where)));
      if (!row) throw new Error(`${name}.update: not found`);
      const clash = uniqueClash({ ...row, ...data }, row.id); if (clash) throw clash;
      apply(row, data); row.updatedAt = new Date(); return { ...row };
    },
    async updateMany({ where = {}, data }) {
      const hit = rows().filter((r) => matches(r, where));
      hit.forEach((r) => { apply(r, data); r.updatedAt = new Date(); });
      return { count: hit.length };
    },
    async upsert({ where, update, create }) {
      const row = rows().find((r) => matches(r, resolveWhere(where)));
      if (row) { apply(row, update); return { ...row }; }
      return this.create({ data: create });
    },
    async aggregate({ where = {} }) { const hit = rows().filter((r) => matches(r, where)); return { _sum: { estimatedCostUsd: hit.reduce((s, r) => s + Number(r.estimatedCostUsd || 0), 0) } }; },
  };
}

function createFakePrisma() {
  const store = {};
  return new Proxy({ _store: store }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol" || prop === "then") return undefined;
      target[prop] = makeModel(prop, store);
      return target[prop];
    },
  });
}

module.exports = { createFakePrisma };
