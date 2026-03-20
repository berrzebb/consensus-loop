#!/usr/bin/env node
/**
 * FVM Validator Tests
 *
 * Tests for fvm-validator.mjs using Node.js built-in test runner.
 * Uses a minimal createServer() mock -- no external dependencies.
 *
 * Run: node --test tests/fvm-validator.test.mjs
 */

import { strict as assert } from "node:assert";
import { describe, it, before, after } from "node:test";
import { createServer } from "node:http";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { pathToFileURL } from "node:url";
const VALIDATOR = pathToFileURL(resolve(__dirname, "..", "scripts", "fvm-validator.mjs")).href;

const {
  parseFvmRows,
  extractCookie,
  classifyStatus,
  classifyFailure,
  substituteDynamicParams,
  executeRow,
  buildAuthTokenMap,
  runFvmValidation,
} = await import(VALIDATOR);

function startMockServer(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        url: "http://127.0.0.1:" + port,
        close: () => new Promise((res) => server.close(res)),
      });
    });
    server.on("error", reject);
  });
}

describe("parseFvmRows", () => {
  const FVM_SAMPLE = [
    "# Feature Visibility Matrix",
    "",
    "### Verification Matrix",
    "",
    "| Route | Page | Feature | Endpoint | Method | Tier Required | Role | Expected Status |",
    "|-------|------|---------|----------|--------|---------------|------|----------------|",
    "| /admin | AdminPage | user-list | /api/admin/users | GET | admin | superadmin | 200 |",
    "| /admin | AdminPage | user-list | /api/admin/users | GET | admin | viewer | 403 |",
    "| /chat | ChatPage | send-msg | /api/chat/send | POST | user | member | 200 |",
    "| /profile | ProfilePage | view | /api/users/:id | GET | user | unauthenticated | 401 |",
    "",
    "### Next Section",
    "done",
  ].join("\n");

  it("parses all rows from Verification Matrix table", () => {
    const rows = parseFvmRows(FVM_SAMPLE);
    assert.equal(rows.length, 4);
  });

  it("normalizes method to uppercase", () => {
    const rows = parseFvmRows(FVM_SAMPLE);
    assert.ok(rows.every((r) => r.method === r.method.toUpperCase()));
  });

  it("normalizes role to lowercase", () => {
    const rows = parseFvmRows(FVM_SAMPLE);
    assert.ok(rows.every((r) => r.role === r.role.toLowerCase()));
  });

  it("parses expected_status as integer", () => {
    const rows = parseFvmRows(FVM_SAMPLE);
    assert.equal(rows[0].expected_status, 200);
    assert.equal(rows[1].expected_status, 403);
    assert.equal(rows[3].expected_status, 401);
  });

  it("stops parsing at next section heading", () => {
    const rows = parseFvmRows(FVM_SAMPLE);
    assert.equal(rows.length, 4);
  });

  it("returns empty array when no matrix found", () => {
    const rows = parseFvmRows("# No matrix here\n\nsome content\n");
    assert.equal(rows.length, 0);
  });
});

describe("extractCookie", () => {
  it("extracts name=value from Set-Cookie header", () => {
    const cookie = extractCookie("session=abc123; Path=/; HttpOnly");
    assert.equal(cookie, "session=abc123");
  });

  it("returns null for null input", () => {
    assert.equal(extractCookie(null), null);
  });

  it("handles cookie without attributes", () => {
    const cookie = extractCookie("token=xyz789");
    assert.equal(cookie, "token=xyz789");
  });
});

describe("classifyStatus", () => {
  it("expected 200: actual 200 -> pass", () => {
    const r = classifyStatus(200, 200);
    assert.equal(r.pass, true);
  });

  it("expected 200: actual 201 -> pass", () => {
    assert.equal(classifyStatus(200, 201).pass, true);
  });

  it("expected 200: actual 404 -> pass (no resource)", () => {
    const r = classifyStatus(200, 404);
    assert.equal(r.pass, true);
    assert.ok(r.note.includes("no resource"));
  });

  it("expected 200: actual 403 -> fail", () => {
    assert.equal(classifyStatus(200, 403).pass, false);
  });

  it("expected 401: actual 401 -> pass", () => {
    assert.equal(classifyStatus(401, 401).pass, true);
  });

  it("expected 401: actual 200 -> fail", () => {
    assert.equal(classifyStatus(401, 200).pass, false);
  });

  it("expected 403: actual 403 -> pass", () => {
    assert.equal(classifyStatus(403, 403).pass, true);
  });

  it("expected 403: actual 401 -> pass (both mean denied)", () => {
    assert.equal(classifyStatus(403, 401).pass, true);
  });

  it("expected 403: actual 200 -> fail", () => {
    assert.equal(classifyStatus(403, 200).pass, false);
  });
});

describe("classifyFailure - AUTH_LEAK", () => {
  it("expected 403, actual 200 -> AUTH_LEAK", () => {
    assert.equal(classifyFailure(403, 200), "AUTH_LEAK");
  });

  it("expected 401, actual 200 -> AUTH_LEAK", () => {
    assert.equal(classifyFailure(401, 200), "AUTH_LEAK");
  });
});

describe("classifyFailure - FALSE_DENY", () => {
  it("expected 200, actual 401 -> FALSE_DENY", () => {
    assert.equal(classifyFailure(200, 401), "FALSE_DENY");
  });

  it("expected 200, actual 403 -> FALSE_DENY", () => {
    assert.equal(classifyFailure(200, 403), "FALSE_DENY");
  });
});

describe("substituteDynamicParams", () => {
  it("replaces :id with placeholder", () => {
    const result = substituteDynamicParams("/api/users/:id");
    assert.ok(!result.includes(":id"));
    assert.ok(result.includes("test-placeholder-id"));
  });

  it("replaces multiple params", () => {
    const result = substituteDynamicParams("/api/orgs/:orgId/users/:userId");
    assert.ok(!result.includes(":orgId"));
    assert.ok(!result.includes(":userId"));
  });

  it("leaves static paths unchanged", () => {
    const path = "/api/admin/users";
    assert.equal(substituteDynamicParams(path), path);
  });
});

describe("executeRow - connection refused", () => {
  it("returns error=CONNECTION_REFUSED on ECONNREFUSED", async () => {
    const row = {
      endpoint: "/api/test",
      method: "GET",
      role: "unauthenticated",
      expected_status: 200,
    };
    const authTokens = { unauthenticated: null };
    const result = await executeRow(row, "http://127.0.0.1:1", authTokens, 2000);
    assert.equal(result.pass, false);
    assert.ok(
      result.error === "CONNECTION_REFUSED" || result.actual_status === 0,
      "Expected CONNECTION_REFUSED or status 0, got: " + result.error
    );
  });
});

describe("executeRow - live mock server", () => {
  let mock;

  before(async () => {
    mock = await startMockServer((req, res) => {
      const url = req.url;
      const cookie = req.headers["cookie"] || "";

      if (url === "/api/public") {
        res.writeHead(200);
        res.end("{}");
        return;
      }
      if (url === "/api/denied") {
        res.writeHead(403);
        res.end("{}");
        return;
      }
      if (url === "/api/admin/users") {
        res.writeHead(cookie.includes("test-token") ? 200 : 401);
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });
  });

  after(async () => {
    if (mock) await mock.close();
  });

  it("passes when expected 200 and server returns 200", async () => {
    const row = { endpoint: "/api/public", method: "GET", role: "unauthenticated", expected_status: 200 };
    const result = await executeRow(row, mock.url, { unauthenticated: null }, 3000);
    assert.equal(result.pass, true);
    assert.equal(result.actual_status, 200);
  });

  it("passes when expected 403 and server returns 403", async () => {
    const row = { endpoint: "/api/denied", method: "GET", role: "unauthenticated", expected_status: 403 };
    const result = await executeRow(row, mock.url, { unauthenticated: null }, 3000);
    assert.equal(result.pass, true);
  });

  it("passes when expected 403 and server returns 401 (both mean denied)", async () => {
    const row = { endpoint: "/api/admin/users", method: "GET", role: "unauthenticated", expected_status: 403 };
    const result = await executeRow(row, mock.url, { unauthenticated: null }, 3000);
    assert.equal(result.pass, true);
  });

  it("sets Cookie header when token present", async () => {
    const row = { endpoint: "/api/admin/users", method: "GET", role: "admin", expected_status: 200 };
    const authTokens = { admin: "session=test-token" };
    const result = await executeRow(row, mock.url, authTokens, 3000);
    assert.equal(result.actual_status, 200);
    assert.equal(result.pass, true);
  });

  it("passes when expected 200 and actual 404 (no resource)", async () => {
    const row = { endpoint: "/api/missing", method: "GET", role: "unauthenticated", expected_status: 200 };
    const result = await executeRow(row, mock.url, { unauthenticated: null }, 3000);
    assert.equal(result.actual_status, 404);
    assert.equal(result.pass, true);
    assert.ok(result.note.includes("no resource"));
  });
});

describe("buildAuthTokenMap", () => {
  let mock;

  before(async () => {
    mock = await startMockServer((req, res) => {
      if (req.url === "/api/auth/login" && req.method === "POST") {
        let body = "";
        req.on("data", (d) => { body += d; });
        req.on("end", () => {
          const { username } = JSON.parse(body);
          if (username === "admin") {
            res.setHeader("Set-Cookie", "session=admin-cookie; Path=/");
            res.writeHead(200);
            res.end("{}");
          } else {
            res.writeHead(401);
            res.end("{}");
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  after(async () => {
    if (mock) await mock.close();
  });

  it("extracts cookie from successful login", async () => {
    const tokens = await buildAuthTokenMap(
      mock.url,
      { admin: { username: "admin", password: "pass" } },
      3000
    );
    assert.equal(tokens["admin"], "session=admin-cookie");
    assert.equal(tokens["unauthenticated"], null);
  });

  it("sets null for failed login", async () => {
    const tokens = await buildAuthTokenMap(
      mock.url,
      { baduser: { username: "baduser", password: "wrong" } },
      3000
    );
    assert.equal(tokens["baduser"], null);
  });

  it("always sets unauthenticated=null", async () => {
    const tokens = await buildAuthTokenMap(mock.url, {}, 3000);
    assert.equal(tokens["unauthenticated"], null);
  });
});

describe("runFvmValidation", () => {
  let mock, tmpDir, fvmFile;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "fvm-int-"));

    mock = await startMockServer((req, res) => {
      const cookie = req.headers["cookie"] || "";
      const isAdmin = cookie.includes("admin-yes");

      if (req.url === "/api/auth/login" && req.method === "POST") {
        let body = "";
        req.on("data", (d) => { body += d; });
        req.on("end", () => {
          const { username } = JSON.parse(body);
          if (username === "admin") {
            res.setHeader("Set-Cookie", "admin-yes=1; Path=/");
            res.writeHead(200);
            res.end("{}");
          } else {
            res.writeHead(401);
            res.end("{}");
          }
        });
        return;
      }
      if (req.url === "/api/admin/stats") {
        res.writeHead(isAdmin ? 200 : 403);
        res.end("{}");
        return;
      }
      if (req.url === "/api/public/info") {
        res.writeHead(200);
        res.end("{}");
        return;
      }
      res.writeHead(404);
      res.end("{}");
    });

    fvmFile = join(tmpDir, "test.fvm.md");
    writeFileSync(fvmFile, [
      "# FVM",
      "",
      "### Verification Matrix",
      "",
      "| Route | Page | Feature | Endpoint | Method | Tier Required | Role | Expected Status |",
      "|-------|------|---------|----------|--------|---------------|------|----------------|",
      "| /admin | Admin | stats | /api/admin/stats | GET | admin | superadmin | 200 |",
      "| /admin | Admin | stats | /api/admin/stats | GET | admin | viewer | 403 |",
      "| /pub | Public | info | /api/public/info | GET | none | unauthenticated | 200 |",
      "",
    ].join("\n"));
  });

  after(async () => {
    if (mock) await mock.close();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns error for missing fvm_path", async () => {
    const r = await runFvmValidation({ fvm_path: "", base_url: "http://x", credentials: {} });
    assert.ok(r.error);
  });

  it("returns error for missing base_url", async () => {
    const r = await runFvmValidation({ fvm_path: fvmFile, base_url: "", credentials: {} });
    assert.ok(r.error);
  });

  it("returns error for non-existent FVM file", async () => {
    const r = await runFvmValidation({ fvm_path: "/nonexistent/file.md", base_url: mock.url, credentials: {} });
    assert.ok(r.error);
    assert.ok(r.error.includes("not found") || r.error.includes("FVM"));
  });

  it("runs full validation and returns structured result", async () => {
    const r = await runFvmValidation({
      fvm_path: fvmFile,
      base_url: mock.url,
      credentials: { superadmin: { username: "admin", password: "pass" } },
      timeout_ms: 3000,
    });
    assert.ok(!r.error, "Expected no error, got: " + r.error);
    assert.ok(typeof r.text === "string");
    assert.ok(r.text.includes("FVM Validation Results"));
    assert.equal(r.json.total, 3);
    assert.ok(typeof r.json.passed === "number");
    assert.ok(typeof r.json.failed === "number");
  });

  it("filter_role limits results to that role", async () => {
    const r = await runFvmValidation({
      fvm_path: fvmFile,
      base_url: mock.url,
      credentials: {},
      filter_role: "unauthenticated",
      timeout_ms: 3000,
    });
    assert.ok(!r.error);
    assert.equal(r.json.total, 1);
  });
});
