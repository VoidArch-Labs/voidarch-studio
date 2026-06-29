// Repo text-file ingestion into SurrealDB.
// Default-deny by extension: only known text extensions are ingested, which
// inherently excludes binaries, images, archives, certs, and DB files. A small
// denylist covers risky names that would otherwise pass (real .env, lockfiles).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { RecordId, type Surreal } from "surrealdb";
import type { FileRecord, SourceAgent } from "./types.js";

const MAX_BYTES = 256 * 1024; // 256 KB

const SKIP_DIRS = new Set<string>([
  ".git", "node_modules", "graphify-out", ".agent-runs", "dist", "build",
  "out", "coverage", ".next", ".turbo", ".cache", ".dfc", "vendor",
  ".venv", "venv", "__pycache__", ".idea", ".vscode",
]);

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
      if (SKIP_DIRS.has(entry.name)) continue;
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
): Promise<IngestStats> {
  const all: string[] = [];
  collectFiles(root, root, all);

  const stats: IngestStats = { scanned: all.length, ingested: 0, skipped: 0 };
  const ingestedAt = new Date().toISOString();

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

    // Deterministic id keeps re-ingestion idempotent (one row per repo+path).
    const key = createHash("sha256").update(`${repoId}:${path}`).digest("hex");
    await db.upsert(new RecordId("file", key)).content(record as unknown as Record<string, unknown>);
    stats.ingested++;
  }

  // Record/refresh the repo row.
  await db.upsert(new RecordId("repo", repoId)).content({
    repo_id: repoId,
    source_agent: sourceAgent,
    root_path: root,
    file_count: stats.ingested,
    updated_at: ingestedAt,
  });

  return stats;
}
