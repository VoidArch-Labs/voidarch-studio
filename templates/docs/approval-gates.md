# Approval Gates

Autonomy stops at irreversible or external side effects. The `approval-request` skill is the
human-readable gate; the hooks are the deterministic enforcement.

## Never without explicit approval

submit job applications · send emails/messages · pay/purchase · delete important files · run
destructive shell commands · deploy to production · access or expose secrets · write to production
databases · submit web forms · post publicly · change model/provider/billing routes · modify
security settings · merge PRs · push protected branches · **force-push or force-with-lease** ·
**write-like GitKraken/Kepler actions** · enable paid Firecrawl/API modes · start Jules API
sessions automatically.

## Present before approval

intended action · affected files/systems · diff or payload preview · risk · rollback option ·
billing / external side-effect status. The `approval-request` skill template covers all of these.

## Scoped approval records (preferred)

Broad root-level flags are **deprecated** (see below). The preferred mechanism is a **scoped
approval record** — a JSON file the user creates to authorize one specific gated action:

- Location: `.agent-runs/approvals/<name>.json` (global) or
  `.agent-runs/sessions/<session-id>/approvals/<name>.json` (session-scoped).
- Shape (see `templates/approval.example.json`):

```json
{
  "approval_id": "example-id",
  "approved_by": "user",
  "created_at": "2026-06-28T00:00:00Z",
  "expires_at": "2026-06-29T00:00:00Z",
  "single_use": true,
  "tool_pattern": "mcp__gitkraken__*create_pr*",
  "action": "create PR",
  "scope": { "repo": "", "branch": "", "files": [] },
  "reason": ""
}
```

How hooks use it:
- `tool_pattern` is matched (glob, case-insensitive fallback) against the tool name or command.
- `expires_at` is compared lexically as UTC ISO-8601 (`Z` suffix); expired records are ignored.
- `single_use: true` records are consumed on first match (a sibling `<name>.json.consumed` marker
  is written so they cannot be reused).
- Keep `tool_pattern` as narrow as possible. A pattern of `*` approves everything — avoid it.

## Deterministic enforcement (hooks)

| Gate | Hook | Override |
|---|---|---|
| Protected files (.env, secrets, creds, prod config) | `block-protected-files` | scoped approval (matching the path) — `.git/*` and private keys are **hard blocks** with no override |
| Lockfiles | `block-protected-files` | scoped approval |
| Destructive shell / deploy / DB drops / **force-with-lease** | `block-dangerous-shell` | scoped approval (matching the command) |
| GitKraken CLI write-like ops (`gk` commit/push/PR/merge/...) | `block-dangerous-shell` | scoped approval |
| GitHub MCP writes · Firecrawl crawl/extract · Jules/Copilot control · **GitKraken MCP writes** | `mcp-write-gate` | scoped approval (matching the tool) |
| Verification before Ship | `require-verification-before-ship` | warns by default; `.strict-verify` makes it block |

### Fail-closed on malformed payloads

The security hooks (`block-protected-files`, `block-dangerous-shell`, `mcp-write-gate`) **fail
closed**: if the tool payload is empty or unparseable JSON — or `jq` is unavailable — they exit 2
(block) rather than allowing the action through. `jq` is required for safe parsing; without it,
set `DFC_ALLOW_NO_JQ=1` only if you accept the reduced safety. Pure logging hooks never block;
they record a parse error instead.

### Deprecated broad flags

The old broad flags (`.allow-mcp-writes`, `.allow-destructive-shell`, `.allow-protected-edits`,
`.allow-dependency-changes`) are **deprecated and unsafe** — one flag silently approved a whole
class of actions, persistently. They are honored **only** when `DFC_ALLOW_LEGACY_FLAGS=1` is set,
and emit a deprecation warning when used. Migrate to scoped approval records.

## What hooks do NOT cover

Hooks cannot catch every external side effect. The human approval gate remains final — when in
doubt, present an `approval-request` and wait.
