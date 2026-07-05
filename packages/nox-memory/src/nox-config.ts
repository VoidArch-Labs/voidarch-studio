// .nox/config.json — the target repo's own Nox config, written by `nox init` /
// `nox config embedding <provider>`. Read as the LOWEST-priority config source:
// process.env > .dfc/*.env files > .nox/config.json. Never holds secrets (no API
// keys) — just repoId, embedding provider choice, schema version, created timestamp.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const NOX_CONFIG_SCHEMA_VERSION = 1;

export interface NoxConfig {
  repoId: string;
  embedding: { provider: "local" | "openai-compatible" };
  createdAt: string;
  schemaVersion: number;
}

export function noxConfigPath(repoRoot: string): string {
  return join(repoRoot, ".nox", "config.json");
}

/** Read `.nox/config.json` for `repoRoot`, or null if absent/unparseable. */
export function readNoxConfig(repoRoot: string): NoxConfig | null {
  const path = noxConfigPath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as NoxConfig;
  } catch {
    return null;
  }
}

/** Flattened KEY=VALUE view of `.nox/config.json`, for merging as the lowest-priority
 *  config source alongside the .dfc env files. Only maps fields that have a direct
 *  env-var equivalent; never invents secrets. "openai-compatible" (spec naming) maps
 *  to the existing DFC_EMBED_PROVIDER=openai value — same paid gate, no new provider. */
export function noxConfigEnv(repoRoot: string): Record<string, string> {
  const cfg = readNoxConfig(repoRoot);
  if (!cfg) return {};
  const out: Record<string, string> = {};
  if (cfg.repoId) out.DFC_REPO_ID = cfg.repoId;
  if (cfg.embedding?.provider === "openai-compatible") out.DFC_EMBED_PROVIDER = "openai";
  else if (cfg.embedding?.provider === "local") out.DFC_EMBED_PROVIDER = "local";
  return out;
}

export function writeNoxConfig(repoRoot: string, cfg: NoxConfig): void {
  const path = noxConfigPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`);
}
