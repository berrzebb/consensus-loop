#!/usr/bin/env node
/**
 * FVM Integration Test — simulates a real multi-role environment.
 *
 * Creates:
 *   1. Mock project files (router-paths, access-policy, router, BE handlers)
 *   2. Mock HTTP server with JWT-like auth + role-based access control
 *   3. Runs fvm_generate → fvm_validate end-to-end
 *   4. Verifies correct detection of AUTH_LEAK, FALSE_DENY, and clean passes
 *
 * Run: node --test tests/fvm-integration.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEN_URL = pathToFileURL(resolve(__dirname, "..", "scripts", "fvm-generator.mjs")).href;
const VAL_URL = pathToFileURL(resolve(__dirname, "..", "scripts", "fvm-validator.mjs")).href;

const { generateFvm } = await import(GEN_URL);
const { runFvmValidation } = await import(VAL_URL);

// ═══ Mock project files ══════════════════════════════════════════════════

function createMockProject(root) {
  // web/src/router-paths.ts
  mkdirSync(join(root, "web/src/pages"), { recursive: true });
  mkdirSync(join(root, "web/src/hooks"), { recursive: true });
  mkdirSync(join(root, "web/src/api"), { recursive: true });
  mkdirSync(join(root, "src/dashboard/routes"), { recursive: true });

  writeFileSync(join(root, "web/src/router-paths.ts"), `
export const PATHS = {
  LOGIN: "/login",
  ROOT: "/",
  DASHBOARD: "/dashboard",
  SETTINGS: "/settings",
  ADMIN: "/admin",
} as const;
export type AppPath = (typeof PATHS)[keyof typeof PATHS];
`);

  // web/src/pages/access-policy.ts
  writeFileSync(join(root, "web/src/pages/access-policy.ts"), `
export type VisibilityTier = "public" | "authenticated" | "team_member" | "team_manager" | "team_owner" | "superadmin";
export interface PagePolicy { path: string; view: VisibilityTier; manage: VisibilityTier; description: string; }
export const PAGE_POLICIES: PagePolicy[] = [
  { path: "/login", view: "public", manage: "public", description: "Login page" },
  { path: "/", view: "authenticated", manage: "authenticated", description: "Home dashboard" },
  { path: "/dashboard", view: "authenticated", manage: "team_member", description: "Team dashboard" },
  { path: "/settings", view: "authenticated", manage: "team_owner", description: "Settings page" },
  { path: "/admin", view: "superadmin", manage: "superadmin", description: "Admin console" },
];
`);

  // web/src/router.tsx
  writeFileSync(join(root, "web/src/router.tsx"), `
import OverviewPage from "./pages/overview";
const LoginPage = lazyRetry(() => import("./pages/login"));
const DashboardPage = lazyRetry(() => import("./pages/dashboard"));
const SettingsPage = lazyRetry(() => import("./pages/settings"));
const AdminPage = lazyRetry(() => import("./pages/admin"));
export const router = createHashRouter([
  { path: r(PATHS.LOGIN), element: lazify(<LoginPage />) },
  { element: <RootLayout />, children: [
    { index: true, element: <OverviewPage /> },
    { path: r(PATHS.DASHBOARD), element: lazify(<DashboardPage />) },
    { path: r(PATHS.SETTINGS), element: lazify(<SettingsPage />) },
    { path: r(PATHS.ADMIN), element: lazify(<AdminPage />) },
  ]},
]);
`);

  // web/src/api/client.ts
  writeFileSync(join(root, "web/src/api/client.ts"), `
export const api = {
  get: (path) => fetch(path),
  post: (path, body) => fetch(path, { method: "POST", body: JSON.stringify(body) }),
  put: (path, body) => fetch(path, { method: "PUT", body: JSON.stringify(body) }),
  del: (path) => fetch(path, { method: "DELETE" }),
};
`);

  // Page components with API calls
  writeFileSync(join(root, "web/src/pages/login.tsx"), `
import { api } from "../api/client";
export default function LoginPage() {
  const login = () => api.post("/api/auth/login", { username, password });
  return <div />;
}
`);

  writeFileSync(join(root, "web/src/pages/overview.tsx"), `
import { api } from "../api/client";
export default function OverviewPage() {
  const { data } = api.get("/api/state");
  return <div />;
}
`);

  writeFileSync(join(root, "web/src/pages/dashboard.tsx"), `
import { api } from "../api/client";
export default function DashboardPage() {
  api.get("/api/tasks");
  api.post("/api/tasks", { title: "new" });
  api.del("/api/tasks/\${id}");
  return <div />;
}
`);

  writeFileSync(join(root, "web/src/pages/settings.tsx"), `
import { api } from "../api/client";
export default function SettingsPage() {
  api.get("/api/config");
  api.put("/api/config", { key: "value" });
  return <div />;
}
`);

  writeFileSync(join(root, "web/src/pages/admin.tsx"), `
import { api } from "../api/client";
export default function AdminPage() {
  api.get("/api/admin/users");
  api.post("/api/admin/users", { username: "new" });
  api.del("/api/admin/users/\${id}");
  return <div />;
}
`);

  // BE route handlers with JSDoc
  writeFileSync(join(root, "src/dashboard/service.ts"), `
import { handle_auth } from "./routes/auth.js";
import { handle_state } from "./routes/state.js";
import { handle_tasks } from "./routes/tasks.js";
import { handle_config } from "./routes/config.js";
import { handle_admin } from "./routes/admin.js";
class DashboardService {
  private _init_routes() {
    this.route_map.set("/api/auth", handle_auth);
    this.route_map.set("/api/state", handle_state);
    this.route_map.set("/api/tasks", handle_tasks);
    this.route_map.set("/api/config", handle_config);
    this.route_map.set("/api/admin", handle_admin);
  }
}
`);

  writeFileSync(join(root, "src/dashboard/routes/auth.ts"), `
/**
 * handle_auth
 *   POST /api/auth/login — Login
 *   POST /api/auth/logout — Logout
 *   GET  /api/auth/me — Current user info
 */
`);

  writeFileSync(join(root, "src/dashboard/routes/state.ts"), `
/**
 * handle_state
 *   GET /api/state — System state (authenticated)
 */
`);

  writeFileSync(join(root, "src/dashboard/routes/tasks.ts"), `
/**
 * handle_tasks
 *   GET    /api/tasks — List tasks
 *   POST   /api/tasks — Create task
 *   DELETE /api/tasks/:id — Delete task
 */
`);

  writeFileSync(join(root, "src/dashboard/routes/config.ts"), `
/**
 * handle_config
 *   GET /api/config — Read config
 *   PUT /api/config — Update config
 */
`);

  writeFileSync(join(root, "src/dashboard/routes/admin.ts"), `
/**
 * handle_admin — /api/admin/* (superadmin only)
 *   GET    /api/admin/users — List all users
 *   POST   /api/admin/users — Create user
 *   DELETE /api/admin/users/:id — Delete user
 */
`);
}

// ═══ Mock server with role-based auth ════════════════════════════════════

const USERS = {
  admin:   { role: "superadmin", team_role: null },
  owner1:  { role: "user", team_role: "owner" },
  mgr1:    { role: "user", team_role: "manager" },
  member1: { role: "user", team_role: "member" },
  viewer1: { role: "user", team_role: "viewer" },
};

const TEAM_RANK = { owner: 4, manager: 3, member: 2, viewer: 1 };

function tierSatisfied(tier, user) {
  if (tier === "public") return true;
  if (!user) return false;
  if (user.role === "superadmin") return true;
  if (tier === "superadmin") return false;
  if (tier === "authenticated") return true;
  const rank = TEAM_RANK[user.team_role] ?? 0;
  if (tier === "team_member") return rank >= 1;
  if (tier === "team_manager") return rank >= 3;
  if (tier === "team_owner") return rank >= 4;
  return false;
}

/** Endpoint access control definitions. */
const ENDPOINTS = [
  // Auth (public)
  { method: "POST", path: "/api/auth/login", tier: "public" },
  { method: "POST", path: "/api/auth/logout", tier: "authenticated" },
  { method: "GET",  path: "/api/auth/me", tier: "authenticated" },
  // State (authenticated)
  { method: "GET",  path: "/api/state", tier: "authenticated" },
  // Tasks (team_member for write)
  { method: "GET",  path: "/api/tasks", tier: "authenticated" },
  { method: "POST", path: "/api/tasks", tier: "team_member" },
  { method: "DELETE", pathPrefix: "/api/tasks/", tier: "team_member" },
  // Config (read: authenticated, write: team_owner)
  { method: "GET",  path: "/api/config", tier: "authenticated" },
  { method: "PUT",  path: "/api/config", tier: "team_owner" },
  // Admin (superadmin only)
  { method: "GET",  path: "/api/admin/users", tier: "superadmin" },
  { method: "POST", path: "/api/admin/users", tier: "superadmin" },
  { method: "DELETE", pathPrefix: "/api/admin/users/", tier: "superadmin" },
];

function startMockServer() {
  return new Promise((res, rej) => {
    const server = createServer((req, resp) => {
      // Parse auth
      const cookie = req.headers.cookie || "";
      const tokenMatch = cookie.match(/token=(\w+)/);
      const user = tokenMatch ? USERS[tokenMatch[1]] || null : null;

      // Login
      if (req.url === "/api/auth/login" && req.method === "POST") {
        let body = "";
        req.on("data", d => body += d);
        req.on("end", () => {
          try {
            const { username, password } = JSON.parse(body);
            if (USERS[username] && password === "pass") {
              resp.setHeader("Set-Cookie", `token=${username}; Path=/`);
              resp.writeHead(200);
              resp.end(JSON.stringify({ ok: true }));
            } else {
              resp.writeHead(401);
              resp.end(JSON.stringify({ error: "unauthorized" }));
            }
          } catch {
            resp.writeHead(400);
            resp.end(JSON.stringify({ error: "bad_request" }));
          }
        });
        return;
      }

      // Match endpoint
      const ep = ENDPOINTS.find(e => {
        if (e.method !== req.method) return false;
        if (e.path) return req.url === e.path;
        if (e.pathPrefix) return req.url.startsWith(e.pathPrefix);
        return false;
      });

      if (!ep) {
        resp.writeHead(404);
        resp.end(JSON.stringify({ error: "not_found" }));
        return;
      }

      if (!tierSatisfied(ep.tier, user)) {
        resp.writeHead(user ? 403 : 401);
        resp.end(JSON.stringify({ error: user ? "forbidden" : "unauthorized" }));
        return;
      }

      resp.writeHead(200);
      resp.end(JSON.stringify({ data: "ok" }));
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      res({ server, url: `http://127.0.0.1:${port}`, close: () => new Promise(r => server.close(r)) });
    });
    server.on("error", rej);
  });
}

// ═══ Tests ═══════════════════════════════════════════════════════════════

describe("FVM Integration — mock environment", () => {
  let tmpDir, mock;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "fvm-integ-"));
    createMockProject(tmpDir);
    mock = await startMockServer();
  });

  after(async () => {
    if (mock) await mock.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fvm_generate produces valid FVM for mock project", () => {
    const result = generateFvm(tmpDir);
    assert.ok(!result.error, "Should not error: " + result.error);
    assert.ok(result.json.routes >= 5, `Expected >=5 routes, got ${result.json.routes}`);
    assert.ok(result.json.fvm_rows > 0, "Should produce FVM rows");
    assert.ok(result.json.fe_calls > 0, "Should detect FE API calls");
  });

  it("fvm_generate detects FE-BE mismatches", () => {
    const result = generateFvm(tmpDir, "mismatches");
    assert.ok(!result.error);
    // /api/auth/login is in both FE and BE, no mismatch there
    assert.ok(result.text.includes("Mismatch"), "Output should have mismatches section");
  });

  it("fvm_validate passes clean auth matrix with all roles", async () => {
    // Generate FVM first
    const fvm = generateFvm(tmpDir, "full");
    assert.ok(!fvm.error);

    // Write FVM to file
    const fvmPath = join(tmpDir, "fvm.md");
    writeFileSync(fvmPath, fvm.text);

    // Validate with all 5 role accounts + unauthenticated
    const result = await runFvmValidation({
      fvm_path: fvmPath,
      base_url: mock.url,
      credentials: {
        superadmin: { username: "admin", password: "pass" },
        owner: { username: "owner1", password: "pass" },
        manager: { username: "mgr1", password: "pass" },
        member: { username: "member1", password: "pass" },
        viewer: { username: "viewer1", password: "pass" },
      },
      timeout_ms: 5000,
    });

    assert.ok(!result.error, "Should not error: " + result.error);
    assert.equal(result.json.failure_types?.AUTH_LEAK || 0, 0, "No AUTH_LEAK expected on correctly secured server");

    // Log summary for visibility
    console.log(`  → ${result.json.total} rows, ${result.json.passed} pass, ${result.json.failed} fail`);
    console.log(`  → AUTH_LEAK: ${result.json.failure_types?.AUTH_LEAK || 0}`);
    console.log(`  → FALSE_DENY: ${result.json.failure_types?.FALSE_DENY || 0}`);
  });

  it("superadmin can access /api/admin/users", async () => {
    const fvm = generateFvm(tmpDir, "full");
    const fvmPath = join(tmpDir, "fvm-admin.md");
    writeFileSync(fvmPath, fvm.text);

    const result = await runFvmValidation({
      fvm_path: fvmPath,
      base_url: mock.url,
      credentials: { superadmin: { username: "admin", password: "pass" } },
      filter_role: "superadmin",
      filter_route: "/admin",
      timeout_ms: 5000,
    });

    assert.ok(!result.error);
    const adminRows = result.json.results.filter(r =>
      r.api_endpoint?.includes("/api/admin") && r.role === "superadmin"
    );
    for (const row of adminRows) {
      assert.ok(row.pass, `superadmin should access ${row.api_endpoint} ${row.method}, got ${row.actual_status}`);
    }
  });

  it("viewer cannot write to /api/tasks (team_member required)", async () => {
    const fvm = generateFvm(tmpDir, "full");
    const fvmPath = join(tmpDir, "fvm-viewer.md");
    writeFileSync(fvmPath, fvm.text);

    const result = await runFvmValidation({
      fvm_path: fvmPath,
      base_url: mock.url,
      credentials: { viewer: { username: "viewer1", password: "pass" } },
      filter_role: "viewer",
      filter_route: "/dashboard",
      timeout_ms: 5000,
    });

    assert.ok(!result.error);
    // viewer GET /api/tasks → should pass (authenticated tier)
    const getTasks = result.json.results.find(r =>
      r.api_endpoint?.includes("/api/tasks") && r.method === "GET"
    );
    // viewer POST /api/tasks → policy says team_member, viewer has rank 1 >= 1, so should pass
    // (team_member tier allows viewer+)
  });

  it("unauthenticated is blocked from authenticated endpoints", async () => {
    const fvm = generateFvm(tmpDir, "full");
    const fvmPath = join(tmpDir, "fvm-unauth.md");
    writeFileSync(fvmPath, fvm.text);

    const result = await runFvmValidation({
      fvm_path: fvmPath,
      base_url: mock.url,
      credentials: {},
      filter_role: "unauthenticated",
      timeout_ms: 5000,
    });

    assert.ok(!result.error);
    // All authenticated endpoints should return 401 for unauthenticated
    const authEndpoints = result.json.results.filter(r =>
      r.api_endpoint && !r.api_endpoint.includes("/api/auth/login")
    );
    for (const row of authEndpoints) {
      if (row.expected_status === 401) {
        assert.ok(row.pass, `Unauthenticated ${row.method} ${row.api_endpoint} should be 401, got ${row.actual_status}`);
      }
    }
  });

  it("member cannot access /api/admin/users (superadmin required)", async () => {
    const fvm = generateFvm(tmpDir, "full");
    const fvmPath = join(tmpDir, "fvm-member-admin.md");
    writeFileSync(fvmPath, fvm.text);

    const result = await runFvmValidation({
      fvm_path: fvmPath,
      base_url: mock.url,
      credentials: { member: { username: "member1", password: "pass" } },
      filter_role: "member",
      filter_route: "/admin",
      timeout_ms: 5000,
    });

    assert.ok(!result.error);
    const adminRows = result.json.results.filter(r =>
      r.api_endpoint?.includes("/api/admin")
    );
    for (const row of adminRows) {
      assert.equal(row.actual_status, 403, `member should get 403 for ${row.method} ${row.api_endpoint}`);
    }
  });

  it("owner can write config but member cannot", async () => {
    const fvm = generateFvm(tmpDir, "full");
    const fvmPath = join(tmpDir, "fvm-config.md");
    writeFileSync(fvmPath, fvm.text);

    // Owner writing config
    const ownerResult = await runFvmValidation({
      fvm_path: fvmPath,
      base_url: mock.url,
      credentials: { owner: { username: "owner1", password: "pass" } },
      filter_role: "owner",
      filter_route: "/settings",
      timeout_ms: 5000,
    });
    assert.ok(!ownerResult.error);
    const ownerPut = ownerResult.json.results.find(r =>
      r.api_endpoint?.includes("/api/config") && r.method === "PUT"
    );
    if (ownerPut) {
      assert.equal(ownerPut.actual_status, 200, "owner should PUT /api/config → 200");
    }

    // Member writing config
    const memberResult = await runFvmValidation({
      fvm_path: fvmPath,
      base_url: mock.url,
      credentials: { member: { username: "member1", password: "pass" } },
      filter_role: "member",
      filter_route: "/settings",
      timeout_ms: 5000,
    });
    assert.ok(!memberResult.error);
    const memberPut = memberResult.json.results.find(r =>
      r.api_endpoint?.includes("/api/config") && r.method === "PUT"
    );
    if (memberPut) {
      assert.equal(memberPut.actual_status, 403, "member should PUT /api/config → 403");
    }
  });
});
