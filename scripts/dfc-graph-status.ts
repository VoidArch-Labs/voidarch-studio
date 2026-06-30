// dfc:graph:status — report graph freshness + counts.
//
//   pnpm dfc:graph:status --dry-run   # read graphify-out/graph.json + git HEAD, no DB
//   pnpm dfc:graph:status             # latest persisted snapshot from SurrealDB
//   pnpm dfc:graph:status --json      # machine output

import { graphStatusDb, graphStatusLocal, type GraphStatus } from "../src/memory/graph.js";
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

function printStatus(s: GraphStatus, dryRun: boolean): void {
  console.log(`dfc:graph:status ${dryRun ? "(DRY RUN — local graph.json)" : "(SurrealDB snapshot)"}`);
  console.log(`  configured:      ${s.configured}`);
  console.log(`  built_at_commit: ${s.built_at_commit || "(unknown)"}`);
  console.log(`  current_commit:  ${s.current_commit || "(unknown)"}`);
  console.log(`  fresh vs HEAD:   ${s.is_fresh}`);
  console.log(`  nodes:           ${s.node_count}`);
  console.log(`  edges:           ${s.edge_count}`);
  console.log(`  hyperedges:      ${s.hyperedge_count}`);
  if (Object.keys(s.kind_counts).length) {
    console.log(`  node kinds:      ${Object.entries(s.kind_counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  if (Object.keys(s.relation_counts).length) {
    console.log(`  edge relations:  ${Object.entries(s.relation_counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  console.log(`  note:            ${s.note}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args["dry-run"] === "true";
  const asJson = args.json === "true";
  const root = process.env.CLAUDE_PROJECT_DIR || REPO_ROOT;

  const status = dryRun
    ? graphStatusLocal(root)
    : await withDb(async (db) => graphStatusDb(db, loadConfig().repoId, root));

  if (asJson) {
    process.stdout.write(`${JSON.stringify(status)}\n`);
    return;
  }
  printStatus(status, dryRun);
}

main().catch((err) => {
  console.error((err as Error)?.message ?? String(err));
  process.exit(1);
});
