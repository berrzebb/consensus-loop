#!/usr/bin/env node
/**
 * Spawn a headless implementer worker with scoped permissions.
 *
 * Usage:
 *   node .claude/scripts/spawn-worker.mjs "task prompt here"
 *   node .claude/scripts/spawn-worker.mjs --file task-prompt.md
 *   node .claude/scripts/spawn-worker.mjs --budget 2 "task prompt"
 */
import { spawn } from "child_process";
import { readFileSync } from "fs";

const args = process.argv.slice(2);
let budget = "1";
let prompt = "";

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--budget" && args[i + 1]) {
    budget = args[++i];
  } else if (args[i] === "--file" && args[i + 1]) {
    prompt = readFileSync(args[++i], "utf8");
  } else {
    prompt = args[i];
  }
}

if (!prompt) {
  console.error("Usage: node spawn-worker.mjs [--budget N] [--file prompt.md] \"prompt\"");
  process.exit(1);
}

const ALLOWED_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Grep",
  "Glob",
  "Bash(npx:*)",
  "Bash(node:*)",
  "Bash(git diff:*)",
  "Bash(git status:*)",
  "Bash(git log:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(cat:*)",
  "Bash(ls:*)",
].join(",");

const child = spawn("claude", [
  "-p",
  "--output-format", "stream-json",
  "--verbose",
  "--max-budget-usd", budget,
  "--allowedTools", ALLOWED_TOOLS,
], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
});

// Send prompt via stdin
child.stdin.write(prompt);
child.stdin.end();

// Stream output — parse JSON lines, print assistant messages
child.stdout.on("data", (chunk) => {
  const lines = chunk.toString().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line);

      // Assistant text
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") {
            process.stdout.write(block.text);
          } else if (block.type === "tool_use") {
            console.log(`\n[tool] ${block.name}: ${JSON.stringify(block.input).substring(0, 200)}`);
          }
        }
      }

      // Result
      if (event.type === "result") {
        console.log(`\n\n=== Worker completed ===`);
        console.log(`Duration: ${(event.duration_ms / 1000).toFixed(1)}s`);
        console.log(`Cost: $${event.total_cost_usd?.toFixed(4)}`);
        console.log(`Turns: ${event.num_turns}`);
        if (event.result) console.log(`Result: ${event.result.substring(0, 500)}`);
      }
    } catch {
      // Non-JSON line — print as-is
      process.stdout.write(line + "\n");
    }
  }
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("close", (code) => {
  process.exit(code ?? 0);
});
