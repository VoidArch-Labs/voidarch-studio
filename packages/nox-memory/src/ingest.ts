// Repo text-file ingestion into SurrealDB.
// Default-deny by extension: only known text extensions are ingested, which
// inherently excludes binaries, images, archives, certs, and DB files. A small
// denylist covers risky names that would otherwise pass (real .env, lockfiles).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { RecordId, type Surreal } from "surrealdb";
import { sizeFromEnv, upsertBatches } from "./batch.js";
import { queryResult } from "./surreal.js";
import type { FileRecord, SourceAgent } from "./types.js";

const MAX_BYTES = 256 * 1024; // 256 KB
const DEFAULT_FILE_WRITE_BATCH_SIZE = 1;

const SKIP_DIRS = new Set<string>([
  ".git", "node_modules", "graphify-out", ".agent-runs", "dist", "build",
  "out", "coverage", ".next", ".turbo", ".cache", ".dfc", "vendor",
  ".venv", "venv", "__pycache__", ".idea", ".vscode",
]);

const SKIP_REL_DIR_PREFIXES = [
  ".claude/worktrees",
  ".codex/worktrees",
  ".agent-worktrees",
];

const ALLOWED_EXT = new Set<string>([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".mdx", ".txt",
  ".json", ".jsonc", ".surql", ".sql", ".sh", ".bash", ".zsh", ".yml",
  ".yaml", ".toml", ".ini", ".cfg", ".conf", ".html", ".css", ".scss",
  ".py", ".go", ".rs", ".rb", ".java", ".kt", ".c", ".h", ".cpp", ".hpp",
]);

const SKIP_EXACT = new Set<string>([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
  "Cargo.lock", "poetry.lock", "composer.lock", ".DS_Store",
]);

export interface IngestStats {
  scanned: number;
  ingested: number;
  skipped: number;
  unchanged: number;
  limited: number;
}

export interface IngestOptions {
  maxWrites?: number;
}

/** Decide whether a file (by name) holds secrets or noise we must never store. */
function isSecretOrNoise(name: string): boolean {
  if (SKIP_EXACT.has(name)) return true;
  if (/\.lock$/i.test(name)) return true;
  // Real dotenv files (.env, .env.local, .env.production), but allow templates.
  if (/^\.env(\..+)?$/i.test(name) && !/\.(example|sample|template)$/i.test(name)) {
    return true;
  }
  return false;
}

function isSkippedDir(root: string, full: string, name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  const rel = relative(root, full).replace(/\\/g, "/");
  return SKIP_REL_DIR_PREFIXES.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`));
}

/** Recursively collect ingestible file paths under `root`. */
function collectFiles(root: string, dir: string, acc: string[]): void {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory; skip silently
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isSkippedDir(root, full, entry.name)) continue;
      collectFiles(root, full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
}

/** Walk the repo, upsert eligible files into SurrealDB, return counts. */
export async function ingestRepo(
  db: Surreal,
  repoId: string,
  root: string,
  sourceAgent: SourceAgent = "manual",
  options: IngestOptions = {},
): Promise<IngestStats> {
  const all: string[] = [];
  collectFiles(root, root, all);

  const stats: IngestStats = { scanned: all.length, ingested: 0, skipped: 0, unchanged: 0, limited: 0 };
  const ingestedAt = new Date().toISOString();
  const writes: Array<{ key: string; record: FileRecord }> = [];
  const existing = await queryResult<Array<{ path?: string; content_hash?: string }>>(
    db,
    `SELECT path, content_hash FROM file WHERE repo_id = $repo`,
    { repo: repoId },
  );
  const existingByPath = new Map(
    existing
      .filter((row) => row.path && row.content_hash)
      .map((row) => [row.path as string, row.content_hash as string]),
  );

  for (const full of all) {
    const name = full.split("/").pop() ?? full;
    const ext = extname(name).toLowerCase();

    if (isSecretOrNoise(name) || !ALLOWED_EXT.has(ext)) {
      stats.skipped++;
      continue;
    }

    let st: import("node:fs").Stats;
    try {
      st = statSync(full);
    } catch {
      stats.skipped++;
      continue;
    }
    if (st.size > MAX_BYTES) {
      stats.skipped++;
      continue;
    }

    let content: string;
    try {
      content = readFileSync(full, "utf8");
    } catch {
      stats.skipped++;
      continue;
    }

    const path = relative(root, full);
    const record: FileRecord = {
      repo_id: repoId,
      source_agent: sourceAgent,
      path,
      ext,
      size: st.size,
      mtime: st.mtime.toISOString(),
      content,
      content_hash: createHash("sha256").update(content).digest("hex"),
      ingested_at: ingestedAt,
    };

    if (existingByPath.get(path) === record.content_hash) {
      stats.unchanged++;
      continue;
    }

    // Deterministic id keeps re-ingestion idempotent (one row per repo+path).
    const key = createHash("sha256").update(`${repoId}:${path}`).digest("hex");
    writes.push({ key, record });
  }

  const selectedWrites = options.maxWrites ? writes.slice(0, options.maxWrites) : writes;
  stats.limited = writes.length - selectedWrites.length;
  const batchSize = sizeFromEnv("DFC_FILE_WRITE_BATCH_SIZE", DEFAULT_FILE_WRITE_BATCH_SIZE);
  if (process.env.DFC_PROGRESS === "1") {
    console.error(
      `dfc:ingest progress: scanned=${stats.scanned} writes=${selectedWrites.length} limited=${stats.limited} unchanged=${stats.unchanged} skipped=${stats.skipped} batch_size=${batchSize}`,
    );
  }
  await upsertBatches(
    db,
    selectedWrites.map(({ key, record }) => ({
      id: new RecordId("file", key),
      record: record as unknown as Record<string, unknown>,
    })),
    batchSize,
  );
  stats.ingested = selectedWrites.length;

  // Record/refresh the repo row.
  await db.upsert(new RecordId("repo", repoId)).content({
    repo_id: repoId,
    source_agent: sourceAgent,
    root_path: root,
    file_count: stats.ingested + stats.unchanged,
    updated_at: ingestedAt,
  });

  return stats;
}
