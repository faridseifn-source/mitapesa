const prisma = require("../prisma");
const { notifyUser } = require("../notify");

// Customer-facing notification copy, English and Swahili. Written to be
// short and never to mention the other person's finances.
const T = {
  friend_joined: {
    en: (v) => ({ title: "A friend joined MitaPesa", message: `${v.name} joined using your invite. You earn a reward when they finish the onboarding steps.` }),
    sw: (v) => ({ title: "Rafiki amejiunga na MitaPesa", message: `${v.name} amejiunga kwa mwaliko wako. Utapata zawadi akikamilisha hatua za mwanzo.` }),
  },
  milestone: {
    en: (v) => ({ title: "Onboarding step completed", message: `${v.name} completed "${v.step}".` }),
    sw: (v) => ({ title: "Hatua imekamilika", message: `${v.name} amekamilisha "${v.step}".` }),
  },
  referral_qualified: {
    en: (v) => ({ title: "Referral completed", message: `${v.name} completed all the steps. Your reward is being processed.` }),
    sw: (v) => ({ title: "Mwaliko umekamilika", message: `${v.name} amekamilisha hatua zote. Zawadi yako inashughulikiwa.` }),
  },
  reward_available: {
    en: (v) => ({ title: "You earned a reward", message: `${v.reward} is now yours. Open Rewards to see it.` }),
    sw: (v) => ({ title: "Umepata zawadi", message: `${v.reward} sasa ni yako. Fungua Zawadi kuiona.` }),
  },
  reward_ai_credits: {
    en: (v) => ({ title: "AI credits added", message: `${v.reward} was added to your account and is ready to use.` }),
    sw: (v) => ({ title: "Salio la AI limeongezwa", message: `${v.reward} imeongezwa kwenye akaunti yako na iko tayari kutumika.` }),
  },
  reward_waiver_active: {
    en: (v) => ({ title: "Fee-free payments unlocked", message: `${v.reward} is active until ${v.until}. No MitaPesa fees on your payments until then.` }),
    sw: (v) => ({ title: "Malipo bila ada yamefunguliwa", message: `${v.reward} inatumika hadi ${v.until}. Hakuna ada ya MitaPesa kwenye malipo yako hadi wakati huo.` }),
  },
  reward_waiver_ready: {
    en: (v) => ({ title: "Fee waiver earned", message: `${v.reward} is yours. It starts automatically when payments launch in MitaPesa.` }),
    sw: (v) => ({ title: "Umepata msamaha wa ada", message: `${v.reward} ni yako. Inaanza kiotomatiki malipo yakianza kwenye MitaPesa.` }),
  },
  reward_fulfilled: {
    en: (v) => ({ title: "Reward delivered", message: `${v.reward} has been delivered.${v.ref ? ` Reference: ${v.ref}.` : ""}` }),
    sw: (v) => ({ title: "Zawadi imetumwa", message: `${v.reward} imetumwa.${v.ref ? ` Kumbukumbu: ${v.ref}.` : ""}` }),
  },
  reward_failed: {
    en: (v) => ({ title: "Reward delayed", message: `We couldn't deliver ${v.reward} yet. Our team will follow up.` }),
    sw: (v) => ({ title: "Zawadi imechelewa", message: `Hatukuweza kutuma ${v.reward} bado. Timu yetu itafuatilia.` }),
  },
  referral_review: {
    en: () => ({ title: "Referral under review", message: "One of your referrals is being checked. This can take a few days. You can send us a note from the Rewards screen." }),
    sw: () => ({ title: "Mwaliko unakaguliwa", message: "Mwaliko mmoja unakaguliwa. Hii inaweza kuchukua siku chache. Unaweza kututumia ujumbe kupitia Zawadi." }),
  },
  referral_rejected: {
    en: () => ({ title: "Referral not eligible", message: "A referral didn't meet the programme rules, so no reward applies. You can appeal from the Rewards screen." }),
    sw: () => ({ title: "Mwaliko haukidhi vigezo", message: "Mwaliko haukidhi vigezo vya programu, hivyo hakuna zawadi. Unaweza kukata rufaa kupitia Zawadi." }),
  },
  appeal_resolved: {
    en: (v) => ({ title: "Appeal reviewed", message: v.upheld ? "Your appeal was accepted and the referral has been reinstated." : "We reviewed your appeal and the decision stands." }),
    sw: (v) => ({ title: "Rufaa imepitiwa", message: v.upheld ? "Rufaa yako imekubaliwa na mwaliko umerejeshwa." : "Tumepitia rufaa yako na uamuzi unabaki." }),
  },
};

// Best-effort. A notification failing must never undo or block reward logic.
async function sendReferralNotice(userId, key, vars = {}) {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { language: true } });
    const lang = user && user.language === "sw" ? "sw" : "en";
    const { title, message } = T[key][lang](vars);
    await notifyUser(userId, { type: `referral_${key}`, title, message, url: "/" });
  } catch (err) {
    console.error(`Referral notification [${key}] failed:`, err.message); // eslint-disable-line no-console
  }
}

module.exports = { sendReferralNotice };
