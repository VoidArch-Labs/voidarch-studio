# Context7 — CLI + Skill mode (default)

The plugin's **default** for current library/API docs is Context7 via **CLI + Skill mode**, not a
dedicated MCP server. Rationale: lower overhead, no extra always-on server, and it fits the
"nothing loaded unless needed" principle.

## How it's used here

- The `docs-researcher` agent calls Context7 for version-sensitive docs: resolve the library ID,
  then query narrowly. Summaries only — never raw doc dumps into the main context.
- If a Context7 **skill** is installed in your environment, the agent/skill path is preferred.
- Only switch to the MCP server (`context7.mcp.optional.json`) if you specifically want it.

## Rules

- Use exact library IDs when known (format `/org/project`).
- Query with a specific question, not a single keyword.
- Read-only — no approval gate needed for queries.
- Do not use Context7 for general programming questions; it is for library/API/SDK/CLI docs.

## Open questions

See `templates/docs/research-gaps.md` for Context7 CLI-vs-MCP token cost, rate limits, and docs
coverage caveats to confirm before relying on it heavily.
