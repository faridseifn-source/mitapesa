const prisma = require("../lib/prisma");
const { forbidden } = require("../lib/errors");
const { isAdminRole, roleAtLeast } = require("../lib/adminRoles");

// Must run after requireAuth (needs req.userId already set). Attaches
// req.adminRole so route handlers can branch on tier without a second query.
async function requireAdmin(req, res, next) {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
  if (!user || !isAdminRole(user.role)) return next(forbidden("Admin access required"));
  req.adminRole = user.role;
  next();
}

// Use after requireAdmin: requireAdminRole("admin_super") rejects anyone
// below that tier. The check is always server-side — a route that should
// only be usable by a super admin must use this, not just hide the button
// in the UI.
function requireAdminRole(minRole) {
  return (req, res, next) => {
    if (!roleAtLeast(req.adminRole, minRole)) {
      return next(forbidden(`This action requires ${minRole.replace("admin_", "")}-level access or higher`));
    }
    next();
  };
}

module.exports = { requireAdmin, requireAdminRole };
