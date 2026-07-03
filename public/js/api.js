/* ============================================================================
 * api.js — Thin client for the project REST API (server/server.js).
 * ==========================================================================*/
(function (global) {
  "use strict";

  async function req(method, url, body) {
    const opts = { method, headers: {}, credentials: "same-origin" }; // send the session cookie
    if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const res = await fetch(url, opts);
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || res.statusText); e.status = res.status; throw e; }
    return data;
  }

  global.Api = {
    list: () => req("GET", "/api/projects"),
    get: (id) => req("GET", "/api/projects/" + id),
    create: (name, model) => req("POST", "/api/projects", { name, model }),
    save: (id, { name, model, rev }) => req("PUT", "/api/projects/" + id, { name, model, rev }),
    rename: (id, name) => req("PATCH", "/api/projects/" + id, { name }),
    remove: (id) => req("DELETE", "/api/projects/" + id),
    health: () => req("GET", "/api/health"),
    // auth
    me: () => req("GET", "/api/auth/me"),
    login: (username, password) => req("POST", "/api/auth/login", { username, password }),
    logout: () => req("POST", "/api/auth/logout"),
  };
})(window);
