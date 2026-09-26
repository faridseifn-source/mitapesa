const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const DEFAULT_CATEGORIES = [
  { name: "Food & Dining", color: "#C4913C", subcategories: ["Groceries", "Restaurants", "Coffee & Snacks", "Takeout & Delivery"] },
  { name: "Transportation", color: "#3D7EA6", subcategories: ["Fuel", "Public Transit", "Ride-hailing", "Parking", "Vehicle Maintenance"] },
  { name: "Housing & Utilities", color: "#1F6F50", subcategories: ["Rent/Mortgage", "Electricity", "Water", "Internet", "Home Maintenance"] },
  { name: "Shopping", color: "#B44B36", subcategories: ["Clothing", "Electronics", "Household Items", "Gifts"] },
  { name: "Health & Medical", color: "#4E7E8E", subcategories: ["Pharmacy", "Doctor Visits", "Insurance", "Fitness"] },
  { name: "Education", color: "#7C6BAE", subcategories: ["Tuition", "Books & Supplies", "Courses"] },
  { name: "Entertainment", color: "#A0527C", subcategories: ["Movies & Shows", "Events", "Games", "Streaming"] },
  { name: "Bills & Subscriptions", color: "#4A8C8C", subcategories: ["Phone", "Software", "Memberships"] },
  { name: "Family", color: "#9C7A4A", subcategories: ["Childcare", "School Fees", "Family Support"] },
  { name: "Personal Care", color: "#6B8E4E", subcategories: ["Salon & Grooming", "Cosmetics", "Wellness"] },
  { name: "Financial", color: "#5B7FBA", subcategories: ["Bank Fees", "Loan Payments", "Savings & Investing"] },
  { name: "Travel", color: "#B08968", subcategories: ["Flights", "Accommodation", "Activities"] },
  { name: "Other", color: "#8A8578", subcategories: ["Miscellaneous"] },
  { name: "Income", color: "#2E8B57", subcategories: ["Salary", "Wage", "Commission", "Dividend", "Business Income", "Freelance/Contract", "Rental Income", "Interest", "Gift", "Refund", "Other Income"] },
];

// Starting draft content only — every string here is meant to be
// reviewed and corrected via the admin dashboard's Onboarding Tips
// screen before real customers see it, especially the Swahili: this is
// a reasonable first draft, not authoritative regional phrasing. That's
// the whole point of storing tips in the database rather than hardcoding
// them in the app — a wording fix here takes effect for every customer
// immediately, no code change or app update needed.
const DEFAULT_TIPS = [
  { key: "welcome_1", tourStep: 1, textEn: "Welcome to MitaPesa! Let's take a quick look at what you can do.", textSw: "Karibu MitaPesa! Hebu tuangalie kwa haraka unachoweza kufanya." },
  { key: "welcome_2", tourStep: 2, textEn: "Log your expenses in seconds — type them, scan a receipt, or just speak them out loud.", textSw: "Andika matumizi yako kwa sekunde chache — yaandike, piga picha ya risiti, au yaseme tu kwa sauti." },
  { key: "welcome_3", tourStep: 3, textEn: "See exactly where your money goes each month with simple charts.", textSw: "Ona kwa uwazi pesa zako zinaenda wapi kila mwezi kwa chati rahisi." },
  { key: "welcome_4", tourStep: 4, textEn: "Have a question about your spending? Just ask — our AI will explain it in plain language.", textSw: "Una swali kuhusu matumizi yako? Uliza tu — AI yetu itakueleza kwa lugha rahisi." },
  { key: "home", tourStep: null, textEn: "This is your Home — check your balance, recent activity, and quick actions here anytime.", textSw: "Hii ni ukurasa wako wa Nyumbani — angalia salio lako, shughuli za hivi karibuni, na vitendo vya haraka wakati wowote." },
  { key: "voiceLog", tourStep: null, textEn: "Tap the mic and just say what you spent — our AI logs it for you automatically, in English or Swahili.", textSw: "Gusa kipaza sauti kisha sema tu ulichotumia — AI yetu itakuandikia kiotomatiki, kwa Kiingereza au Kiswahili." },
  { key: "askAi", tourStep: null, textEn: "Type any question about your spending — like \"where did my money go this month?\" — and get a clear answer with a simple chart.", textSw: "Andika swali lolote kuhusu matumizi yako — kama \"pesa zangu zimeenda wapi mwezi huu?\" — na upate jibu wazi pamoja na chati rahisi." },
  { key: "scanReceipt", tourStep: null, textEn: "Snap a photo of a receipt and MitaPesa fills in the details for you.", textSw: "Piga picha ya risiti na MitaPesa itajaza maelezo kwa ajili yako." },
  { key: "insights", tourStep: null, textEn: "See where your money goes with clear charts, broken down by category and month.", textSw: "Ona pesa zako zinaenda wapi kwa chati wazi, zilizogawanywa kwa aina na mwezi." },
  { key: "budgets", tourStep: null, textEn: "Set a spending limit for each category and track how you're doing against it.", textSw: "Weka kiwango cha matumizi kwa kila aina na fuatilia jinsi unavyofanya." },
  { key: "lipa", tourStep: null, textEn: "Scan a QR code to pay instantly at any participating shop or business.", textSw: "Skani msimbo wa QR kulipa papo hapo katika duka au biashara yoyote inayoshiriki." },
];

async function main() {
  for (const cat of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { name: cat.name, userId: null } });
    if (existing) continue;
    await prisma.category.create({
      data: {
        name: cat.name,
        color: cat.color,
        userId: null,
        subcategories: { create: cat.subcategories.map((name) => ({ name })) },
      },
    });
    console.log(`Seeded category: ${cat.name}`); // eslint-disable-line no-console
  }

  for (const tip of DEFAULT_TIPS) {
    const existing = await prisma.onboardingTip.findUnique({ where: { key: tip.key } });
    if (existing) continue;
    await prisma.onboardingTip.create({ data: tip });
    console.log(`Seeded onboarding tip: ${tip.key}`); // eslint-disable-line no-console
  }
}

main()
  .catch((e) => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
