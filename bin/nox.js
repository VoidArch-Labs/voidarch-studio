#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const tsCommands = new Map([
  ["init", "scripts/dfc-init.ts"],
  ["ingest", "scripts/dfc-ingest-repo.ts"],
  ["context", "scripts/dfc-context-pack.ts"],
  ["status", "scripts/dfc-status.ts"],
  ["remember", "scripts/dfc-remember.ts"],
  ["memory", "scripts/dfc-memory.ts"],
  ["task", "scripts/dfc-task.ts"],
  ["blocker", "scripts/dfc-blocker.ts"],
  ["metrics", "scripts/dfc-metrics.ts"],
  ["sync", "scripts/dfc-sync.ts"],
  ["embed", "scripts/dfc-embed.ts"],
  ["flags", "scripts/dfc-flags.ts"],
  ["page", "scripts/dfc-nox.ts"],
  ["docs:ingest", "scripts/dfc-docs-ingest.ts"],
  ["docs:query", "scripts/dfc-docs-query.ts"],
  ["graph:build", "scripts/dfc-graph-build.ts"],
  ["graph:import", "scripts/dfc-graph-import.ts"],
  ["graph:query", "scripts/dfc-graph-query.ts"],
  ["graph:status", "scripts/dfc-graph-status.ts"],
  ["memory:doctor", "scripts/dfc-memory-doctor.ts"],
  ["memory:gc", "scripts/dfc-memory-gc.ts"],
  ["db:check", "scripts/dfc-db-check.ts"],
  ["db:migrate", "scripts/dfc-db-migrate.ts"],
]);

const grouped = new Map([
  ["docs", new Set(["ingest", "query"])],
  ["graph", new Set(["build", "import", "query", "status"])],
  ["db", new Set(["check", "migrate"])],
]);

function help() {
  console.log(`nox — local repo memory and query CLI

Usage:
  nox <command> [options]
  nox <group> <subcommand> [options]

Core:
  init
  ingest
  context
  status
  page

Memory:
  remember
  memory <add|list|search|get|update|delete>
  task <add|list|update|done|get|delete>
  blocker <add|list|resolve|get|delete>
  memory doctor
  memory gc

Docs / graph / vectors:
  docs <ingest|query>
  graph <build|import|query|status>
  embed [--dry-run] [--limit <n>] [--approve]

Ops:
  db <check|migrate>
  metrics [--days <n>] [--json]
  sync
  flags

Compatibility:
  pnpm dfc:* scripts remain available.
`);
}

function resolveCommand(argv) {
  const [first, second, ...rest] = argv;
  if (!first || first === "help" || first === "--help" || first === "-h") return null;
  if (first.startsWith("dfc:")) return [first.slice(4), [second, ...rest].filter(Boolean)];
  if (first === "memory" && (second === "doctor" || second === "gc")) return [`memory:${second}`, rest];
  if (grouped.get(first)?.has(second)) return [`${first}:${second}`, rest];
  return [first, [second, ...rest].filter(Boolean)];
}

function run(script, args) {
  const tsx = join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const command = existsSync(tsx) ? tsx : "tsx";
  const child = spawn(command, [join(root, script), ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  child.on("error", (err) => {
    console.error(err.message);
    process.exit(1);
  });
}

const resolved = resolveCommand(process.argv.slice(2));
if (!resolved) {
  help();
  process.exit(0);
}

const [command, args] = resolved;
const script = tsCommands.get(command);
if (!script) {
  console.error(`Unknown nox command: ${command}`);
  console.error("Run `nox help` for the Nox command surface.");
  process.exit(2);
}

run(script, args);
