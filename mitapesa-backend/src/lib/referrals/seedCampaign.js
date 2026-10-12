const prisma = require("../prisma");

/**
 * Creates the recommended first campaign as a DRAFT, with its reward
 * definitions, so staff can review the wording and limits and then press
 * Activate. Safe to call twice (it refuses if the slug exists).
 */
async function seedFirstCampaign(createdByUserId) {
  const slug = "pamoja-budget-challenge";
  const existing = await prisma.referralCampaign.findUnique({ where: { slug } });
  if (existing) return { created: false, campaign: existing };

  const welcome = await prisma.rewardDefinition.create({
    data: {
      type: "ai_credits", fulfilment: "auto", aiFeature: "all", aiCredits: 5, aiValidDays: 60,
      nameEn: "5 free AI credits", nameSw: "Salio 5 la AI bila malipo",
      descriptionEn: "Use them for voice logging and Ask AI.", descriptionSw: "Tumia kwa kurekodi kwa sauti na Uliza AI.",
      costTzs: 500,
    },
  });
  const thanks = await prisma.rewardDefinition.create({
    data: {
      type: "ai_credits", fulfilment: "auto", aiFeature: "all", aiCredits: 20, aiValidDays: 90,
      nameEn: "20 free AI credits", nameSw: "Salio 20 la AI bila malipo",
      descriptionEn: "A thank-you for bringing a friend to MitaPesa.", descriptionSw: "Asante kwa kumleta rafiki MitaPesa.",
      costTzs: 2000,
    },
  });

  // Fee waiver (starts only once Pay is live). Ready for the activation steps below.
  const waiver = await prisma.rewardDefinition.create({
    data: {
      type: "fee_waiver", fulfilment: "auto", waiverDays: 30, validityDays: 30,
      nameEn: "30 days of fee-free payments", nameSw: "Siku 30 za malipo bila ada",
      descriptionEn: "No MitaPesa fees on your payments for 30 days.", descriptionSw: "Hakuna ada ya MitaPesa kwenye malipo yako kwa siku 30.",
      costTzs: 0,
    },
  });

  const campaign = await prisma.referralCampaign.create({
    data: {
      slug, status: "draft", createdByUserId: createdByUserId || null,
      nameEn: "Pamoja Budget Challenge", nameSw: "Pamoja Budget Challenge Na MitaPesa",
      descriptionEn: "Invite a friend. When they set up their first budget and build the habit of tracking their money, you both earn free AI credits.",
      descriptionSw: "Mwalike rafiki. Akitengeneza bajeti yake ya kwanza na kuanza tabia ya kufuatilia pesa zake, nyote wawili mnapata salio la AI bila malipo.",
      termsEn: "One reward per friend who completes every step within 30 days. Rewards for the person who invited are released after a short review period. Fake, duplicate or self-referred accounts are not eligible. MitaPesa may change or end the campaign at any time. Rewards have no cash value.",
      termsSw: "Zawadi moja kwa kila rafiki anayekamilisha hatua zote ndani ya siku 30. Zawadi ya aliyemwalika hutolewa baada ya kipindi kifupi cha ukaguzi. Akaunti bandia, zinazojirudia au za kujialika hazistahili. MitaPesa inaweza kubadilisha au kumaliza kampeni wakati wowote. Zawadi hazina thamani ya fedha taslimu.",
      qualifyWithinDays: 30, maxReferralsPerReferrer: 20, maxRewardsPerReferrer: 20, maxRewardsTotal: 0, budgetTzs: 1000000,
    },
  });

  const steps = [
    { sequence: 1, eventName: "signed_up", threshold: 1, titleEn: "Join MitaPesa", titleSw: "Jiunge na MitaPesa" },
    { sequence: 2, eventName: "budget_created", threshold: 1, titleEn: "Create your first budget", titleSw: "Tengeneza bajeti yako ya kwanza", referredRewardId: welcome.id },
    { sequence: 3, eventName: "transaction_logged", threshold: 5, titleEn: "Log 5 transactions", titleSw: "Rekodi miamala 5" },
    { sequence: 4, eventName: "daily_active", threshold: 3, titleEn: "Open MitaPesa on 3 different days", titleSw: "Fungua MitaPesa kwa siku 3 tofauti", referrerRewardId: thanks.id, maturityDays: 7 },
  ];
  for (const s of steps) await prisma.referralMilestone.create({ data: { campaignId: campaign.id, required: true, ...s } });
  // Activation steps for when the Pay module goes live. Created switched OFF
  // (they don't gate anything while off): turn them on in Admin → Campaigns.
  const activation = [
    { sequence: 5, eventName: "kyc_verified", threshold: 1, titleEn: "Verify your identity", titleSw: "Thibitisha utambulisho wako" },
    { sequence: 6, eventName: "topup_completed", threshold: 1, titleEn: "Add money to your card", titleSw: "Weka pesa kwenye kadi yako" },
    { sequence: 7, eventName: "payment_completed", threshold: 1, titleEn: "Make your first payment", titleSw: "Fanya malipo yako ya kwanza", referredRewardId: waiver.id, referrerRewardId: waiver.id, maturityDays: 7 },
  ];
  for (const s of activation) await prisma.referralMilestone.create({ data: { campaignId: campaign.id, required: false, active: false, ...s } });
  return { created: true, campaign };
}

module.exports = { seedFirstCampaign };
