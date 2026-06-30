// dfc:graph:import — import graphify-out/graph.json into SurrealDB graph memory.
//
//   pnpm dfc:graph:import --dry-run        # parse + plan, write nothing (no creds)
//   pnpm dfc:graph:import                  # replace repo graph rows; append snapshot
//   pnpm dfc:graph:import --agent claude    # tag rows with a source agent
//   pnpm dfc:graph:import --dry-run --json  # emit snapshot + counts as JSON
//
// graphify-out/ is gitignored and built locally with `/graphify` (or `graphify
// update .`). If it is absent or stale vs HEAD, this reports it instead of failing.

import { normalizeSourceAgent } from "../src/memory/agents.js";
import { buildGraphPlan, currentGitCommit, findGraphFile, importGraph, loadGraph } from "../src/memory/graph.js";
import { REPO_ROOT, loadConfig, withDb } from "../src/memory/surreal.js";

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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sourceAgent = normalizeSourceAgent(args.agent);
  const dryRun = args["dry-run"] === "true";
  const asJson = args.json === "true";
  const root = process.env.CLAUDE_PROJECT_DIR || REPO_ROOT;

  const file = findGraphFile(root);
  if (!file) {
    console.error("dfc:graph:import — no graphify-out/graph.json found.");
    console.error("  Build it first: run `/graphify` (Claude) or `graphify update .` (CLI).");
    process.exit(dryRun ? 0 : 1);
  }

  const repoId = loadConfig().repoId;
  const current = currentGitCommit(root);
  const plan = buildGraphPlan(loadGraph(file), repoId, sourceAgent, current, new Date().toISOString());

  if (asJson) {
    console.log(JSON.stringify({ snapshot: plan.snapshot }, null, 2));
    if (dryRun) return;
  }

  const s = plan.snapshot;
  console.log(`dfc:graph:import ${dryRun ? "(DRY RUN — no writes)" : ""}`.trim());
  console.log(`  snapshot_id:     ${s.snapshot_id}`);
  console.log(`  built_at_commit: ${s.built_at_commit || "(unknown)"}`);
  console.log(`  fresh vs HEAD:   ${s.is_fresh}${s.is_fresh ? "" : ` (HEAD ${current.slice(0, 8)} — refresh with /graphify for current code)`}`);
  console.log(`  nodes:           ${s.node_count} (${Object.entries(s.kind_counts).map(([k, v]) => `${k}=${v}`).join(", ")})`);
  console.log(`  edges:           ${s.edge_count}`);
  console.log(`  hyperedges:      ${s.hyperedge_count}`);

  if (dryRun) return;

  const result = await withDb(async (db) => importGraph(db, plan));
  console.log("  --- written to SurrealDB ---");
  console.log(`  graph_node:      ${result.nodes}`);
  console.log(`  graph_edge:      ${result.edges}`);
  console.log(`  graph_hyperedge: ${result.hyperedges}`);
  console.log(`  snapshot:        ${result.snapshotId} (replaced prior repo graph rows)`);
}

main().catch((err) => {
  console.error((err as Error)?.message ?? String(err));
  process.exit(1);
});
