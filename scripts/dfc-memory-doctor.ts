// dfc:memory:doctor — health report across all memory channels.
//
//   pnpm dfc:memory:doctor          # local diagnostics + DB section if configured
//   pnpm dfc:memory:doctor --json   # machine output
//
// Resilient by design: reports local doc/graph/provider diagnostics even with no
// SurrealDB credentials, and never exits non-zero just because the DB is unset.

import type { Surreal } from "surrealdb";
import { parseArgs, repoRootFromArgs } from "../src/memory/cli.js";
import { buildDocPlan } from "../src/memory/docs.js";
import { graphStatusLocal } from "../src/memory/graph.js";
import { assertUsableConfig, connect, loadConfig } from "../src/memory/surreal.js";
import {
  countRows,
  findGcCandidates,
  listEmbeddingModels,
  resolveEmbedConfig,
} from "../src/memory/vectors.js";

const DB_TABLES = [
  "file", "document", "doc_chunk", "decision", "evidence_item",
  "agent_run", "tool_event", "graph_snapshot", "graph_node", "graph_edge",
  "embedding_model", "embedding_chunk",
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const asJson = args.json === "true";
  const root = repoRootFromArgs(args);
  const cfg = loadConfig({ repoRoot: root });
  const embed = resolveEmbedConfig({ repoRoot: root });
  const docPlan = buildDocPlan(root, cfg.repoId, "manual", new Date().toISOString());
  const graph = graphStatusLocal(root);

  const report: Record<string, unknown> = {
    repo_id: cfg.repoId,
    local: {
      ingestible_documents: docPlan.stats.documents,
      ingestible_chunks: docPlan.stats.chunks,
      graph_present: graph.configured,
      graph_fresh: graph.is_fresh,
      graph_nodes: graph.node_count,
      graph_edges: graph.edge_count,
    },
    embedding: { provider: embed.provider, model: embed.model, dimension: embed.dimension, available: embed.available, reason: embed.reason },
    database: { configured: false, note: "" },
  };

  // DB section — best-effort; never throws out of the script.
  let db: Surreal | null = null;
  try {
    assertUsableConfig(cfg);
    db = await connect(cfg);
    const counts: Record<string, number> = {};
    for (const t of DB_TABLES) {
      try {
        counts[t] = await countRows(db, t, cfg.repoId);
      } catch (err) {
        counts[t] = -1;
      }
    }
    const models = await listEmbeddingModels(db, cfg.repoId);
    const gc = await findGcCandidates(db, cfg.repoId);
    report.database = {
      configured: true,
      url: cfg.url,
      namespace: cfg.namespace,
      counts,
      embedding_models: models.map((m) => ({ model: `${m.provider}:${m.model}`, dimension: m.dimension })),
      gc_orphans: gc.orphans,
      gc_mismatched: gc.mismatched,
      note: "connected",
    };
  } catch (err) {
    report.database = { configured: false, note: `not configured / unreachable: ${(err as Error).message}` };
  } finally {
    if (db) {
      try {
        await db.close();
      } catch {
        /* ignore */
      }
    }
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return;
  }

  const local = report.local as Record<string, unknown>;
  const dbsec = report.database as Record<string, unknown>;
  console.log("dfc:memory:doctor");
  console.log(`  repo_id:            ${cfg.repoId}`);
  console.log("  -- local (no DB) --");
  console.log(`  ingestible docs:    ${local.ingestible_documents} (${local.ingestible_chunks} chunks)`);
  console.log(`  graph present:      ${local.graph_present} (fresh=${local.graph_fresh}, nodes=${local.graph_nodes}, edges=${local.graph_edges})`);
  console.log(`  embed provider:     ${embed.provider} — ${embed.reason}`);
  console.log("  -- database --");
  console.log(`  configured:         ${dbsec.configured}`);
  if (dbsec.configured) {
    const counts = dbsec.counts as Record<string, number>;
    for (const t of DB_TABLES) console.log(`    ${t.padEnd(16)} ${counts[t]}`);
    console.log(`  embedding models:   ${JSON.stringify(dbsec.embedding_models)}`);
    console.log(`  gc orphans:         ${dbsec.gc_orphans}`);
    console.log(`  gc mismatched:      ${dbsec.gc_mismatched}`);
  } else {
    console.log(`  note:               ${dbsec.note}`);
  }
}

try {
  await main();
} catch (err) {
  // Doctor should not hard-fail; report and exit 0 so it is safe in CI/dry validation.
  console.error(`dfc:memory:doctor warning: ${(err as Error)?.message ?? String(err)}`);
}
