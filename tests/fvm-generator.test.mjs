#!/usr/bin/env node
/**
 * FVM Generator Tests
 *
 * Tests for fvm-generator.mjs using Node.js built-in test runner.
 * Run: node --test tests/fvm-generator.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEN = pathToFileURL(resolve(__dirname, "..", "scripts", "fvm-generator.mjs")).href;

const {
  parsePaths,
  parsePolicies,
  mapRoutesToPages,
  extractBeEndpoints,
  normalizeEndpoint,
  generateFvm,
  TIER_ACCESS,
} = await import(GEN);

describe("parsePaths", () => {
  it("extracts PATHS key-value pairs from project root", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const paths = parsePaths(root);
    assert.ok(Object.keys(paths).length > 0, "Should find at least one path");
    assert.equal(paths.LOGIN, "/login");
    assert.equal(paths.ROOT, "/");
    assert.equal(paths.ADMIN, "/admin");
  });

  it("returns empty object for nonexistent project", () => {
    const paths = parsePaths("/nonexistent/project");
    assert.deepEqual(paths, {});
  });
});

describe("parsePolicies", () => {
  it("extracts PAGE_POLICIES from project root", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const policies = parsePolicies(root);
    assert.ok(policies.length > 0, "Should find at least one policy");

    const login = policies.find(p => p.path === "/login");
    assert.ok(login, "Should find /login policy");
    assert.equal(login.view, "public");
    assert.equal(login.manage, "public");

    const admin = policies.find(p => p.path === "/admin");
    assert.ok(admin, "Should find /admin policy");
    assert.equal(admin.view, "superadmin");
    assert.equal(admin.manage, "superadmin");
  });

  it("captures view and manage tiers separately", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const policies = parsePolicies(root);

    const settings = policies.find(p => p.path === "/settings");
    assert.ok(settings, "Should find /settings policy");
    assert.equal(settings.view, "authenticated");
    assert.equal(settings.manage, "team_owner");
  });
});

describe("mapRoutesToPages", () => {
  it("maps PATHS keys to page component files", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const routeMap = mapRoutesToPages(root);
    assert.ok(Object.keys(routeMap).length > 0, "Should find at least one route");
    assert.ok(routeMap.ADMIN, "Should find ADMIN route");
    assert.ok(routeMap.CHAT, "Should find CHAT route");
  });
});

describe("extractBeEndpoints", () => {
  it("extracts endpoints from BE handler JSDoc headers", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const endpoints = extractBeEndpoints(root);
    assert.ok(endpoints.length > 0, "Should find at least one endpoint");

    const adminUsers = endpoints.find(e => e.path === "/api/admin/users" && e.method === "GET");
    assert.ok(adminUsers, "Should find GET /api/admin/users");
    assert.ok(adminUsers.handler, "Should have handler file name");
  });
});

describe("normalizeEndpoint", () => {
  it("converts template literal expressions to :param", () => {
    assert.equal(normalizeEndpoint("/api/teams/${team_id}"), "/api/teams/:param");
  });

  it("converts multiple template expressions", () => {
    assert.equal(
      normalizeEndpoint("/api/teams/${team_id}/members/${user_id}"),
      "/api/teams/:param/members/:param"
    );
  });

  it("leaves static paths unchanged", () => {
    assert.equal(normalizeEndpoint("/api/admin/users"), "/api/admin/users");
  });
});

describe("TIER_ACCESS", () => {
  it("public tier allows all roles", () => {
    assert.equal(TIER_ACCESS.public.size, 6);
    assert.ok(TIER_ACCESS.public.has("unauthenticated"));
  });

  it("authenticated tier excludes unauthenticated", () => {
    assert.ok(!TIER_ACCESS.authenticated.has("unauthenticated"));
    assert.ok(TIER_ACCESS.authenticated.has("viewer"));
  });

  it("team_manager tier allows manager, owner, superadmin", () => {
    assert.ok(TIER_ACCESS.team_manager.has("manager"));
    assert.ok(TIER_ACCESS.team_manager.has("owner"));
    assert.ok(TIER_ACCESS.team_manager.has("superadmin"));
    assert.ok(!TIER_ACCESS.team_manager.has("member"));
    assert.ok(!TIER_ACCESS.team_manager.has("viewer"));
  });

  it("superadmin tier only allows superadmin", () => {
    assert.equal(TIER_ACCESS.superadmin.size, 1);
    assert.ok(TIER_ACCESS.superadmin.has("superadmin"));
  });
});

describe("generateFvm", () => {
  it("generates FVM for the actual project", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const result = generateFvm(root);
    assert.ok(!result.error, "Should not error: " + result.error);
    assert.ok(result.text.includes("FVM"), "Output should contain FVM header");
    assert.ok(result.json.routes > 0, "Should have routes");
    assert.ok(result.json.fvm_rows > 0, "Should have FVM rows");
    assert.ok(result.summary.includes("routes"), "Summary should mention routes");
  });

  it("returns error for invalid project root", () => {
    const result = generateFvm("/nonexistent/project");
    assert.ok(result.error, "Should return an error");
  });

  it("supports mismatches format", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const result = generateFvm(root, "mismatches");
    assert.ok(!result.error);
    assert.ok(result.text.includes("Mismatch"), "Should contain mismatches section");
  });

  it("supports matrix format", () => {
    const root = resolve(__dirname, "..", "..", "..", "..");
    const result = generateFvm(root, "matrix");
    assert.ok(!result.error);
    assert.ok(result.text.includes("Route"), "Should contain table headers");
    assert.ok(result.text.includes("|"), "Should be a markdown table");
  });
});
