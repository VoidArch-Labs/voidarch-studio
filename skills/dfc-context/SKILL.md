---
description: Build an agent-neutral SurrealDB-backed dev-memory context pack for the current task. Use only when explicitly invoked before planning implementation work.
disable-model-invocation: true
allowed-tools: Bash
---

Run this shared CLI command and read the JSON output as planning context for the current task:

!`pnpm --dir "${CLAUDE_PLUGIN_ROOT:-.}" dfc:context --task "$ARGUMENTS" --agent claude --repo-root "${CLAUDE_PROJECT_DIR:-$PWD}"`

Use the returned JSON to guide planning:
- prefer listed files before broad repo reads
- treat decisions/evidence as prior context
- treat recent Codex/Claude agent runs and tool events as shared context
- respect approval-related workflow hints
- keep exact file reads narrow
- do not treat missing items as proof that no relevant context exists
- do not treat the context pack as complete truth
