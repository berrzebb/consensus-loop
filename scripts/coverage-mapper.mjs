#!/usr/bin/env node
/**
 * coverage-mapper.mjs — Maps coverage data to RTM rows.
 *
 * Reads vitest coverage JSON and an RTM markdown file,
 * then outputs the RTM with a Coverage column appended.
 *
 * Usage:
 *   node coverage-mapper.mjs <rtm-file> [--coverage-dir coverage/]
 *   node coverage-mapper.mjs <rtm-file> --summary     # use coverage-summary.json only (faster)
 *   node coverage-mapper.mjs --stdin                   # read RTM from stdin
 *
 * Output: Updated RTM markdown to stdout.
 *
 * Coverage data source (priority):
 *   1. coverage/coverage-summary.json  — per-file summary (fast)
 *   2. coverage/coverage-final.json    — detailed per-file (slower, more data)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";

function loadCoverageSummary(coverageDir) {
  const summaryPath = resolve(coverageDir, "coverage-summary.json");
  if (!existsSync(summaryPath)) return null;

  const raw = JSON.parse(readFileSync(summaryPath, "utf8"));
  const result = new Map();

  for (const [filePath, data] of Object.entries(raw)) {
    if (filePath === "total") continue;
    // Normalize path for matching
    const normalized = filePath.replace(/\\/g, "/");
    result.set(normalized, {
      statements: data.statements?.pct ?? 0,
      branches: data.branches?.pct ?? 0,
      functions: data.functions?.pct ?? 0,
      lines: data.lines?.pct ?? 0,
    });
  }
  return result;
}

function matchCoverage(coverageMap, filePath, cwd) {
  if (!coverageMap) return null;

  const normalized = filePath.replace(/\\/g, "/");

  // Direct match
  for (const [covPath, data] of coverageMap) {
    if (covPath.endsWith(normalized) || normalized.endsWith(covPath)) {
      return data;
    }
  }

  // Try with cwd prefix
  const withCwd = resolve(cwd, filePath).replace(/\\/g, "/");
  for (const [covPath, data] of coverageMap) {
    if (covPath === withCwd || withCwd.endsWith(covPath) || covPath.endsWith(withCwd)) {
      return data;
    }
  }

  return null;
}

function formatCoverage(data) {
  if (!data) return "—";
  return `${data.statements}% stmt, ${data.branches}% br, ${data.functions}% fn`;
}

function processRtm(rtmContent, coverageMap, cwd) {
  const lines = rtmContent.split(/\r?\n/);
  const output = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect table header row (contains "File" column)
    if (line.includes("| File") && line.includes("| Status |")) {
      // Append Coverage column to header
      output.push(line.replace(/\|\s*$/, "| Coverage |"));

      // Next line is separator — extend it
      if (i + 1 < lines.length && lines[i + 1].includes("|---")) {
        i++;
        output.push(lines[i].replace(/\|\s*$/, "|----------|"));
      }
      continue;
    }

    // Detect table data rows (start with |)
    if (line.startsWith("|") && line.includes("|") && !line.includes("|---")) {
      const cells = line.split("|").map(c => c.trim());
      // Find the File column — typically column index 5 (after empty, Req ID, Description, Track, Design Ref)
      // We need to find which cell contains a file path
      const fileCell = cells.find(c =>
        c.match(/^`?(?:src|tests|scripts|web)\//) ||
        c.match(/\.(ts|tsx|js|mjs|test\.ts)/)
      );

      if (fileCell) {
        const filePath = fileCell.replace(/`/g, "").replace(/\s*\(.*\)/, "").trim();
        const cov = matchCoverage(coverageMap, filePath, cwd);
        output.push(line.replace(/\|\s*$/, `| ${formatCoverage(cov)} |`));
      } else {
        output.push(line.replace(/\|\s*$/, "| — |"));
      }
      continue;
    }

    output.push(line);
  }

  return output.join("\n");
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    console.log("Usage: node coverage-mapper.mjs <rtm-file> [--coverage-dir coverage/]");
    console.log("       node coverage-mapper.mjs --stdin [--coverage-dir coverage/]");
    process.exit(0);
  }

  let coverageDir = "coverage";
  let rtmContent = "";
  let useStdin = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--coverage-dir" && args[i + 1]) {
      coverageDir = args[++i];
    } else if (args[i] === "--stdin") {
      useStdin = true;
    } else if (!args[i].startsWith("--")) {
      rtmContent = readFileSync(resolve(args[i]), "utf8");
    }
  }

  if (useStdin && !rtmContent) {
    const chunks = [];
    const { stdin } = process;
    stdin.setEncoding("utf8");
    for await (const chunk of stdin) chunks.push(chunk);
    rtmContent = chunks.join("");
  }

  if (!rtmContent) {
    console.error("No RTM content provided. Use <file> or --stdin.");
    process.exit(1);
  }

  const cwd = process.cwd();
  const coverageMap = loadCoverageSummary(resolve(cwd, coverageDir));

  if (!coverageMap) {
    console.error(`Coverage data not found at ${resolve(cwd, coverageDir, "coverage-summary.json")}`);
    console.error("Run: npm run test:coverage first.");
    process.exit(1);
  }

  console.error(`Loaded coverage for ${coverageMap.size} files`);
  const result = processRtm(rtmContent, coverageMap, cwd);
  process.stdout.write(result);
}

main();
