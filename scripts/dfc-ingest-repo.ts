// dfc:ingest - scan repo text files and upsert them into SurrealDB.

import { ingestRepo } from "../src/memory/ingest.js";
import { REPO_ROOT, withDb } from "../src/memory/surreal.js";
import { normalizeSourceAgent } from "../src/memory/agents.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      out[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sourceAgent = normalizeSourceAgent(args.agent);
  await withDb(async (db, cfg) => {
    console.log(`ingesting ${cfg.repoId} from ${REPO_ROOT} as ${sourceAgent} ...`);
    const stats = await ingestRepo(db, cfg.repoId, REPO_ROOT, sourceAgent);
    console.log(
      `ingest complete: scanned ${stats.scanned}, ingested ${stats.ingested}, skipped ${stats.skipped}`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
