// dfc:embed — embed document chunks into vector memory (approval-gated).
//
//   pnpm dfc:embed --dry-run               # plan only; no API calls, no creds needed
//   pnpm dfc:embed --limit 25              # embed up to 25 chunks (provider must be set)
//   pnpm dfc:embed --approve               # one-shot approval for a PAID provider
//
// Provider is explicit via DFC_EMBED_PROVIDER (none|ollama|openai). The paid path
// (openai) is NEVER called without OPENAI_API_KEY *and* approval. With no provider
// configured, this is a no-op that explains how to enable a provider.

import { normalizeSourceAgent } from "../src/memory/agents.js";
import { REPO_ROOT, loadConfig, withDb } from "../src/memory/surreal.js";
import {
  embedChunks,
  gatherDbTargets,
  gatherLocalTargets,
  resolveEmbedConfig,
} from "../src/memory/vectors.js";

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
  const dryRun = args["dry-run"] === "true";
  const approve = args.approve === "true";
  const sourceAgent = normalizeSourceAgent(args.agent);
  const limit = args.limit ? Math.max(1, Number.parseInt(args.limit, 10) || 25) : 25;
  const cfg = resolveEmbedConfig({ approve });

  console.log(`dfc:embed ${dryRun ? "(DRY RUN — no API calls)" : ""}`.trim());
  console.log(`  provider:   ${cfg.provider}`);
  console.log(`  model:      ${cfg.model || "(none)"}`);
  console.log(`  dimension:  ${cfg.dimension || "(infer from first vector)"}`);
  console.log(`  paid:       ${cfg.paid}${cfg.paid ? `  (key=${cfg.apiKeyPresent}, approved=${cfg.approved})` : ""}`);
  console.log(`  available:  ${cfg.available}`);
  console.log(`  status:     ${cfg.reason}`);

  if (dryRun) {
    const targets = gatherLocalTargets(
      process.env.CLAUDE_PROJECT_DIR || REPO_ROOT,
      loadConfig().repoId,
      sourceAgent,
      limit,
      new Date().toISOString(),
    );
    console.log(`  candidates: ${targets.length} doc chunk(s) would be embedded (limit ${limit})`);
    if (!cfg.available) console.log("  note:       no embeddings computed — provider unavailable/dry-run.");
    return;
  }

  if (!cfg.available) {
    // Not an error: scaffolding is intentionally a no-op until a provider is enabled.
    console.log("  result:     nothing embedded (provider not available). See status above.");
    return;
  }

  const repoId = loadConfig().repoId;
  const result = await withDb(async (db) => {
    const targets = await gatherDbTargets(db, repoId, cfg.modelKey, limit);
    console.log(`  candidates: ${targets.length} new doc chunk(s) (skip-existing by content hash)`);
    return embedChunks(db, cfg, repoId, targets);
  });

  console.log("  --- embedding complete ---");
  console.log(`  embedded:   ${result.embedded}`);
  console.log(`  skipped:    ${result.skipped} (dimension mismatch)`);
  console.log(`  errors:     ${result.errors}`);
  console.log(`  dimension:  ${result.dimension}`);
}

main().catch((err) => {
  console.error((err as Error)?.message ?? String(err));
  process.exit(1);
});
