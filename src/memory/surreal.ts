// Hosted SurrealDB connection + config loading for the dev-memory slice.
// Uses the official SurrealDB TypeScript SDK package ("surrealdb").

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Surreal } from "surrealdb";
import type { QueryResponse } from "surrealdb";
import type { DfcConfig } from "./types.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Repo root = two levels up from src/memory/ (resolved from this file, not cwd). */
export const REPO_ROOT = resolve(moduleDir, "..", "..");

/** Minimal KEY=VALUE .env parser (no dependency). Ignores blanks and # comments. */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

/**
 * Resolve configuration. Precedence (highest first):
 *   1. process.env
 *   2. .dfc/surreal.env       (real values, gitignored)
 *   3. .dfc/surreal.example.env (committed template / defaults)
 */
export function loadConfig(): DfcConfig {
  const dfcDir = join(REPO_ROOT, ".dfc");
  const fileEnv = {
    ...parseEnvFile(join(dfcDir, "surreal.example.env")),
    ...parseEnvFile(join(dfcDir, "surreal.env")),
  };
  const get = (k: string): string => (process.env[k] ?? fileEnv[k] ?? "").trim();

  return {
    url: get("DFC_SURREAL_URL"),
    namespace: get("DFC_SURREAL_NS") || "dev_flow_control",
    database: get("DFC_SURREAL_DB") || "repo_dev_flow_control",
    repoId: get("DFC_REPO_ID") || "dev-flow-control",
    username: get("DFC_SURREAL_USER"),
    password: get("DFC_SURREAL_PASS"),
    authScope: normalizeAuthScope(get("DFC_SURREAL_AUTH_SCOPE") || "root"),
  };
}

const PLACEHOLDER = /<[^>]+>/;

function normalizeAuthScope(value: string): DfcConfig["authScope"] {
  const scope = value.trim().toLowerCase();
  if (scope === "root" || scope === "namespace" || scope === "database") return scope;
  throw new Error("DFC_SURREAL_AUTH_SCOPE must be root, namespace, or database");
}

/** Throw a clear error if required fields are missing or still placeholders. */
export function assertUsableConfig(cfg: DfcConfig): void {
  const missing: string[] = [];
  const required: Array<[string, string]> = [
    ["DFC_SURREAL_URL", cfg.url],
    ["DFC_SURREAL_USER", cfg.username],
    ["DFC_SURREAL_PASS", cfg.password],
  ];
  for (const [name, value] of required) {
    if (!value || PLACEHOLDER.test(value)) missing.push(name);
  }
  if (missing.length) {
    throw new Error(
      `Missing/placeholder SurrealDB config: ${missing.join(", ")}. ` +
        `Copy .dfc/surreal.example.env to .dfc/surreal.env and fill in real values, ` +
        `or set the matching environment variables.`,
    );
  }
}

/** Connect, select namespace/database, authenticate. Caller closes the handle. */
export async function connect(cfg: DfcConfig): Promise<Surreal> {
  const db = new Surreal();
  await db.connect(cfg.url);
  await authenticate(db, cfg);
  await db.use({ namespace: cfg.namespace, database: cfg.database });
  return db;
}

export async function authenticate(db: Surreal, cfg: DfcConfig): Promise<void> {
  if (cfg.authScope === "database") {
    await db.signin({
      namespace: cfg.namespace,
      database: cfg.database,
      username: cfg.username,
      password: cfg.password,
    });
    return;
  }

  if (cfg.authScope === "namespace") {
    await db.signin({
      namespace: cfg.namespace,
      username: cfg.username,
      password: cfg.password,
    });
    return;
  }

  await db.signin({ username: cfg.username, password: cfg.password });
}

function queryErrorMessage(response: QueryResponse, index: number): string {
  if (response.success) return "";
  const error = response.error as unknown;
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message)
      : JSON.stringify(error);
  return `SurrealDB statement ${index} failed: ${message}`;
}

/**
 * Normalize SurrealDB SDK query responses into raw statement results. The SDK's
 * `.responses()` shape carries `{ success, result }`; callers should not repeat
 * that indexing and error handling throughout scripts.
 */
export async function queryResults<R extends unknown[] = unknown[]>(
  db: Surreal,
  query: string,
  bindings?: Record<string, unknown>,
): Promise<R> {
  const responses = (await db.query<R>(query, bindings).responses()) as QueryResponse<unknown>[];
  return responses.map((response, index) => {
    if (!response.success) throw new Error(queryErrorMessage(response, index));
    return response.result;
  }) as R;
}

export async function queryResult<T>(
  db: Surreal,
  query: string,
  bindings?: Record<string, unknown>,
): Promise<T> {
  const [first] = await queryResults<[T]>(db, query, bindings);
  return first;
}

/**
 * Run `fn` against a connected, authenticated client and always close the
 * connection afterwards (even on error).
 */
export async function withDb<T>(
  fn: (db: Surreal, cfg: DfcConfig) => Promise<T>,
): Promise<T> {
  const cfg = loadConfig();
  assertUsableConfig(cfg);
  const db = await connect(cfg);
  try {
    return await fn(db, cfg);
  } finally {
    try {
      await db.close();
    } catch {
      /* ignore close errors; connection may already be gone */
    }
  }
}
