/**
 * FVM Validator -- Execute FVM rows against a live server.
 *
 * Zero external dependencies -- uses Node.js built-in fetch (Node 18+).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DYNAMIC_PARAM_PLACEHOLDER = "test-placeholder-id";
const REQUEST_DELAY_MS = 100;
const DEFAULT_TIMEOUT_MS = 5000;

export function parseFvmRows(content) {
  const rows = [];
  const lines = content.split(/\r?\n/);
  let inMatrix = false;
  let headerCols = [];

  for (const line of lines) {
    if (/^###\s+Verification\s+Matrix/i.test(line.trim())) {
      inMatrix = true;
      continue;
    }
    if (inMatrix && /^#{1,3}\s+/.test(line.trim()) && !/Verification\s+Matrix/i.test(line)) {
      break;
    }
    if (!inMatrix) continue;
    if (!line.startsWith("|")) continue;

    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, a) => i > 0 && i < a.length);

    if (headerCols.length === 0 && cells.some((c) => /Route|Endpoint|Method|Role/i.test(c))) {
      headerCols = cells.map((c) =>
        c.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
      );
      continue;
    }
    if (cells.every((c) => c === "" || /^[-:]+$/.test(c))) continue;
    if (headerCols.length === 0) continue;

    const row = {};
    for (let i = 0; i < headerCols.length && i < cells.length; i++) {
      row[headerCols[i]] = cells[i];
    }
    const rawExpected = row.expected_status || row.expected || "";
    const parsed = parseInt(rawExpected, 10);
    row.expected_status = isNaN(parsed) ? 200 : parsed;
    row.method = (row.method || "GET").toUpperCase();
    row.role = (row.role || "unauthenticated").toLowerCase().replace(/\s+/g, "_");
    rows.push(row);
  }
  return rows;
}

export function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  const firstPart = setCookieHeader.split(";")[0].trim();
  return firstPart || null;
}

export async function buildAuthTokenMap(baseUrl, credentials, timeoutMs) {
  const tokens = {};
  for (const [role, creds] of Object.entries(credentials)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(baseUrl + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: creds.username, password: creds.password }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const setCookie = res.headers.get("set-cookie");
      tokens[role] = extractCookie(setCookie);
    } catch (_err) {
      tokens[role] = null;
    }
  }
  tokens["unauthenticated"] = null;
  return tokens;
}

export function classifyStatus(expected, actual) {
  if (expected === 200) {
    if (actual >= 200 && actual < 300) return { pass: true, note: "pass" };
    if (actual === 404) return { pass: true, note: "pass (no resource)" };
    return { pass: false, note: "fail" };
  }
  if (expected === 401) {
    return actual === 401
      ? { pass: true, note: "pass" }
      : { pass: false, note: "fail" };
  }
  if (expected === 403) {
    return actual === 403 || actual === 401
      ? { pass: true, note: "pass" }
      : { pass: false, note: "fail" };
  }
  return actual === expected
    ? { pass: true, note: "pass" }
    : { pass: false, note: "fail" };
}

export function classifyFailure(expected, actual) {
  if ((expected === 403 || expected === 401) && actual >= 200 && actual < 300) {
    return "AUTH_LEAK";
  }
  if (expected === 200 && (actual === 401 || actual === 403)) {
    return "FALSE_DENY";
  }
  if (expected === 200 && actual === 404) {
    return "ENDPOINT_MISSING";
  }
  if (actual === 400 || actual === 422) {
    return "PARAM_ERROR";
  }
  return "UNKNOWN";
}

export function substituteDynamicParams(endpoint) {
  return endpoint.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, DYNAMIC_PARAM_PLACEHOLDER);
}

export async function executeRow(row, baseUrl, authTokens, timeoutMs) {
  const endpoint = substituteDynamicParams(row.api_endpoint || row.endpoint || "/");
  const method = row.method || "GET";
  const role = row.role || "unauthenticated";
  const cookie = authTokens[role] ?? null;
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Cookie"] = cookie;

  let actual_status;
  let error = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(baseUrl + endpoint, { method, headers, signal: controller.signal });
    clearTimeout(timer);
    actual_status = res.status;
  } catch (err) {
    if (err.name === "AbortError") {
      error = "TIMEOUT";
      actual_status = 0;
    } else if (err.cause?.code === "ECONNREFUSED" || (err.message && err.message.includes("ECONNREFUSED"))) {
      error = "CONNECTION_REFUSED";
      actual_status = 0;
    } else {
      error = err.message || "UNKNOWN_ERROR";
      actual_status = 0;
    }
  }

  const expected = row.expected_status;
  const { pass, note } = error
    ? { pass: false, note: error }
    : classifyStatus(expected, actual_status);

  const verdict = pass ? note : (error || classifyFailure(expected, actual_status));
  return { ...row, actual_status, pass, note, verdict, error };
}

export function formatResults(results, baseUrl) {
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const timestamp = new Date().toISOString();

  const lines = [];
  lines.push("## FVM Validation Results\n");
  lines.push("Base URL: " + baseUrl);
  lines.push("Validated: " + timestamp);
  lines.push("Total: " + total + " rows, " + passed + " passed, " + failed + " failed\n");

  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    lines.push("### Failures\n");
    lines.push("| Route | Feature | Endpoint | Method | Role | Expected | Actual | Verdict |");
    lines.push("|-------|---------|----------|--------|------|----------|--------|---------|");
    for (const r of failures) {
      const route = r.route || r.page || "-";
      const feature = r.feature || "-";
      const ep = r.endpoint || "-";
      const method = r.method || "-";
      const role = r.role || "-";
      const expected = r.expected_status != null ? r.expected_status : "-";
      const actual = r.actual_status != null ? r.actual_status : "-";
      const verdict = r.verdict || "-";
      lines.push("| " + route + " | " + feature + " | " + ep + " | " + method + " | " + role + " | " + expected + " | " + actual + " | " + verdict + " |");
    }
    lines.push("");
    lines.push("### Failure Classification");
    lines.push("- AUTH_LEAK: Role should be denied but got access (security issue)");
    lines.push("- FALSE_DENY: Role should have access but was denied (bug)");
    lines.push("- ENDPOINT_MISSING: Got 404 when endpoint should exist");
    lines.push("- PARAM_ERROR: Got 400/422 suggesting wrong request format");
    lines.push("");
  } else {
    lines.push("### Failures\n");
    lines.push("None - all rows passed.\n");
  }

  lines.push("### Full Matrix\n");
  lines.push("| Route | Feature | Endpoint | Method | Role | Expected | Actual | Pass |");
  lines.push("|-------|---------|----------|--------|------|----------|--------|------|");
  for (const r of results) {
    const route = r.route || r.page || "-";
    const feature = r.feature || "-";
    const ep = r.endpoint || "-";
    const method = r.method || "-";
    const role = r.role || "-";
    const expected = r.expected_status != null ? r.expected_status : "-";
    const actual = r.actual_status != null ? r.actual_status : "-";
    const passCell = r.pass ? "PASS (" + r.note + ")" : "FAIL (" + r.verdict + ")";
    lines.push("| " + route + " | " + feature + " | " + ep + " | " + method + " | " + role + " | " + expected + " | " + actual + " | " + passCell + " |");
  }
  return lines.join("\n");
}

export async function runFvmValidation(params) {
  const {
    fvm_path,
    base_url,
    credentials = {},
    filter_role,
    filter_route,
    timeout_ms = DEFAULT_TIMEOUT_MS,
  } = params;

  if (!fvm_path) return { error: "fvm_path is required" };
  if (!base_url) return { error: "base_url is required" };

  const fullPath = resolve(fvm_path);
  let content;
  try {
    content = readFileSync(fullPath, "utf8");
  } catch (_err) {
    return { error: "FVM file not found: " + fvm_path };
  }

  let rows = parseFvmRows(content);
  if (rows.length === 0) {
    return { error: "No rows found in FVM Verification Matrix table" };
  }

  if (filter_role) {
    rows = rows.filter((r) => r.role === filter_role.toLowerCase());
  }
  if (filter_route) {
    rows = rows.filter((r) =>
      (r.route || r.page || "").toLowerCase().includes(filter_route.toLowerCase())
    );
  }

  if (rows.length === 0) {
    return {
      text: "No rows matched the filter criteria.",
      summary: "0 rows",
      json: { total: 0, passed: 0, failed: 0, results: [] },
    };
  }

  let authTokens;
  try {
    authTokens = await buildAuthTokenMap(base_url, credentials, timeout_ms);
  } catch (err) {
    return { error: "Auth setup failed: " + err.message };
  }

  const results = [];
  for (let i = 0; i < rows.length; i++) {
    const result = await executeRow(rows[i], base_url, authTokens, timeout_ms);
    results.push(result);
    if (i < rows.length - 1) {
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }
  }

  const text = formatResults(results, base_url);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const failed = total - passed;
  const failure_types = {};
  for (const r of results.filter((r) => !r.pass)) {
    const v = r.verdict || "UNKNOWN";
    failure_types[v] = (failure_types[v] || 0) + 1;
  }

  return {
    text,
    summary: total + " rows, " + passed + " passed, " + failed + " failed",
    json: { total, passed, failed, failure_types, results },
  };
}
