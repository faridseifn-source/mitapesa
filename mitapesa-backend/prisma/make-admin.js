// Usage: node prisma/make-admin.js someone@example.com [admin_super|admin_support|admin_viewer]
// Defaults to admin_super if no tier is given.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const VALID_ROLES = ["admin_super", "admin_support", "admin_viewer"];

async function main() {
  const email = process.argv[2];
  const role = process.argv[3] || "admin_super";
  if (!email) {
    console.error("Usage: node prisma/make-admin.js <email> [admin_super|admin_support|admin_viewer]"); // eslint-disable-line no-console
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`); // eslint-disable-line no-console
    process.exit(1);
  }
  const user = await prisma.user.update({ where: { email }, data: { role } });
  console.log(`${user.email} is now ${role}.`); // eslint-disable-line no-console
}

main()
  .catch((e) => {
    console.error(e); // eslint-disable-line no-console
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
