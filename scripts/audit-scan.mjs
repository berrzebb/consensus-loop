#!/usr/bin/env node
/**
 * Quick codebase scan — replaces expensive agent grep operations.
 * Usage: node <this-script> [category]
 *
 * Categories: type-safety, hardcoded, empty-catch, todo, all
 *
 * Resolves REPO_ROOT via git rev-parse so it works from any cwd.
 */
import { execSync } from "child_process";

function getRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

const ROOT = getRepoRoot();
const category = process.argv[2] || "all";

const scans = {
  "type-safety": {
    label: "Type Safety Issues (as any, @ts-ignore, @ts-expect-error)",
    cmd: `rg --type ts "(as any|@ts-ignore|@ts-expect-error)" src/ --count-matches`,
  },
  "hardcoded": {
    label: "Hardcoded Values (localhost, ports, Redis URLs)",
    cmd: `rg --type ts "(localhost|127\\.0\\.0\\.1|redis://|:6379|:3000)" src/ -n`,
  },
  "empty-catch": {
    label: "Empty Catch Blocks",
    cmd: `rg --type ts "catch\\s*\\{\\s*\\}" src/ -n`,
  },
  "todo": {
    label: "TODO/FIXME/HACK Comments",
    cmd: `rg --type ts "(TODO|FIXME|HACK)" src/ -n --count-matches`,
  },
};

const targets = category === "all" ? Object.keys(scans) : [category];

for (const key of targets) {
  const scan = scans[key];
  if (!scan) { console.error(`Unknown category: ${key}`); continue; }
  console.log(`\n=== ${scan.label} ===`);
  try {
    const result = execSync(scan.cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    console.log(result || "  (none found)");
  } catch {
    console.log("  (none found)");
  }
}
