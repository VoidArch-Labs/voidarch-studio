// Build a compact, token-budgeted context pack for a task from SurrealDB.
// Read-only: queries the DB, scores candidates deterministically, and assembles
// the stable ContextPack JSON contract consumed by the /dfc-context skill.

import type { Surreal } from "surrealdb";
import type {
  ContextAgentRunEntry,
  ContextFileEntry,
  ContextMemoryEntry,
  ContextPack,
  ContextToolEventEntry,
  Phase,
} from "./types.js";
import {
  detectRiskTerms,
  estimateTokens,
  inferPhase,
  scoreAgentRun,
  scoreFile,
  scoreMemory,
  scoreToolEvent,
  tokenize,
} from "./scoring.js";
import { queryResult } from "./surreal.js";

const TARGET_TOKENS = 2500;

/** Map a detected risk keyword to the human-readable gated action it implies. */
const RISK_TO_ACTION: Record<string, string> = {
  approval: "human approval gate",
  approve: "human approval gate",
  push: "git push to protected branch",
  force: "git push --force / --force-with-lease",
  deploy: "deploy to production",
  release: "release / publish",
  publish: "publish package",
  merge: "merge pull request",
  prod: "production change",
  production: "production change",
  secret: "access secrets",
  credential: "access credentials",
  token: "access tokens",
  delete: "destructive delete",
  drop: "drop database / table",
  destroy: "destructive operation",
  billing: "billing change",
  payment: "payment",
};

interface FileRow {
  path: string;
  ext: string;
  size: number;
  content: string;
  ftScore?: number;
}

interface MemoryRow {
  summary: string;
  text: string;
  tags: unknown;
  source_agent?: string;
  created_at: unknown;
}

interface AgentRunRow {
  source_agent?: string;
  task_goal?: string;
  status?: string;
  summary?: string;
  created_at: unknown;
}

interface ToolEventRow {
  source_agent?: string;
  tool_name?: string;
  action?: string;
  summary?: string;
  success?: boolean | null;
  created_at: unknown;
}

/** Normalize a SurrealDB datetime (Date or string) to an ISO string. */
function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string") return v;
  return String(v ?? "");
}

/** Build a short excerpt centered on the first matching term. */
function excerpt(content: string, terms: string[], max = 320): string {
  if (!content) return "";
  const low = content.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }
  const start = idx === -1 ? 0 : Math.max(0, idx - 60);
  return content.slice(start, start + max).replace(/\s+/g, " ").trim();
}

async function fetchMemory(
  db: Surreal,
  table: "decision" | "evidence_item",
  repoId: string,
  terms: string[],
  riskTerms: string[],
  now: number,
): Promise<ContextMemoryEntry[]> {
  const rows = await queryResult<MemoryRow[]>(
    db,
    `SELECT summary, text, tags, source_agent, created_at FROM type::table($t)
     WHERE repo_id = $repo ORDER BY created_at DESC LIMIT 40`,
    { t: table, repo: repoId },
  );
  return rows
    .map((r) => {
      const createdIso = toIso(r.created_at);
      const ageDays = createdIso
        ? Math.max(0, (now - new Date(createdIso).getTime()) / 86_400_000)
        : 9999;
      const summary = r.summary || (r.text || "").slice(0, 120);
      return {
        summary,
        tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
        source_agent: r.source_agent || "manual",
        created_at: createdIso,
        score: scoreMemory(
          { summary, text: r.text || "", ageDays },
          terms,
          riskTerms,
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function fetchAgentRuns(
  db: Surreal,
  repoId: string,
  terms: string[],
  riskTerms: string[],
  now: number,
): Promise<ContextAgentRunEntry[]> {
  const rows = await queryResult<AgentRunRow[]>(
    db,
    `SELECT source_agent, task_goal, status, summary, created_at FROM agent_run
     WHERE repo_id = $repo ORDER BY created_at DESC LIMIT 30`,
    { repo: repoId },
  );
  return rows
    .map((r) => {
      const createdIso = toIso(r.created_at);
      const ageDays = createdIso
        ? Math.max(0, (now - new Date(createdIso).getTime()) / 86_400_000)
        : 9999;
      const entry = {
        source_agent: r.source_agent || "manual",
        task_goal: r.task_goal || "",
        status: r.status || "",
        summary: r.summary || "",
        created_at: createdIso,
      };
      return {
        ...entry,
        score: scoreAgentRun(
          {
            taskGoal: entry.task_goal,
            summary: entry.summary,
            status: entry.status,
            sourceAgent: entry.source_agent,
            ageDays,
          },
          terms,
          riskTerms,
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

async function fetchToolEvents(
  db: Surreal,
  repoId: string,
  terms: string[],
  riskTerms: string[],
  now: number,
): Promise<ContextToolEventEntry[]> {
  const rows = await queryResult<ToolEventRow[]>(
    db,
    `SELECT source_agent, tool_name, action, summary, success, created_at FROM tool_event
     WHERE repo_id = $repo ORDER BY created_at DESC LIMIT 40`,
    { repo: repoId },
  );
  return rows
    .map((r) => {
      const createdIso = toIso(r.created_at);
      const ageDays = createdIso
        ? Math.max(0, (now - new Date(createdIso).getTime()) / 86_400_000)
        : 9999;
      const entry = {
        source_agent: r.source_agent || "manual",
        tool_name: r.tool_name || "",
        action: r.action || "",
        summary: r.summary || "",
        success: typeof r.success === "boolean" ? r.success : null,
        created_at: createdIso,
      };
      return {
        ...entry,
        score: scoreToolEvent(
          {
            toolName: entry.tool_name,
            action: entry.action,
            summary: entry.summary,
            sourceAgent: entry.source_agent,
            success: entry.success,
            ageDays,
          },
          terms,
          riskTerms,
        ),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

export async function buildContextPack(
  db: Surreal,
  repoId: string,
  task: string,
): Promise<ContextPack> {
  const goal = task.trim();
  const phase: Phase = inferPhase(goal);
  const terms = Array.from(new Set(tokenize(goal))).slice(0, 12);
  const riskTerms = detectRiskTerms(goal);

  // --- candidate files: full-text hits + filename/path-substring hits ---
  const fileMap = new Map<string, FileRow>();

  if (terms.length) {
    const ftRows = await queryResult<FileRow[]>(
      db,
      `SELECT path, ext, size, content, search::score(0) AS ftScore FROM file
       WHERE repo_id = $repo AND content @0@ $q
       ORDER BY ftScore DESC LIMIT 20`,
      { repo: repoId, q: terms.join(" ") },
    );
    for (const r of ftRows) {
      fileMap.set(r.path, { ...r, ftScore: r.ftScore ?? 0 });
    }
  }

  for (const t of terms) {
    const rows = await queryResult<FileRow[]>(
      db,
      `SELECT path, ext, size, content FROM file
       WHERE repo_id = $repo AND string::contains(string::lowercase(path), $t)
       LIMIT 10`,
      { repo: repoId, t },
    );
    for (const r of rows) {
      if (!fileMap.has(r.path)) fileMap.set(r.path, { ...r, ftScore: 0 });
    }
  }

  const scoredFiles: ContextFileEntry[] = Array.from(fileMap.values())
    .map((r) => ({
      path: r.path,
      ext: r.ext,
      size: r.size,
      score: scoreFile(
        {
          path: r.path,
          size: r.size,
          ftScore: r.ftScore ?? 0,
          contentLower: (r.content || "").toLowerCase(),
        },
        terms,
        riskTerms,
      ),
      excerpt: excerpt(r.content || "", terms),
    }))
    .sort((a, b) => b.score - a.score);

  // --- remembered decisions + evidence ---
  const now = Date.now();
  const decisions = await fetchMemory(db, "decision", repoId, terms, riskTerms, now);
  const evidence = await fetchMemory(db, "evidence_item", repoId, terms, riskTerms, now);
  const recentRuns = await fetchAgentRuns(db, repoId, terms, riskTerms, now);
  const recentToolEvents = await fetchToolEvents(db, repoId, terms, riskTerms, now);

  // --- recent verification failures ---
  const verificationRows = await queryResult<Array<{ summary: string; failures: unknown }>>(
    db,
    `SELECT summary, failures, created_at FROM verification_run
     WHERE repo_id = $repo AND status = 'fail'
     ORDER BY created_at DESC LIMIT 3`,
    { repo: repoId },
  );
  const lastFailures: string[] = [];
  for (const v of verificationRows) {
    if (Array.isArray(v.failures) && v.failures.length) {
      lastFailures.push(...(v.failures as string[]));
    } else if (v.summary) {
      lastFailures.push(v.summary);
    }
  }

  // --- workflow approval hints ---
  const approvalRequired = Array.from(
    new Set(riskTerms.map((r) => RISK_TO_ACTION[r]).filter((x): x is string => Boolean(x))),
  );
  const approvalRows = await queryResult<Array<{ tool_pattern: string; expires_at: unknown }>>(
    db,
    `SELECT tool_pattern, expires_at FROM approval WHERE repo_id = $repo`,
    { repo: repoId },
  );
  const nowIso = new Date().toISOString();
  const approvalAvailable = approvalRows
    .filter((a) => {
      const exp = toIso(a.expires_at);
      return !exp || exp > nowIso; // ISO-8601 UTC strings compare lexically
    })
    .map((a) => a.tool_pattern)
    .filter(Boolean);

  // --- assemble + token-budget (greedy by score: files, then decisions, then evidence) ---
  const dropped: string[] = [];
  const pack: ContextPack = {
    task: { goal, phase },
    repo_context: { files: [] },
    memory_context: { decisions: [], evidence: [] },
    verification: { last_failures: lastFailures.slice(0, 5) },
    workflow: { approval_required: approvalRequired, approval_available: approvalAvailable },
    agent_context: { recent_runs: [], recent_tool_events: [] },
    token_budget: {
      target_tokens: TARGET_TOKENS,
      estimated_tokens: 0,
      dropped_items: dropped,
    },
  };

  let tokens = estimateTokens(
    JSON.stringify({ task: pack.task, verification: pack.verification, workflow: pack.workflow }),
  );

  for (const f of scoredFiles) {
    const cost = estimateTokens(f.path + f.excerpt);
    if (tokens + cost > TARGET_TOKENS) {
      dropped.push(`file:${f.path}`);
      continue;
    }
    pack.repo_context.files.push(f);
    tokens += cost;
  }
  for (const d of decisions) {
    const cost = estimateTokens(d.summary);
    if (tokens + cost > TARGET_TOKENS) {
      dropped.push(`decision:${d.summary.slice(0, 40)}`);
      continue;
    }
    pack.memory_context.decisions.push(d);
    tokens += cost;
  }
  for (const e of evidence) {
    const cost = estimateTokens(e.summary);
    if (tokens + cost > TARGET_TOKENS) {
      dropped.push(`evidence:${e.summary.slice(0, 40)}`);
      continue;
    }
    pack.memory_context.evidence.push(e);
    tokens += cost;
  }
  for (const r of recentRuns) {
    const cost = estimateTokens(`${r.task_goal} ${r.summary}`);
    if (tokens + cost > TARGET_TOKENS) {
      dropped.push(`agent_run:${r.summary.slice(0, 40) || r.task_goal.slice(0, 40)}`);
      continue;
    }
    pack.agent_context.recent_runs.push(r);
    tokens += cost;
  }
  for (const e of recentToolEvents) {
    const cost = estimateTokens(`${e.tool_name} ${e.action} ${e.summary}`);
    if (tokens + cost > TARGET_TOKENS) {
      dropped.push(`tool_event:${e.tool_name}:${e.action}`.slice(0, 60));
      continue;
    }
    pack.agent_context.recent_tool_events.push(e);
    tokens += cost;
  }

  pack.token_budget.estimated_tokens = tokens;
  return pack;
}
