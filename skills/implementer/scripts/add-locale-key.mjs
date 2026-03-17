#!/usr/bin/env node
/**
 * Add a locale key to ALL supported locale files at once.
 * Usage: node <this-script> <key> <ko_value> <en_value>
 *
 * Locales dir is resolved relative to the consensus-loop root,
 * found via git rev-parse or fallback to script location.
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findLocalesDir() {
  // Try: script is at skills/implementer/scripts/ → locales is at ../../..locales/
  const fromScript = resolve(__dirname, "..", "..", "..", "locales");
  if (existsSync(fromScript)) return fromScript;

  // Fallback: git root + .claude/hooks/consensus-loop/locales
  try {
    const root = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
    const fromRoot = resolve(root, ".claude", "hooks", "consensus-loop", "locales");
    if (existsSync(fromRoot)) return fromRoot;
  } catch { /* git unavailable */ }

  console.error("Could not find locales directory");
  process.exit(1);
}

const LOCALES_DIR = findLocalesDir();
const [key, koValue, enValue] = process.argv.slice(2);

if (!key || !koValue || !enValue) {
  console.error("Usage: node add-locale-key.mjs <key> <ko_value> <en_value>");
  process.exit(1);
}

for (const [locale, value] of [["ko", koValue], ["en", enValue]]) {
  const path = resolve(LOCALES_DIR, `${locale}.json`);
  if (!existsSync(path)) { console.error(`  ✗ ${locale}.json not found`); continue; }
  const json = JSON.parse(readFileSync(path, "utf8"));
  if (json[key]) { console.log(`  ⚠ ${locale}: "${key}" exists — skipping`); continue; }
  json[key] = value;
  writeFileSync(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  console.log(`  ✓ ${locale}: added "${key}"`);
}
