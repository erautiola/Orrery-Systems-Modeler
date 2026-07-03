/* ============================================================================
 * permissions.js — Pure authorization policy (dual-environment: browser + Node).
 *
 * Global roles live on the user ("admin" | "user"). Per-project roles come from
 * the project record: the owner (project.ownerId) plus project.members
 * ([{userId, role}]) with role "editor" | "viewer".
 *
 * The SERVER enforces these; the browser also consults them to hide/disable
 * actions the user can't perform. Never trust the client — the server re-checks.
 * ==========================================================================*/
(function (root) {
  "use strict";

  const PROJECT_ROLES = ["owner", "editor", "viewer"]; // owner via ownerId; others via members

  // the caller's effective role on a project: owner | editor | viewer | null
  function projectRole(user, project) {
    if (!user || !project) return null;
    if (project.ownerId && project.ownerId === user.id) return "owner";
    const m = (project.members || []).find((x) => x.userId === user.id);
    return m ? m.role : null;
  }

  // can `user` perform `action` on `project`? actions: read | write | manage.
  function can(user, action, project) {
    if (!user) return false;
    if (user.role === "admin") return true; // global admin: full access
    const role = projectRole(user, project);
    if (role === null) {
      // unowned/legacy project (no ownerId): shared — any signed-in user may
      // read and write it; only an admin may manage (handled above).
      if (project && project.ownerId == null) return action === "read" || action === "write";
      return false;
    }
    if (action === "read") return true;                              // any project role
    if (action === "write") return role === "owner" || role === "editor";
    if (action === "manage") return role === "owner";               // rename / delete / share
    return false;
  }

  const api = { PROJECT_ROLES, projectRole, can };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Permissions = api;
})(typeof window !== "undefined" ? window : null);
