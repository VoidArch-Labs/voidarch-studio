// Vector memory: an OPTIONAL, approval-gated retrieval channel.
//
// Provider is explicit via DFC_EMBED_PROVIDER (none | ollama | openai):
//   - none   : default; dry-run/scaffolding only, never embeds.
//   - ollama : local/free; embeds against DFC_EMBED_HOST (default :11434).
//   - openai : PAID; requires OPENAI_API_KEY *and* explicit approval
//              (DFC_EMBED_APPROVED=1 or --approve). Never called silently.
//
// Embeddings dedupe by content_hash per model, enforce a single dimension per
// model, and are compared with deterministic cosine similarity in JS (the 0003
// migration is intentionally dimension-agnostic and defines no MTREE index).

import { createHash } from "node:crypto";
import { join } from "node:path";
import { RecordId, type Surreal } from "surrealdb";
import { buildDocPlan } from "./docs.js";
import { cosineSimilarity } from "./scoring.js";
import { parseEnvFile, queryResult, queryResults, resolveDfcDir } from "./surreal.js";
import type {
  ContextVectorChunkEntry,
  EmbeddingChunkRecord,
  EmbeddingModelRecord,
  SourceAgent,
} from "./types.js";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export type EmbedProvider = "none" | "ollama" | "openai";

export interface EmbedConfig {
  provider: EmbedProvider;
  model: string;
  modelKey: string; // "<provider>:<model>"
  dimension: number; // configured expected dimension (0 = infer from first vector)
  host: string;
  paid: boolean;
  apiKeyPresent: boolean;
  approved: boolean;
  available: boolean; // can we embed live right now?
  reason: string;
}

function defaultModel(p: EmbedProvider): string {
  if (p === "ollama") return "nomic-embed-text";
  if (p === "openai") return "text-embedding-3-small";
  return "";
}

function embedFileEnv(): Record<string, string> {
  return parseEnvFile(join(resolveDfcDir(), "embed.env"));
}

function getEmbedEnv(key: string, fileEnv = embedFileEnv()): string {
  return (process.env[key] ?? fileEnv[key] ?? "").trim();
}

function supportsOpenAiDimensions(model: string): boolean {
  return model.startsWith("text-embedding-3");
}

/** Resolve embedding configuration from process.env + .dfc/embed.env (+ optional --approve). */
export function resolveEmbedConfig(opts?: { approve?: boolean }): EmbedConfig {
  const fileEnv = embedFileEnv();
  const provider = (getEmbedEnv("DFC_EMBED_PROVIDER", fileEnv) || "none").toLowerCase() as EmbedProvider;
  const model = (getEmbedEnv("DFC_EMBED_MODEL", fileEnv) || defaultModel(provider)).trim();
  const dimension = Number.parseInt(getEmbedEnv("DFC_EMBED_DIMENSION", fileEnv) || "0", 10) || 0;
  const paid = provider === "openai";
  const apiKeyPresent = Boolean(getEmbedEnv("OPENAI_API_KEY", fileEnv));
  const approved = opts?.approve === true || getEmbedEnv("DFC_EMBED_APPROVED", fileEnv) === "1";
  const host = (
    getEmbedEnv("DFC_EMBED_HOST", fileEnv) ||
    (provider === "ollama" ? "http://localhost:11434" : provider === "openai" ? "https://api.openai.com" : "")
  ).replace(/\/$/, "");

  let available = false;
  let reason = "";
  if (provider === "none") {
    reason = "no embedding provider configured — set DFC_EMBED_PROVIDER=ollama|openai (dry-run only)";
  } else if (provider === "ollama") {
    available = true;
    reason = `local/free provider at ${host} (model ${model || "(unset)"})`;
  } else if (provider === "openai") {
    if (!apiKeyPresent) reason = "openai provider requires OPENAI_API_KEY (unset)";
    else if (!approved) reason = "openai is a PAID API — requires approval (DFC_EMBED_APPROVED=1 or --approve)";
    else {
      available = true;
      reason = `approved PAID provider (model ${model})`;
    }
  } else {
    reason = `unknown provider "${provider}"`;
  }

  return { provider, model, modelKey: `${provider}:${model}`, dimension, host, paid, apiKeyPresent, approved, available, reason };
}

/** Embed one string. Throws for non-embedding providers or when a gate is closed. */
export async function embedText(cfg: EmbedConfig, text: string): Promise<number[]> {
  if (cfg.provider === "ollama") {
    const res = await fetch(`${cfg.host}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, prompt: text }),
    });
    if (!res.ok) throw new Error(`ollama embeddings HTTP ${res.status}`);
    const json = (await res.json()) as { embedding?: number[] };
    if (!Array.isArray(json.embedding)) throw new Error("ollama: no embedding in response");
    return json.embedding;
  }
  if (cfg.provider === "openai") {
    // Hard gate: never reach the paid API without key + approval.
    const apiKey = getEmbedEnv("OPENAI_API_KEY");
    if (!apiKey || !cfg.approved) {
      throw new Error("openai embeddings blocked: requires OPENAI_API_KEY and explicit approval");
    }
    const body: { model: string; input: string; dimensions?: number } = { model: cfg.model, input: text };
    if (cfg.dimension > 0 && supportsOpenAiDimensions(cfg.model)) body.dimensions = cfg.dimension;
    const res = await fetch(`${cfg.host}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`openai embeddings HTTP ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const emb = json.data?.[0]?.embedding;
    if (!Array.isArray(emb)) throw new Error("openai: no embedding in response");
    return emb;
  }
  throw new Error(`provider "${cfg.provider}" cannot embed (dry-run only)`);
}

export interface EmbedTarget {
  source_type: string;
  source_id: string;
  chunk_id: string;
  text: string;
  content_hash: string;
}

/** Dry-run/local candidate set: chunk the repo docs in-memory (no DB). */
export function gatherLocalTargets(
  root: string,
  repoId: string,
  sourceAgent: SourceAgent,
  limit: number,
  now: string,
): EmbedTarget[] {
  const plan = buildDocPlan(root, repoId, sourceAgent, now);
  const out: EmbedTarget[] = [];
  for (const d of plan.documents) {
    for (const c of d.chunks) {
      out.push({
        source_type: "doc_chunk",
        source_id: `${c.source_path}#${c.chunk_index}`,
        chunk_id: `${c.source_path}#${c.chunk_index}`,
        text: c.text,
        content_hash: c.content_hash,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Live candidate set: doc_chunk rows not yet embedded for this model (skip-existing). */
export async function gatherDbTargets(
  db: Surreal,
  repoId: string,
  modelKey: string,
  limit: number,
): Promise<EmbedTarget[]> {
  const chunks = await queryResult<Array<{ source_path?: string; chunk_index?: number; text?: string; content_hash?: string }>>(
    db,
    `SELECT source_path, chunk_index, text, content_hash FROM doc_chunk WHERE repo_id = $repo LIMIT 1000`,
    { repo: repoId },
  );
  const existing = await queryResult<Array<{ content_hash?: string }>>(
    db,
    `SELECT content_hash FROM embedding_chunk WHERE repo_id = $repo AND embedding_model = $m`,
    { repo: repoId, m: modelKey },
  );
  const have = new Set(existing.map((e) => String(e.content_hash)));
  const out: EmbedTarget[] = [];
  for (const c of chunks) {
    const hash = String(c.content_hash || "");
    if (!c.text || !hash || have.has(hash)) continue;
    const sid = `${c.source_path}#${c.chunk_index}`;
    out.push({ source_type: "doc_chunk", source_id: sid, chunk_id: sid, text: c.text, content_hash: hash });
    if (out.length >= limit) break;
  }
  return out;
}

export interface EmbedResult {
  embedded: number;
  skipped: number;
  errors: number;
  dimension: number;
}

/** Embed targets and upsert embedding_chunk rows + the embedding_model registry. */
export async function embedChunks(
  db: Surreal,
  cfg: EmbedConfig,
  repoId: string,
  targets: EmbedTarget[],
): Promise<EmbedResult> {
  let embedded = 0;
  let skipped = 0;
  let errors = 0;
  let dimension = cfg.dimension;
  const now = new Date().toISOString();

  // If a model is already registered, its dimension is authoritative unless an
  // OpenAI v3 model explicitly requested dimensions for this run.
  const registered = await queryResult<EmbeddingModelRecord[]>(
    db,
    `SELECT * FROM embedding_model WHERE repo_id = $repo AND provider = $p AND model = $m LIMIT 1`,
    { repo: repoId, p: cfg.provider, m: cfg.model },
  );
  const requestedOpenAiDimension =
    cfg.provider === "openai" && supportsOpenAiDimensions(cfg.model) && cfg.dimension > 0;
  if (registered[0]?.dimension && !requestedOpenAiDimension) dimension = registered[0].dimension;

  for (const t of targets) {
    let vec: number[];
    try {
      vec = await embedText(cfg, t.text);
    } catch {
      errors++;
      continue;
    }
    if (!vec.length) {
      errors++;
      continue;
    }
    if (dimension === 0) dimension = vec.length;
    if (vec.length !== dimension) {
      skipped++; // dimension mismatch with the pinned model — never store
      continue;
    }
    const key = sha256(`${repoId}:${cfg.modelKey}:${t.content_hash}`);
    const row: EmbeddingChunkRecord = {
      repo_id: repoId,
      source_type: t.source_type,
      source_id: t.source_id,
      chunk_id: t.chunk_id,
      text: t.text.slice(0, 8000),
      embedding: vec,
      embedding_model: cfg.modelKey,
      embedding_dimension: dimension,
      provider: cfg.provider,
      content_hash: t.content_hash,
      created_at: now,
      updated_at: now,
    };
    await db.upsert(new RecordId("embedding_chunk", key)).content(row as unknown as Record<string, unknown>);
    embedded++;
  }

  if (embedded > 0) {
    const mkey = sha256(`${repoId}:${cfg.modelKey}`);
    const modelRow: EmbeddingModelRecord = {
      repo_id: repoId,
      provider: cfg.provider,
      model: cfg.model,
      dimension,
      created_at: registered[0]?.created_at || now,
      updated_at: now,
    };
    await db.upsert(new RecordId("embedding_model", mkey)).content(modelRow as unknown as Record<string, unknown>);
  }

  return { embedded, skipped, errors, dimension };
}

/** Cosine-rank stored embeddings against a freshly embedded query. Returns [] if unavailable. */
export async function queryVectors(
  db: Surreal,
  cfg: EmbedConfig,
  repoId: string,
  queryText: string,
  limit: number,
): Promise<ContextVectorChunkEntry[]> {
  if (!cfg.available) return [];
  let qvec: number[];
  try {
    qvec = await embedText(cfg, queryText);
  } catch {
    return [];
  }
  const rows = await queryResult<Array<{ source_type?: string; source_id?: string; chunk_id?: string; text?: string; embedding?: number[] }>>(
    db,
    `SELECT source_type, source_id, chunk_id, text, embedding FROM embedding_chunk
     WHERE repo_id = $repo AND embedding_model = $m LIMIT 2000`,
    { repo: repoId, m: cfg.modelKey },
  );
  return rows
    .map((r) => {
      const sim = cosineSimilarity(qvec, Array.isArray(r.embedding) ? r.embedding : []);
      return {
        source_type: r.source_type || "",
        source_id: r.source_id || "",
        chunk_id: r.chunk_id || "",
        excerpt: (r.text || "").slice(0, 220).replace(/\s+/g, " ").trim(),
        similarity: Math.round(sim * 1000) / 1000,
        score: Math.round(sim * 40 * 100) / 100,
      };
    })
    .filter((e) => e.similarity > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---- doctor / gc helpers ----------------------------------------------------

export async function countRows(db: Surreal, table: string, repoId: string): Promise<number> {
  const rows = await queryResult<Array<{ c?: number }>>(
    db,
    `SELECT count() AS c FROM type::table($t) WHERE repo_id = $repo GROUP ALL`,
    { t: table, repo: repoId },
  );
  return rows[0]?.c ?? 0;
}

export async function listEmbeddingModels(db: Surreal, repoId: string): Promise<EmbeddingModelRecord[]> {
  return await queryResult<EmbeddingModelRecord[]>(
    db,
    `SELECT * FROM embedding_model WHERE repo_id = $repo`,
    { repo: repoId },
  );
}

export interface GcCandidates {
  orphans: number; // embeddings whose source doc_chunk content_hash is gone
  mismatched: number; // embeddings whose dimension != its registered model dimension
  orphanHashes: string[];
}

/** Find embedding rows that should be garbage-collected (no deletes). */
export async function findGcCandidates(db: Surreal, repoId: string): Promise<GcCandidates> {
  const embs = await queryResult<Array<{ content_hash?: string; embedding_dimension?: number; embedding_model?: string; source_type?: string }>>(
    db,
    `SELECT content_hash, embedding_dimension, embedding_model, source_type FROM embedding_chunk WHERE repo_id = $repo`,
    { repo: repoId },
  );
  const docHashes = new Set(
    (await queryResult<Array<{ content_hash?: string }>>(
      db,
      `SELECT content_hash FROM doc_chunk WHERE repo_id = $repo`,
      { repo: repoId },
    )).map((r) => String(r.content_hash)),
  );
  const models = await listEmbeddingModels(db, repoId);
  const modelDim = new Map(models.map((m) => [`${m.provider}:${m.model}`, m.dimension]));

  let orphans = 0;
  let mismatched = 0;
  const orphanHashes: string[] = [];
  for (const e of embs) {
    const hash = String(e.content_hash || "");
    if (e.source_type === "doc_chunk" && hash && !docHashes.has(hash)) {
      orphans++;
      orphanHashes.push(hash);
      continue;
    }
    const dim = modelDim.get(String(e.embedding_model));
    if (dim && e.embedding_dimension && e.embedding_dimension !== dim) mismatched++;
  }
  return { orphans, mismatched, orphanHashes };
}

export interface GcResult {
  orphansRemoved: number;
  mismatchedRemoved: number;
}

/** Delete GC candidates found by findGcCandidates. */
export async function runGc(db: Surreal, repoId: string): Promise<GcResult> {
  const { orphans, mismatched, orphanHashes } = await findGcCandidates(db, repoId);
  if (orphanHashes.length) {
    await queryResults(
      db,
      `DELETE embedding_chunk WHERE repo_id = $repo AND source_type = 'doc_chunk' AND content_hash IN $h`,
      { repo: repoId, h: orphanHashes },
    );
  }
  const models = await listEmbeddingModels(db, repoId);
  for (const m of models) {
    await queryResults(
      db,
      `DELETE embedding_chunk WHERE repo_id = $repo AND embedding_model = $mk AND embedding_dimension != $dim`,
      { repo: repoId, mk: `${m.provider}:${m.model}`, dim: m.dimension },
    );
  }
  return { orphansRemoved: orphans, mismatchedRemoved: mismatched };
}
