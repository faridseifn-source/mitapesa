// Project types offered when a customer starts a project. Each carries a recommended starting set of categories
// (the customer can keep, drop or add their own). Titles/descriptions are bilingual; category names stay in English
// like every other category in the app. Everything here is plain data: no AI, no cost.
const TEMPLATES = [
  { key: "home_build", titleEn: "Build my home", titleSw: "Kujenga nyumba", descEn: "From land to move-in day", descSw: "Kutoka kiwanja hadi kuhamia",
    categories: ["Land & permits", "Materials", "Labour", "Professional fees", "Delivery & transport", "Utilities connection", "Furniture & fittings", "Contingency"] },
  { key: "home_renovation", titleEn: "Renovate my home", titleSw: "Kukarabati nyumba", descEn: "Repairs, upgrades and finishing", descSw: "Ukarabati, maboresho na umaliziaji",
    categories: ["Materials", "Labour", "Painting & finishes", "Plumbing & electrical", "Furniture & fittings", "Professional fees", "Contingency"] },
  { key: "wedding", titleEn: "Wedding", titleSw: "Harusi", descEn: "Venue, food, attire and more", descSw: "Ukumbi, chakula, mavazi na zaidi",
    categories: ["Venue & tents", "Catering", "Attire & beauty", "Decor & flowers", "Photography & video", "Music & entertainment", "Invitations & gifts", "Delivery & transport", "Contingency"] },
  { key: "education", titleEn: "School or university fees", titleSw: "Ada za shule au chuo", descEn: "Fees, books, uniforms and living costs", descSw: "Ada, vitabu, sare na gharama za maisha",
    categories: ["Tuition & fees", "Books & supplies", "Uniforms & gear", "Accommodation", "School transport", "Exams & registration", "Contingency"] },
  { key: "business", titleEn: "Start a business", titleSw: "Kuanzisha biashara", descEn: "Set-up costs before the first sale", descSw: "Gharama za kuanza kabla ya mauzo ya kwanza",
    categories: ["Registration & licences", "Equipment", "Stock & supplies", "Premises & rent", "Marketing", "Staff & labour", "Professional fees", "Contingency"] },
  { key: "vehicle", titleEn: "Buy a vehicle", titleSw: "Kununua gari au pikipiki", descEn: "Price, duties, insurance and extras", descSw: "Bei, kodi, bima na vifaa vya ziada",
    categories: ["Vehicle purchase", "Duties & registration", "Insurance", "Repairs & accessories", "Contingency"] },
  { key: "travel", titleEn: "Big trip", titleSw: "Safari kubwa", descEn: "Flights, stay, visa and activities", descSw: "Tiketi, malazi, visa na shughuli",
    categories: ["Flights & transport", "Stay", "Visa & documents", "Food & daily needs", "Activities", "Shopping & gifts", "Contingency"] },
  { key: "pilgrimage", titleEn: "Hajj or Umrah", titleSw: "Hijja au Umra", descEn: "Package, visa, stay and daily needs", descSw: "Kifurushi, visa, malazi na mahitaji ya kila siku",
    categories: ["Package & flights", "Visa & documents", "Stay", "Food & daily needs", "Gifts & donations", "Contingency"] },
  { key: "family_event", titleEn: "Funeral or family event", titleSw: "Msiba au tukio la familia", descEn: "Food, venue, transport and support", descSw: "Chakula, ukumbi, usafiri na msaada",
    categories: ["Catering", "Venue & tents", "Delivery & transport", "Ceremony & memorial", "Family support", "Contingency"] },
  { key: "farm", titleEn: "Farm or land project", titleSw: "Mradi wa shamba", descEn: "Inputs, labour, equipment and water", descSw: "Pembejeo, vibarua, vifaa na maji",
    categories: ["Land & permits", "Seeds & inputs", "Labour", "Equipment", "Irrigation & water", "Delivery & transport", "Contingency"] },
  { key: "custom", titleEn: "Something else", titleSw: "Kitu kingine", descEn: "Start from scratch with your own categories", descSw: "Anza upya na aina zako mwenyewe",
    categories: [] },
];

const COLORS = ["#8E5B7F", "#C97B63", "#5E9E8A", "#B0876B", "#6F9BB8", "#8C7EA8", "#A67C52", "#7E8E4E", "#B5546B", "#4F8FA3", "#9A7B2F", "#6C8F5C"];

// Union of every template category (+ the generic fallback), in a stable order, so each can be created once as a global project category.
const ALL_CATEGORY_NAMES = (() => {
  const seen = new Set(["Materials", "Labour", "Land & permits", "Furniture & fittings", "Delivery & transport", "Professional fees", "Contingency", "Project other"]);
  const out = [...seen];
  for (const t of TEMPLATES) for (const n of t.categories) if (!seen.has(n)) { seen.add(n); out.push(n); }
  return out;
})();
const colorFor = (name) => COLORS[ALL_CATEGORY_NAMES.indexOf(name) % COLORS.length] || COLORS[0];

const templatesForClient = () => TEMPLATES.map((t) => ({ ...t }));

module.exports = { TEMPLATES, ALL_CATEGORY_NAMES, colorFor, templatesForClient };
