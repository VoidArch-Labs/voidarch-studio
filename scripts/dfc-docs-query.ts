// dfc:docs:query — rank document chunks for a query.
//
//   pnpm dfc:docs:query --q "SurrealDB memory architecture" --dry-run  # local, no DB
//   pnpm dfc:docs:query --q "approval gates"                           # BM25 via SurrealDB
//   pnpm dfc:docs:query --q "graph import" --limit 8 --json            # machine output
//
// Dry-run chunks the repo in-memory and scores deterministically (no BM25, no DB),
// so it works with no credentials. Live mode uses the doc_chunk BM25 full-text index.

import { normalizeSourceAgent } from "../src/memory/agents.js";
import { queryDocChunks, queryDocChunksLocal } from "../src/memory/docs.js";
import { REPO_ROOT, loadConfig, withDb } from "../src/memory/surreal.js";
import type { ContextDocChunkEntry } from "../src/memory/types.js";

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

function printResults(results: ContextDocChunkEntry[], dryRun: boolean): void {
  console.log(`dfc:docs:query ${dryRun ? "(DRY RUN — local chunking, no DB)" : "(SurrealDB BM25)"}`);
  if (!results.length) {
    console.log("  (no matching document chunks)");
    return;
  }
  for (const r of results) {
    console.log(`  [${r.score.toFixed(2)}] ${r.source_path} › ${r.heading || "(preamble)"}#${r.chunk_index}`);
    console.log(`         ${r.excerpt.slice(0, 160)}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const q = (args.q || "").trim();
  const dryRun = args["dry-run"] === "true";
  const asJson = args.json === "true";
  const sourceAgent = normalizeSourceAgent(args.agent);
  const limit = args.limit ? Math.max(1, Number.parseInt(args.limit, 10) || 10) : 10;
  if (!q) {
    console.error("--q is required");
    process.exit(2);
  }

  const repoId = loadConfig().repoId;
  const root = process.env.CLAUDE_PROJECT_DIR || REPO_ROOT;

  const results = dryRun
    ? queryDocChunksLocal(root, repoId, sourceAgent, q, limit, new Date().toISOString())
    : await withDb(async (db) => queryDocChunks(db, repoId, q, limit));

  if (asJson) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return;
  }
  printResults(results, dryRun);
}

main().catch((err) => {
  console.error((err as Error)?.message ?? String(err));
  process.exit(1);
});
