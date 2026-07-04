// dfc:remember - store a remembered decision or evidence item.
//   pnpm dfc:remember --kind decision --text "Use hosted SurrealDB ..."
//   pnpm dfc:remember --kind evidence --text "Approval logging must be scoped ..."

import { Table } from "surrealdb";
import { normalizeSourceAgent } from "../src/memory/agents.js";
import { parseArgs, repoRootFromArgs } from "../src/memory/cli.js";
import { withDb } from "../src/memory/surreal.js";
import { detectRiskTerms, tokenize } from "../src/memory/scoring.js";
import type { MemoryRecord } from "../src/memory/types.js";

/** First sentence, capped at 140 chars. */
function summarize(text: string): string {
  const firstSentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const s = firstSentence.length <= 140 ? firstSentence : `${text.slice(0, 137)}...`;
  return s.trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const kind = (args.kind || "").toLowerCase();
  const text = (args.text || "").trim();
  const sourceAgent = normalizeSourceAgent(args.agent);
  const taskGoal = (args.task || args.goal || "").trim();
  const repoRoot = repoRootFromArgs(args);

  if (kind !== "decision" && kind !== "evidence") {
    console.error('--kind must be "decision" or "evidence"');
    process.exit(2);
  }
  if (!text) {
    console.error("--text is required");
    process.exit(2);
  }

  const table = kind === "decision" ? "decision" : "evidence_item";
  const now = new Date().toISOString();
  const tags = Array.from(new Set([...detectRiskTerms(text), ...tokenize(text).slice(0, 5)]));

  await withDb(async (db, cfg) => {
    const doc: MemoryRecord = {
      repo_id: cfg.repoId,
      source_agent: sourceAgent,
      text,
      summary: summarize(text),
      tags,
      ...(taskGoal ? { task_goal: taskGoal } : {}),
      created_at: now,
      updated_at: now,
    };
    const created = await db
      .create(new Table(table))
      .content(doc as unknown as Record<string, unknown>);
    const rows = Array.isArray(created)
      ? (created as Array<{ id?: unknown }>)
      : [created as { id?: unknown }];
    const id = rows[0]?.id;
    console.log(`remembered ${kind} from ${sourceAgent}: ${summarize(text)}  [${String(id ?? "(created)")}]`);
  }, { repoRoot });
}

try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
