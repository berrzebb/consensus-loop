#!/usr/bin/env node
/**
 * Minimal i18n helper for consensus-loop scripts.
 * Reads locale JSON files from ./locales/ and returns a t(key, vars) function
 * with {var} placeholder substitution. Falls back to "en" if the target locale
 * file is missing, and to the raw key if the message is not found.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Create a translator bound to the given locale.
 * @param {string} locale - e.g. "en" or "ko"
 * @returns {(key: string, vars?: Record<string, unknown>) => string}
 */
export function createT(locale = "en") {
  const localesDir  = resolve(__dirname, "locales");
  const targetPath  = resolve(localesDir, `${locale}.json`);
  const fallbackPath = resolve(localesDir, "en.json");

  const messages = (() => {
    try {
      const path = existsSync(targetPath) ? targetPath : fallbackPath;
      return JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return {};
    }
  })();

  return function t(key, vars = {}) {
    let msg = messages[key] ?? key;
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.split(`{${k}}`).join(String(v ?? ""));
    }
    return msg;
  };
}
