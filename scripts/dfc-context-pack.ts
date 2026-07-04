// dfc:context - build a context pack for a task and print COMPACT JSON ONLY to
// stdout. All diagnostics go to stderr so the output stays machine-readable.
//   pnpm dfc:context --task "Add approval logging"

import { Table } from "surrealdb";
import { normalizeSourceAgent } from "../src/memory/agents.js";
import { buildContextPack } from "../src/memory/context-pack.js";
import { withDb } from "../src/memory/surreal.js";
import { parseArgs, repoRootFromArgs } from "../src/memory/cli.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const task = (args.task || "").trim();
  const sourceAgent = normalizeSourceAgent(args.agent);
  const repoRoot = repoRootFromArgs(args);
  if (!task) {
    console.error("--task is required");
    process.exit(2);
  }

  const pack = await withDb(async (db, cfg) => {
    const built = await buildContextPack(db, cfg.repoId, task, { repoRoot });
    // Best-effort audit trail; never allowed to break the JSON contract.
    try {
      const now = new Date().toISOString();
      await db.create(new Table("task")).content({
        repo_id: cfg.repoId,
        source_agent: sourceAgent,
        goal: built.task.goal,
        phase: built.task.phase,
        created_at: now,
      });
      await db.create(new Table("context_pack")).content({
          repo_id: cfg.repoId,
          source_agent: sourceAgent,
          goal: built.task.goal,
          phase: built.task.phase,
          estimated_tokens: built.token_budget.estimated_tokens,
          pack: built,
          created_at: now,
      });
    } catch {
      /* persistence is optional for this slice */
    }
    return built;
  }, { repoRoot });

  process.stdout.write(`${JSON.stringify(pack)}\n`);
}

try {
  await main();
} catch (err) {
  console.error((err as Error)?.message ?? String(err));
  process.exit(1);
}
