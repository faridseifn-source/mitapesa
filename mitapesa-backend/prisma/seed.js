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
}

main()
  .catch((e) => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
