// dfc:log-run — record an explicit agent_run summary for a session (run.json).
//
//   pnpm dfc:log-run --session s1 --agent codex --task "refactor auth" --status completed \
//                    --summary "Split auth module, added tests"
//   pnpm dfc:log-run --session s1 --agent claude --dry-run
//
// dfc:import-runs prefers this explicit summary over the one it derives from
// tools.jsonl. No database access — writes only the local (gitignored) buffer.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeSourceAgent } from "../src/memory/agents.js";
import { REPO_ROOT } from "../src/memory/surreal.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = "true";
      else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const sourceAgent = normalizeSourceAgent(args.agent);
  const session = (args.session || "manual").trim();
  const now = new Date().toISOString();

  const root = process.env.CLAUDE_PROJECT_DIR || REPO_ROOT;
  const path = join(root, ".agent-runs", "sessions", session, "run.json");

  // Merge with any existing run.json so repeated calls accrete rather than clobber.
  let prev: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      prev = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      prev = {};
    }
  }

  const record = {
    ...prev,
    session_id: session,
    source_agent: sourceAgent,
    task_goal: args.task || args.goal || (prev.task_goal as string) || "",
    status: args.status || (prev.status as string) || "completed",
    summary: args.summary || (prev.summary as string) || "",
    created_at: (prev.created_at as string) || now,
    updated_at: now,
  };

  const json = JSON.stringify(record, null, 2);
  if (args["dry-run"] === "true") {
    console.log(`dfc:log-run (DRY RUN — not written) → ${path}`);
    console.log(json);
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${json}\n`);
  console.log(`dfc:log-run — wrote run summary for session '${session}' (${sourceAgent}) → ${path}`);
}

main();
