// nox config embedding local|openai-compatible — writes the embedding provider
// choice into .nox/config.json (creates it via the same defaults as `nox init`
// if missing). Never writes API keys — those stay in .dfc/embed.env.
//
//   nox config embedding local
//   nox config embedding openai-compatible

import { basename } from "node:path";
import { parseArgs, repoRootFromArgs } from "../src/cli.js";
import { NOX_CONFIG_SCHEMA_VERSION, noxConfigPath, readNoxConfig, writeNoxConfig } from "../src/nox-config.js";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function main(): void {
  const [choice] = process.argv.slice(2);
  if (choice !== "local" && choice !== "openai-compatible") {
    console.error("usage: nox config embedding <local|openai-compatible>");
    process.exit(2);
  }
  const args = parseArgs(process.argv.slice(3));
  const repoRoot = repoRootFromArgs(args);
  const existing = readNoxConfig(repoRoot);

  writeNoxConfig(repoRoot, {
    repoId: existing?.repoId || slugify(basename(repoRoot)),
    embedding: { provider: choice },
    createdAt: existing?.createdAt || new Date().toISOString(),
    schemaVersion: NOX_CONFIG_SCHEMA_VERSION,
  });

  console.log(`nox config embedding — ${noxConfigPath(repoRoot)} set to "${choice}"`);
  if (choice === "openai-compatible") {
    console.log(
      "  note: still requires DFC_EMBED_PROVIDER=openai + OPENAI_API_KEY + approval " +
        "(DFC_EMBED_APPROVED=1 or --approve) in .dfc/embed.env — this only sets the default provider.",
    );
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
