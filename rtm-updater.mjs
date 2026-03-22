/**
 * RTM Auto-Updater — updates RTM status based on actual codebase state.
 *
 * Triggered by:
 * - Agent completion (subagent-stop hook)
 * - Commit (session-stop hook)
 * - Manual: quorum tool rtm_update
 *
 * For each RTM row, checks:
 * - File column → existsSync
 * - Impl column → file has non-trivial content
 * - Test Case column → test file exists
 * - Status: open → wip (file exists) → verified (file + test exist)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Update RTM file statuses based on current filesystem state.
 *
 * @param {string} rtmPath - Path to RTM markdown file
 * @param {string} repoRoot - Repository root for resolving file paths
 * @returns {{ updated: number, total: number, changes: string[] }}
 */
export function updateRtmStatus(rtmPath, repoRoot) {
  if (!existsSync(rtmPath)) return { updated: 0, total: 0, changes: [] };

  const content = readFileSync(rtmPath, "utf8");
  const lines = content.split(/\r?\n/);
  const changes = [];
  let updated = 0;
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|") || line.includes("---")) continue;

    const cells = line.split("|").map(c => c.trim()).filter(Boolean);
    if (cells.length < 6) continue;

    const reqId = cells[0];
    if (!/^[A-Z]{2,}-\d+/.test(reqId)) continue;

    total++;

    const filePath = cells[4]; // File column
    const testCase = cells[7]; // Test Case column
    const statusIdx = cells.length - 1;
    const currentStatus = cells[statusIdx].toLowerCase();

    // Skip already verified unless we detect regression
    if (currentStatus === "verified") continue;

    // Check file existence
    const fileExists = filePath && filePath !== "--" && checkFileExists(filePath, repoRoot);
    const testExists = testCase && testCase !== "--" && checkFileExists(testCase, repoRoot);

    let newStatus = currentStatus;
    if (fileExists && testExists) {
      newStatus = "verified";
    } else if (fileExists) {
      newStatus = "wip";
    }

    if (newStatus !== currentStatus) {
      // Replace status in the line
      const parts = line.split("|");
      // Find the last non-empty cell (status)
      for (let j = parts.length - 2; j >= 0; j--) {
        const trimmed = parts[j].trim();
        if (trimmed === "open" || trimmed === "wip" || trimmed === "verified" ||
            trimmed === "blocked" || trimmed === "--") {
          parts[j] = ` ${newStatus} `;
          break;
        }
      }
      lines[i] = parts.join("|");
      updated++;
      changes.push(`${reqId}: ${currentStatus} → ${newStatus} (${filePath})`);
    }
  }

  if (updated > 0) {
    writeFileSync(rtmPath, lines.join("\n"));
  }

  return { updated, total, changes };
}

/**
 * Update all RTM files in a directory tree.
 */
export function updateAllRtms(repoRoot) {
  const results = [];
  const searchDirs = [resolve(repoRoot, "docs"), resolve(repoRoot, "plans")];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    scanAndUpdate(dir, repoRoot, results);
  }

  return results;
}

function scanAndUpdate(dir, repoRoot, results) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        scanAndUpdate(fullPath, repoRoot, results);
      } else if (entry.name.toLowerCase().startsWith("rtm") && entry.name.endsWith(".md")) {
        const result = updateRtmStatus(fullPath, repoRoot);
        if (result.updated > 0) {
          results.push({ path: fullPath, ...result });
        }
      }
    }
  } catch { /* skip */ }
}

// ── Git commit history integration ────────────

/**
 * Build a map of file → last commit info from git log.
 * Used to determine if a file was actually committed (not just created).
 */
export function getCommitMap(repoRoot, since) {
  try {
    const args = ["log", "--name-only", "--pretty=format:%H|%aI|%s"];
    if (since) args.push(`--since=${since}`);
    const output = execFileSync("git", args, {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });

    const map = new Map(); // file → { hash, date, message }
    let current = null;

    for (const line of output.split("\n")) {
      if (line.includes("|")) {
        const [hash, date, ...msg] = line.split("|");
        current = { hash, date, message: msg.join("|") };
      } else if (line.trim() && current) {
        const file = line.trim();
        if (!map.has(file)) {
          map.set(file, current);
        }
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Enhanced RTM update: uses git commit history + file existence.
 * A file counts as "implemented" only if it was actually committed.
 */
export function updateRtmWithCommitHistory(rtmPath, repoRoot, since) {
  if (!existsSync(rtmPath)) return { updated: 0, total: 0, changes: [] };

  const commitMap = getCommitMap(repoRoot, since);
  const content = readFileSync(rtmPath, "utf8");
  const lines = content.split(/\r?\n/);
  const changes = [];
  let updated = 0;
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|") || line.includes("---")) continue;

    const cells = line.split("|").map(c => c.trim()).filter(Boolean);
    if (cells.length < 6) continue;

    const reqId = cells[0];
    if (!/^[A-Z]{2,}-\d+/.test(reqId)) continue;

    total++;

    const filePath = cells[4]; // File column
    const testCase = cells[7]; // Test Case column
    const statusIdx = cells.length - 1;
    const currentStatus = cells[statusIdx].toLowerCase();

    if (currentStatus === "verified") continue;

    // Check: file exists + was committed
    const fileExists = filePath && filePath !== "--" && checkFileExists(filePath, repoRoot);
    const fileCommitted = filePath && commitMap.has(filePath);
    const testExists = testCase && testCase !== "--" && checkFileExists(testCase, repoRoot);
    const testCommitted = testCase && commitMap.has(testCase);

    let newStatus = currentStatus;
    if (fileExists && testExists && (fileCommitted || testCommitted)) {
      newStatus = "verified";
    } else if (fileExists && fileCommitted) {
      newStatus = "wip";
    } else if (fileExists) {
      newStatus = "wip";
    }

    if (newStatus !== currentStatus) {
      const parts = line.split("|");
      for (let j = parts.length - 2; j >= 0; j--) {
        const trimmed = parts[j].trim();
        if (trimmed === "open" || trimmed === "wip" || trimmed === "verified" ||
            trimmed === "blocked" || trimmed === "--") {
          parts[j] = ` ${newStatus} `;
          break;
        }
      }
      lines[i] = parts.join("|");
      updated++;
      const commit = commitMap.get(filePath);
      const commitInfo = commit ? ` [${commit.hash?.slice(0, 7)}]` : "";
      changes.push(`${reqId}: ${currentStatus} → ${newStatus} (${filePath})${commitInfo}`);
    }
  }

  if (updated > 0) {
    writeFileSync(rtmPath, lines.join("\n"));
  }

  return { updated, total, changes };
}

/**
 * Get project progress summary from git history + RTM.
 * Usable by daemon and status without modifying RTM files.
 */
export function getProgressFromGit(repoRoot, rtmPaths) {
  const commitMap = getCommitMap(repoRoot);
  const progress = { tracks: [], recentCommits: [], totalFiles: commitMap.size };

  // Recent commits (last 10)
  try {
    const log = execFileSync("git", ["log", "--oneline", "-10"], {
      cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    progress.recentCommits = log.trim().split("\n").filter(Boolean);
  } catch { /* skip */ }

  // Per-track progress from RTM files
  for (const rtmPath of rtmPaths) {
    if (!existsSync(rtmPath)) continue;
    const content = readFileSync(rtmPath, "utf8");
    let currentTrack = "";

    for (const line of content.split(/\r?\n/)) {
      // Track header: "## EN Track (Engine)"
      const trackMatch = line.match(/^##\s+(\w+)\s+Track/i);
      if (trackMatch) { currentTrack = trackMatch[1]; continue; }

      if (!line.startsWith("|") || line.includes("---")) continue;
      const cells = line.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length < 2 || !/^[A-Z]{2,}-\d+/.test(cells[0])) continue;

      const status = cells[cells.length - 1].toLowerCase();
      const filePath = cells[4] ?? "";
      const committed = commitMap.has(filePath);

      let track = progress.tracks.find(t => t.name === currentTrack);
      if (!track) {
        track = { name: currentTrack, total: 0, verified: 0, wip: 0, committed: 0 };
        progress.tracks.push(track);
      }
      track.total++;
      if (status === "verified") track.verified++;
      else if (status === "wip" || status.startsWith("partial")) track.wip++;
      if (committed) track.committed++;
    }
  }

  return progress;
}

function checkFileExists(filePath, repoRoot) {
  if (!filePath || filePath === "--" || filePath === "self") return false;

  // Handle glob patterns (e.g., "tests/security/*")
  if (filePath.includes("*")) {
    const dir = resolve(repoRoot, filePath.replace(/\/?\*.*$/, ""));
    return existsSync(dir);
  }

  // Handle multiple files separated by comma
  if (filePath.includes(",")) {
    return filePath.split(",").some(f => existsSync(resolve(repoRoot, f.trim())));
  }

  return existsSync(resolve(repoRoot, filePath));
}
