// nox snippets — print a ready-to-paste Claude Code slash-command snippet and an
// AGENTS.md snippet for wiring `nox` into a target repo's agent workflow (spec §9).
// No DB access, no args needed.

const SLASH_COMMAND = `---
description: Build a Nox context pack for the current task
---

Run \`npx nox context "$ARGUMENTS"\` and use the Markdown output as context
for the rest of this task. If it reports open blockers or required approvals,
surface those to the user before proceeding.
`;

const AGENTS_MD = `## Nox memory

This repo uses Nox for local repo memory and context packs. Before non-trivial
tasks, run:

\`\`\`bash
npx nox context "<short task description>"
\`\`\`

Use the returned Markdown (files, symbols, docs, memories, graph, state) as
grounding context. Record durable facts as you go:

\`\`\`bash
npx nox remember --kind decision "..."
npx nox remember --kind lesson "..."
npx nox remember --kind task_note "..."
\`\`\`

No API key required — Nox embeds locally by default.
`;

console.log("nox snippets\n");
console.log("--- Claude Code slash command: .claude/commands/nox-context.md ---\n");
console.log(SLASH_COMMAND);
console.log("--- AGENTS.md snippet ---\n");
console.log(AGENTS_MD);
