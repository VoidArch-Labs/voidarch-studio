// Shared types for the dev-flow-control SurrealDB dev-memory slice.

export type MemoryKind = "decision" | "evidence";
export type SourceAgent = "manual" | "codex" | "claude";
export type Phase = "discuss" | "plan" | "execute" | "verify" | "ship";

/** Resolved connection + scope configuration (env overrides the .dfc files). */
export interface DfcConfig {
  url: string;
  namespace: string;
  database: string;
  repoId: string;
  username: string;
  password: string;
  authScope: "root" | "namespace" | "database";
}

/** A single ingested repo text file. */
export interface FileRecord {
  repo_id: string;
  source_agent: SourceAgent;
  path: string;
  ext: string;
  size: number;
  mtime: string; // ISO-8601
  content: string;
  content_hash: string; // sha256 of content
  ingested_at: string; // ISO-8601
}

/** A remembered decision or evidence item. */
export interface MemoryRecord {
  repo_id: string;
  source_agent: SourceAgent;
  text: string;
  summary: string;
  tags: string[];
  task_goal?: string;
  created_at: string; // ISO-8601
  updated_at: string; // ISO-8601
}

// ---- Context-pack output shape (stable JSON contract for /dfc-context) ----

export interface ContextFileEntry {
  path: string;
  ext: string;
  size: number;
  score: number;
  excerpt: string;
}

export interface ContextMemoryEntry {
  summary: string;
  tags: string[];
  source_agent: SourceAgent | string;
  created_at: string;
  score: number;
}

export interface ContextAgentRunEntry {
  source_agent: SourceAgent | string;
  task_goal: string;
  status: string;
  summary: string;
  created_at: string;
  score: number;
}

export interface ContextToolEventEntry {
  source_agent: SourceAgent | string;
  tool_name: string;
  action: string;
  summary: string;
  success: boolean | null;
  created_at: string;
  score: number;
}

export interface ContextPack {
  task: { goal: string; phase: Phase };
  repo_context: { files: ContextFileEntry[] };
  memory_context: {
    decisions: ContextMemoryEntry[];
    evidence: ContextMemoryEntry[];
  };
  verification: { last_failures: string[] };
  workflow: { approval_required: string[]; approval_available: string[] };
  agent_context: {
    recent_runs: ContextAgentRunEntry[];
    recent_tool_events: ContextToolEventEntry[];
  };
  token_budget: {
    target_tokens: number;
    estimated_tokens: number;
    dropped_items: string[];
  };
}
