// dfc:docs:ingest — chunk repo markdown (heading-first) into SurrealDB doc memory.
//
//   pnpm dfc:docs:ingest --dry-run            # chunk + plan, write nothing (no creds)
//   pnpm dfc:docs:ingest                      # ingest into SurrealDB (idempotent)
//   pnpm dfc:docs:ingest --agent claude       # tag rows with a source agent
//   pnpm dfc:docs:ingest --dry-run --json     # emit the full plan as JSON
//
// Sources: README.md, AGENTS.md, docs/**, templates/**, skills/**/SKILL.md,
// agents/*.md, .claude/skills/**/SKILL.md. Unchanged files are skipped on re-ingest.

import { normalizeSourceAgent } from "../src/memory/agents.js";
import { parseArgs, positiveIntArg, repoRootFromArgs } from "../src/memory/cli.js";
import { buildDocPlan, ingestDocs } from "../src/memory/docs.js";
import { loadConfig, withDb } from "../src/memory/surreal.js";

function printPlan(stats: ReturnType<typeof buildDocPlan>["stats"], dryRun: boolean): void {
  console.log(`dfc:docs:ingest ${dryRun ? "(DRY RUN — no writes)" : ""}`.trim());
  console.log(`  sources scanned: ${stats.sources}`);
  console.log(`  documents:       ${stats.documents}`);
  console.log(`  chunks:          ${stats.chunks}`);
  console.log(`  deduped chunks:  ${stats.deduped} (identical content hash)`);
  console.log(`  skipped files:   ${stats.skipped} (empty / oversized / unreadable)`);
  console.log(`  est. tokens:     ${stats.totalTokens}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sourceAgent = normalizeSourceAgent(args.agent);
  const dryRun = args["dry-run"] === "true";
  const asJson = args.json === "true";
  const now = new Date().toISOString();
  const repoRoot = repoRootFromArgs(args);
  const maxDocuments = positiveIntArg(args, "limit");

  const repoId = loadConfig({ repoRoot }).repoId; // no credentials needed to read repoId
  const plan = buildDocPlan(repoRoot, repoId, sourceAgent, now);

  if (asJson) {
    console.log(JSON.stringify({ stats: plan.stats, documents: plan.documents.map((d) => d.document) }, null, 2));
    if (dryRun) return;
  }

  if (dryRun) {
    printPlan(plan.stats, true);
    const sample = plan.documents[0]?.chunks[0];
    if (sample) {
      console.log(`  sample chunk:    [${sample.source_path}] "${sample.heading || "(preamble)"}" — ${sample.summary.slice(0, 60)}`);
    }
    return;
  }

  const result = await withDb(async (db) => ingestDocs(db, plan, { maxDocuments }), { repoRoot });
  printPlan(plan.stats, false);
  console.log("  --- written to SurrealDB ---");
  console.log(`  documents written: ${result.documents} (${result.unchanged} unchanged, ${result.limited} limited)`);
  console.log(`  doc_chunk rows:    ${result.chunks}`);
}

try {
  await main();
} catch (err) {
  console.error((err as Error)?.message ?? String(err));
  process.exit(1);
}
