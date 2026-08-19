// dfc:init - scaffold a target repository so the installed dev-flow-control plugin
// can serve it: .dfc/ env templates (with per-repo DB identity), .gitignore entries,
// and optional CLAUDE.md / AGENTS.md from the bundled templates.
//
// Never overwrites existing files unless --force. Never copies credentials unless
// --copy-credentials is passed explicitly.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, repoRootFromArgs } from "@voidarch/context/cli";
import { isEmbeddedUrl, parseEnvFile } from "@voidarch/context/surreal";

const STUDIO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const GITIGNORE_LINES = [
  ".dfc/*.env",
  "!.dfc/*.example.env",
  ".dfc/dev-memory/",
  ".dfc/worktrees/",
  "graphify-out/",
  ".agent-runs/",
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

function rewriteRepoIdentity(template: string, repoId: string): string {
  const dbName = `repo_${repoId.replace(/-/g, "_")}`;
  return template
    .replace(/^DFC_REPO_ID=.*$/m, `DFC_REPO_ID=${repoId}`)
    .replace(/^DFC_SURREAL_DB=.*$/m, `DFC_SURREAL_DB=${dbName}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const targetRoot = repoRootFromArgs(args);
  const force = args.force === "true";

  if (targetRoot === STUDIO_ROOT) {
    console.error(
      "dfc:init targets another repository. Pass --repo-root /path/to/repo " +
        "(or set DFC_TARGET_STUDIO_ROOT / run from inside the target repo).",
    );
    process.exit(2);
  }
  if (!existsSync(targetRoot)) {
    console.error(`Target repo root does not exist: ${targetRoot}`);
    process.exit(2);
  }

  const repoId = args["repo-id"] || slugify(basename(targetRoot));
  const done: string[] = [];
  const skipped: string[] = [];

  // 1. .dfc/ with per-repo identity baked into the committed template.
  const targetDfc = join(targetRoot, ".dfc");
  mkdirSync(targetDfc, { recursive: true });
  const surrealTemplate = join(STUDIO_ROOT, ".dfc", "surreal.example.env");
  const surrealOut = join(targetDfc, "surreal.example.env");
  if (existsSync(surrealOut) && !force) {
    skipped.push(".dfc/surreal.example.env (exists; --force to overwrite)");
  } else {
    writeFileSync(surrealOut, rewriteRepoIdentity(readFileSync(surrealTemplate, "utf8"), repoId));
    done.push(`.dfc/surreal.example.env (DFC_REPO_ID=${repoId}, DFC_SURREAL_DB=repo_${repoId.replace(/-/g, "_")})`);
  }
  const embedTemplate = join(STUDIO_ROOT, ".dfc", "embed.example.env");
  const embedOut = join(targetDfc, "embed.example.env");
  if (existsSync(embedOut) && !force) {
    skipped.push(".dfc/embed.example.env (exists)");
  } else {
    copyFileSync(embedTemplate, embedOut);
    done.push(".dfc/embed.example.env");
  }

  // 2. Optionally seed real connection values from the plugin's own surreal.env
  //    (same instance, per-repo database). Explicit opt-in only.
  if (args["copy-credentials"] === "true") {
    // "Copy credentials" means the plugin's HOSTED instance. The plugin's own
    // surreal.env may point at its local embedded DB, so prefer the first env
    // file that actually carries hosted (non-embedded) connection values.
    let pluginEnv = parseEnvFile(join(STUDIO_ROOT, ".dfc", "surreal.env"));
    if (!pluginEnv.DFC_SURREAL_URL || isEmbeddedUrl(pluginEnv.DFC_SURREAL_URL)) {
      pluginEnv = parseEnvFile(join(STUDIO_ROOT, ".dfc", "surreal.hosted.env"));
    }
    const surrealEnvOut = join(targetDfc, "surreal.env");
    if (!pluginEnv.DFC_SURREAL_URL || isEmbeddedUrl(pluginEnv.DFC_SURREAL_URL)) {
      skipped.push(".dfc/surreal.env (plugin has no hosted credentials to copy)");
    } else if (existsSync(surrealEnvOut) && !force) {
      skipped.push(".dfc/surreal.env (exists)");
    } else {
      const lines = [
        `DFC_SURREAL_URL=${pluginEnv.DFC_SURREAL_URL}`,
        `DFC_SURREAL_NS=${pluginEnv.DFC_SURREAL_NS || "dev_flow_control"}`,
        `DFC_SURREAL_DB=repo_${repoId.replace(/-/g, "_")}`,
        `DFC_REPO_ID=${repoId}`,
        `DFC_SURREAL_USER=${pluginEnv.DFC_SURREAL_USER || ""}`,
        `DFC_SURREAL_PASS=${pluginEnv.DFC_SURREAL_PASS || ""}`,
        `DFC_SURREAL_AUTH_SCOPE=${pluginEnv.DFC_SURREAL_AUTH_SCOPE || "root"}`,
      ];
      writeFileSync(surrealEnvOut, lines.join("\n") + "\n", { mode: 0o600 });
      done.push(".dfc/surreal.env (credentials copied from plugin, per-repo database)");
    }
  }

  // 3. .gitignore entries.
  const gitignorePath = join(targetRoot, ".gitignore");
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const existingLines = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !existingLines.has(l));
  if (missing.length) {
    const block = (existing && !existing.endsWith("\n") ? "\n" : "") +
      "\n# dev-flow-control\n" + missing.join("\n") + "\n";
    appendFileSync(gitignorePath, block);
    done.push(`.gitignore (+${missing.length} entries)`);
  } else {
    skipped.push(".gitignore (already covered)");
  }

  // 4. Workflow-tool scripts → <target>/.claude/workflows/ (skip with --no-workflows).
  if (args["no-workflows"] !== "true") {
    const wfSrc = join(STUDIO_ROOT, "workflows");
    if (existsSync(wfSrc)) {
      const wfDst = join(targetRoot, ".claude", "workflows");
      mkdirSync(wfDst, { recursive: true });
      let copied = 0;
      for (const f of readdirSync(wfSrc).filter((f) => f.endsWith(".js"))) {
        const out = join(wfDst, f);
        if (existsSync(out) && !force) continue;
        copyFileSync(join(wfSrc, f), out);
        copied++;
      }
      if (copied) done.push(`.claude/workflows/ (+${copied} workflows: dfc-review, dfc-understand, dfc-preship)`);
      else skipped.push(".claude/workflows/ (all present)");
    }
  }

  // 5. Optional workflow templates.
  for (const [flag, template, outName] of [
    ["claude-md", "CLAUDE.md.template", "CLAUDE.md"],
    ["agents-md", "AGENTS.md.template", "AGENTS.md"],
  ] as const) {
    if (args[flag] !== "true") continue;
    const out = join(targetRoot, outName);
    if (existsSync(out) && !force) {
      skipped.push(`${outName} (exists; merge manually from templates/${template})`);
    } else {
      copyFileSync(join(STUDIO_ROOT, "templates", template), out);
      done.push(outName);
    }
  }

  console.log(`dfc:init — ${targetRoot} (repo id: ${repoId})`);
  for (const d of done) console.log(`  + ${d}`);
  for (const s of skipped) console.log(`  = ${s}`);
  console.log(`
Next steps (default = embedded SurrealKV at ${join(targetRoot, ".dfc/dev-memory")} — no credentials needed):
  1. Hosted instead? Create ${join(targetRoot, ".dfc/surreal.env")} from the example's wss:// block
     (or rerun with --copy-credentials to reuse the plugin's hosted instance with a per-repo DB).
  2. Verify:   pnpm --dir ${STUDIO_ROOT} dfc:db:check   --repo-root ${targetRoot}
  3. Migrate:  pnpm --dir ${STUDIO_ROOT} dfc:db:migrate --repo-root ${targetRoot}
  4. Ingest:   pnpm --dir ${STUDIO_ROOT} dfc:ingest     --repo-root ${targetRoot} --limit 50
  5. Load the plugin in the target repo:  claude --plugin-dir ${STUDIO_ROOT}
  6. Dashboard: pnpm --dir ${STUDIO_ROOT} dfc:dashboard --repo-root ${targetRoot}`);
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
