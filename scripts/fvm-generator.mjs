#!/usr/bin/env node
/**
 * fvm-generator.mjs — Functional Verification Matrix generator.
 *
 * Static analysis: cross-references FE routes, API calls, BE endpoints,
 * and access policies to produce an FVM table for HTTP-level validation.
 *
 * Usage (standalone):
 *   node fvm-generator.mjs <project-root>
 *   node fvm-generator.mjs <project-root> --format mismatches
 *
 * Also callable via MCP server (fvm_generate tool).
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, relative, dirname, extname, join } from "node:path";

// ═══ Constants ═══════════════════════════════════════════════════════════

const ROLES = ["superadmin", "owner", "manager", "member", "viewer", "unauthenticated"];

/** Which roles satisfy each visibility tier. */
const TIER_ACCESS = {
  public:        new Set(ROLES),
  authenticated: new Set(["superadmin", "owner", "manager", "member", "viewer"]),
  team_member:   new Set(["superadmin", "owner", "manager", "member", "viewer"]),
  team_manager:  new Set(["superadmin", "owner", "manager"]),
  team_owner:    new Set(["superadmin", "owner"]),
  superadmin:    new Set(["superadmin"]),
};

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// ═══ Step 1: Parse FE route paths ════════════════════════════════════════

function parsePaths(projectRoot) {
  const file = resolve(projectRoot, "web/src/router-paths.ts");
  if (!existsSync(file)) return {};
  const content = readFileSync(file, "utf8");
  const paths = {};
  const re = /(\w+)\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    paths[m[1]] = m[2];
  }
  return paths;
}

// ═══ Step 2: Parse access policies ═══════════════════════════════════════

function parsePolicies(projectRoot) {
  const file = resolve(projectRoot, "web/src/pages/access-policy.ts");
  if (!existsSync(file)) return [];
  const content = readFileSync(file, "utf8");
  const policies = [];
  const re = /\{\s*\n?\s*path:\s*["']([^"']+)["']\s*,\s*\n?\s*view:\s*["'](\w+)["']\s*,\s*\n?\s*manage:\s*["'](\w+)["']\s*,\s*\n?\s*description:\s*["']([^"']*?)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    policies.push({ path: m[1], view: m[2], manage: m[3], description: m[4] });
  }
  return policies;
}

// ═══ Step 3: Map routes to page component files ══════════════════════════

function mapRoutesToPages(projectRoot) {
  const file = resolve(projectRoot, "web/src/router.tsx");
  if (!existsSync(file)) return {};
  const content = readFileSync(file, "utf8");

  // Collect lazy + static imports → component name → relative page path
  const compToPage = {};
  const lazyRe = /const\s+(\w+)\s*=\s*lazyRetry\(\(\)\s*=>\s*import\(["']\.\/pages\/([^"']+)["']\)\)/g;
  let m;
  while ((m = lazyRe.exec(content)) !== null) compToPage[m[1]] = m[2];

  const staticRe = /import\s+(\w+)\s+from\s+["']\.\/pages\/([^"']+)["']/g;
  while ((m = staticRe.exec(content)) !== null) compToPage[m[1]] = m[2];

  // Map PATHS key → page file (relative to web/src/pages/)
  const routeMap = {};

  // Named routes: path: r(PATHS.XXX), element: lazify(<XxxPage />)
  const routeRe = /path:\s*r\(PATHS\.(\w+)\)\s*,\s*element:\s*(?:lazify\()?<(\w+)/g;
  while ((m = routeRe.exec(content)) !== null) {
    if (compToPage[m[2]]) routeMap[m[1]] = compToPage[m[2]];
  }

  // Index route: { index: true, element: <OverviewPage /> }
  const indexRe = /index:\s*true\s*,\s*element:\s*(?:lazify\()?<(\w+)/;
  const im = content.match(indexRe);
  if (im && compToPage[im[1]]) routeMap["ROOT"] = compToPage[im[1]];

  return routeMap;
}

// ═══ Step 4: Extract FE API calls ════════════════════════════════════════

/** Normalize template literal endpoint to param pattern. */
function normalizeEndpoint(raw) {
  return raw.replace(/\$\{[^}]+\}/g, ":param");
}

/** Resolve a relative import to an absolute file path. */
function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  const idx = join(base, "index");
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (existsSync(idx + ext)) return idx + ext;
  }
  return null;
}

/** Extract api.* calls from a file and its local imports (max 2 levels). */
function extractApiCalls(filePath, visited = new Set()) {
  if (!filePath || visited.has(filePath) || !existsSync(filePath)) return [];
  visited.add(filePath);

  let content;
  try { content = readFileSync(filePath, "utf8"); } catch { return []; }

  const calls = [];

  // api.get/post/put/patch/del("path") or api.get<T>("path")
  const apiRe = /api\.(get|post|put|patch|del)\s*(?:<[^>]*>)?\s*\(\s*["'`]([^"'`\n]+)["'`]/g;
  let m;
  while ((m = apiRe.exec(content)) !== null) {
    const method = m[1] === "del" ? "DELETE" : m[1].toUpperCase();
    const endpoint = normalizeEndpoint(m[2]);
    if (endpoint.startsWith("/api/")) {
      calls.push({ method, endpoint });
    }
  }

  // Follow local imports (1 level deep from pages, 1 more from hooks)
  if (visited.size <= 3) {
    const importRe = /(?:import|from)\s+["'](\.[^"']+)["']/g;
    while ((m = importRe.exec(content)) !== null) {
      const resolved = resolveImport(filePath, m[1]);
      if (resolved) calls.push(...extractApiCalls(resolved, visited));
    }
  }

  return calls;
}

/** Scan all FE source files for api.* calls → Map<endpoint, {method, files[]}> */
function scanAllFeApiCalls(projectRoot) {
  const webSrc = resolve(projectRoot, "web/src");
  if (!existsSync(webSrc)) return new Map();

  const apiCalls = new Map(); // key: "METHOD /api/path" → { method, endpoint, files[] }

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!CODE_EXT.has(extname(e.name))) continue;

      let content;
      try { content = readFileSync(full, "utf8"); } catch { continue; }

      const apiRe = /api\.(get|post|put|patch|del)\s*(?:<[^>]*>)?\s*\(\s*["'`]([^"'`\n]+)["'`]/g;
      let m;
      while ((m = apiRe.exec(content)) !== null) {
        const method = m[1] === "del" ? "DELETE" : m[1].toUpperCase();
        const endpoint = normalizeEndpoint(m[2]);
        if (!endpoint.startsWith("/api/")) continue;
        const key = `${method} ${endpoint}`;
        if (!apiCalls.has(key)) {
          apiCalls.set(key, { method, endpoint, files: [] });
        }
        const rel = relative(projectRoot, full).replace(/\\/g, "/");
        if (!apiCalls.get(key).files.includes(rel)) {
          apiCalls.get(key).files.push(rel);
        }
      }
    }
  }

  walk(webSrc);
  return apiCalls;
}

// ═══ Step 5-6: Parse BE route map + endpoints ════════════════════════════

function parseBeRouteMap(projectRoot) {
  const serviceFile = resolve(projectRoot, "src/dashboard/service.ts");
  if (!existsSync(serviceFile)) return new Map();
  const content = readFileSync(serviceFile, "utf8");

  // Extract: this.route_map.set("/api/xxx", handle_xxx)
  const routeMap = new Map(); // prefix → handler import name
  const re = /route_map\.set\(\s*["']([^"']+)["']\s*,\s*(\w+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    routeMap.set(m[1], m[2]);
  }
  return routeMap;
}

/** Extract BE endpoints from handler file JSDoc headers. */
function extractBeEndpoints(projectRoot) {
  const routesDir = resolve(projectRoot, "src/dashboard/routes");
  if (!existsSync(routesDir)) return [];

  const endpoints = [];
  let entries;
  try { entries = readdirSync(routesDir, { withFileTypes: true }); } catch { return []; }

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".ts")) continue;
    const full = join(routesDir, e.name);
    let content;
    try { content = readFileSync(full, "utf8"); } catch { continue; }

    // Parse JSDoc: *   METHOD /api/path — description
    const docRe = /^\s*\*\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s]+)\s*(?:—|-)\s*(.+)$/gm;
    let m;
    while ((m = docRe.exec(content)) !== null) {
      endpoints.push({
        method: m[1],
        path: m[2].replace(/\s+$/, ""),
        description: m[3].trim(),
        handler: e.name,
      });
    }
  }

  return endpoints;
}

// ═══ Step 7: Cross-reference FE ↔ BE ═════════════════════════════════════

function normalizeForMatch(endpoint) {
  // /api/admin/users/:id → /api/admin/users/:param
  return endpoint.replace(/:[^/]+/g, ":param");
}

function crossReference(feApiCalls, beEndpoints) {
  const feSet = new Set([...feApiCalls.values()].map(c => `${c.method} ${normalizeForMatch(c.endpoint)}`));
  const beSet = new Set(beEndpoints.map(e => `${e.method} ${normalizeForMatch(e.path)}`));

  const feOnly = [];
  const beOnly = [];

  for (const call of feApiCalls.values()) {
    const key = `${call.method} ${normalizeForMatch(call.endpoint)}`;
    if (!beSet.has(key)) feOnly.push(call);
  }

  for (const ep of beEndpoints) {
    const key = `${ep.method} ${normalizeForMatch(ep.path)}`;
    if (!feSet.has(key)) beOnly.push(ep);
  }

  return { feOnly, beOnly };
}

// ═══ Step 8: Generate FVM table ══════════════════════════════════════════

function generateFvmRows(policies, feApiCalls, routeToPage, paths) {
  const rows = [];

  // Reverse map: path → PATHS key
  const pathToKey = {};
  for (const [key, path] of Object.entries(paths)) pathToKey[path] = key;

  for (const policy of policies) {
    const pathKey = pathToKey[policy.path];
    const pageFile = pathKey ? routeToPage[pathKey] : null;

    // Find API calls associated with this page
    const pageCalls = [];
    if (pageFile) {
      const pageDir = "web/src/pages/" + pageFile;
      for (const call of feApiCalls.values()) {
        if (call.files.some(f => f.startsWith(pageDir) || f.includes(pageFile))) {
          pageCalls.push(call);
        }
      }
    }

    // Also match by API prefix convention (e.g., /admin page → /api/admin/ endpoints)
    const pathSegment = policy.path.replace(/^\//, "").split("/")[0];
    if (pathSegment && pageCalls.length === 0) {
      for (const call of feApiCalls.values()) {
        if (call.endpoint.includes(`/api/${pathSegment}`)) {
          pageCalls.push(call);
        }
      }
    }

    // If no specific API calls found, add a page-load row
    if (pageCalls.length === 0) {
      pageCalls.push({ method: "GET", endpoint: "(page load)", files: [] });
    }

    // Deduplicate
    const seen = new Set();
    const uniqueCalls = pageCalls.filter(c => {
      const k = `${c.method} ${c.endpoint}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    for (const call of uniqueCalls) {
      // Determine which tier to use: view for GET, manage for mutations
      const tier = call.method === "GET" ? policy.view : policy.manage;

      for (const role of ROLES) {
        const allowed = TIER_ACCESS[tier]?.has(role) ?? false;
        let expectedStatus;
        if (allowed) {
          expectedStatus = 200;
        } else if (role === "unauthenticated") {
          expectedStatus = 401;
        } else {
          expectedStatus = 403;
        }

        rows.push({
          route: policy.path,
          page: pageFile || "—",
          feature: policy.description,
          endpoint: call.endpoint,
          method: call.method,
          tier,
          role,
          expected: expectedStatus,
        });
      }
    }
  }

  return rows;
}

// ═══ Formatters ══════════════════════════════════════════════════════════

function formatFull(rows, mismatches, feApiCalls, beEndpoints, policies) {
  const out = [];
  out.push("## FVM — Functional Verification Matrix\n");
  out.push(`Generated: ${new Date().toISOString()}\n`);
  out.push("### Summary\n");
  out.push(`- FE Routes: ${policies.length}`);
  out.push(`- FE API Calls: ${feApiCalls.size}`);
  out.push(`- BE Endpoints: ${beEndpoints.length}`);
  out.push(`- FVM Rows: ${rows.length}`);
  out.push(`- Mismatches: ${mismatches.feOnly.length + mismatches.beOnly.length}\n`);

  if (mismatches.feOnly.length > 0 || mismatches.beOnly.length > 0) {
    out.push("### Mismatches\n");
    out.push("| Type | FE | BE | Files |");
    out.push("|------|----|----|-------|");
    for (const c of mismatches.feOnly) {
      out.push(`| FE-only | ${c.method} ${c.endpoint} | — | ${c.files.join(", ")} |`);
    }
    for (const e of mismatches.beOnly) {
      out.push(`| BE-only | — | ${e.method} ${e.path} | ${e.handler} |`);
    }
    out.push("");
  }

  out.push("### Verification Matrix\n");
  out.push("| Route | Page | Feature | API Endpoint | Method | Tier | Role | Expected |");
  out.push("|-------|------|---------|-------------|--------|------|------|----------|");
  for (const r of rows) {
    out.push(`| ${r.route} | ${r.page} | ${r.feature} | ${r.endpoint} | ${r.method} | ${r.tier} | ${r.role} | ${r.expected} |`);
  }

  return out.join("\n");
}

function formatMismatches(mismatches) {
  const out = [];
  out.push("## FVM Mismatches\n");

  if (mismatches.feOnly.length === 0 && mismatches.beOnly.length === 0) {
    out.push("No mismatches found — all FE API calls have matching BE endpoints.\n");
    return out.join("\n");
  }

  out.push("| Type | FE | BE | Detail |");
  out.push("|------|----|----|--------|");
  for (const c of mismatches.feOnly) {
    out.push(`| FE-only | ${c.method} ${c.endpoint} | — | Called from: ${c.files.join(", ")} |`);
  }
  for (const e of mismatches.beOnly) {
    out.push(`| BE-only | — | ${e.method} ${e.path} | ${e.description} (${e.handler}) |`);
  }

  return out.join("\n");
}

function formatMatrix(rows) {
  const out = [];
  out.push("| Route | Page | Feature | API Endpoint | Method | Tier | Role | Expected |");
  out.push("|-------|------|---------|-------------|--------|------|------|----------|");
  for (const r of rows) {
    out.push(`| ${r.route} | ${r.page} | ${r.feature} | ${r.endpoint} | ${r.method} | ${r.tier} | ${r.role} | ${r.expected} |`);
  }
  return out.join("\n");
}

// ═══ Main entry ══════════════════════════════════════════════════════════

export function generateFvm(projectRoot, format = "full") {
  const root = resolve(projectRoot);

  // Step 1-2: FE routes + policies
  const paths = parsePaths(root);
  const policies = parsePolicies(root);
  if (policies.length === 0) {
    return { error: "No PAGE_POLICIES found. Is this the right project root?" };
  }

  // Step 3: Route → page mapping
  const routeToPage = mapRoutesToPages(root);

  // Step 4: All FE API calls
  const feApiCalls = scanAllFeApiCalls(root);

  // Step 5-6: BE endpoints
  const beEndpoints = extractBeEndpoints(root);

  // Step 7: Cross-reference
  const mismatches = crossReference(feApiCalls, beEndpoints);

  // Step 8: FVM rows
  const rows = generateFvmRows(policies, feApiCalls, routeToPage, paths);

  // Format output
  let text;
  if (format === "mismatches") {
    text = formatMismatches(mismatches);
  } else if (format === "matrix") {
    text = formatMatrix(rows);
  } else {
    text = formatFull(rows, mismatches, feApiCalls, beEndpoints, policies);
  }

  const summary = `${policies.length} routes, ${feApiCalls.size} FE calls, ${beEndpoints.length} BE endpoints, ${rows.length} FVM rows, ${mismatches.feOnly.length + mismatches.beOnly.length} mismatches`;

  return {
    text,
    summary,
    json: {
      routes: policies.length,
      fe_calls: feApiCalls.size,
      be_endpoints: beEndpoints.length,
      fvm_rows: rows.length,
      mismatches: mismatches.feOnly.length + mismatches.beOnly.length,
      rows,
    },
  };
}

// Expose internal parsers for testing
export { parsePaths, parsePolicies, mapRoutesToPages, extractBeEndpoints, normalizeEndpoint, TIER_ACCESS };

// ═══ CLI entry ═══════════════════════════════════════════════════════════

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace("file:///", "").replace("file://", ""));
if (isMain || process.argv[1]?.endsWith("fvm-generator.mjs")) {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    console.error("Usage: node fvm-generator.mjs <project-root> [--format full|mismatches|matrix]");
    process.exit(1);
  }
  const formatIdx = process.argv.indexOf("--format");
  const format = formatIdx >= 0 ? process.argv[formatIdx + 1] : "full";
  const result = generateFvm(projectRoot, format);
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  console.log(result.text);
  console.error(`\n(${result.summary})`);
}
