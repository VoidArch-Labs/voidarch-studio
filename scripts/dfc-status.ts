// dfc:status - connect and report per-table row counts. Human-readable.

import { queryResult, withDb } from "../src/memory/surreal.js";
import type { Surreal } from "surrealdb";

const COUNT_TABLES = {
  "Repo records": "repo",
  "File records": "file",
  "Decision records": "decision",
  "Evidence records": "evidence_item",
  "Context packs": "context_pack",
  "Agent runs": "agent_run",
  "Tool events": "tool_event",
} as const;

async function countTable(db: Surreal, table: string): Promise<number> {
  const rows = await queryResult<Array<{ c?: number }>>(
    db,
    "SELECT count() AS c FROM type::table($t) GROUP ALL",
    { t: table },
  );
  return rows[0]?.c ?? 0;
}

async function main(): Promise<void> {
  await withDb(async (db, cfg) => {
    console.log("DFC SurrealDB dev memory");
    console.log(`URL: ${cfg.url}`);
    console.log(`Namespace: ${cfg.namespace}`);
    console.log(`Database: ${cfg.database}`);
    console.log(`Repo ID: ${cfg.repoId}`);
    for (const [label, table] of Object.entries(COUNT_TABLES)) {
      try {
        console.log(`${label}: ${await countTable(db, table)}`);
      } catch (err) {
        console.log(`${label}: ERR (${(err as Error).message})`);
      }
    }
    try {
      const lastIngest = await queryResult<Array<{ ingested_at?: unknown }>>(
        db,
        "SELECT ingested_at FROM file WHERE repo_id = $repo ORDER BY ingested_at DESC LIMIT 1",
        { repo: cfg.repoId },
      );
      console.log(`Last ingest: ${String(lastIngest[0]?.ingested_at ?? "(none)")}`);
    } catch (err) {
      console.log(`Last ingest: ERR (${(err as Error).message})`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
