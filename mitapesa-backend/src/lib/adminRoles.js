// Three tiers, lowest to highest privilege. Every admin route declares the
// minimum tier it needs; a request from a lower tier is rejected with 403,
// enforced server-side — never assume the frontend hiding a button is
// sufficient, since the API is the actual security boundary.
const ADMIN_ROLES = ["admin_viewer", "admin_support", "admin_super"];

const ROLE_LABELS = {
  admin_viewer: "Viewer — read-only dashboard and summaries, no customer PII",
  admin_support: "Support agent — customer lookup, statements, disputes",
  admin_super: "Super admin — full access including settings, blocking, and role changes",
};

function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}

function roleRank(role) {
  const idx = ADMIN_ROLES.indexOf(role);
  return idx; // -1 for "customer" or anything unrecognized
}

// True if `role` is at least as privileged as `minRole`.
function roleAtLeast(role, minRole) {
  return roleRank(role) >= roleRank(minRole);
}

module.exports = { ADMIN_ROLES, ROLE_LABELS, isAdminRole, roleRank, roleAtLeast };
