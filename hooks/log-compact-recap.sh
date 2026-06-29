#!/usr/bin/env bash
# dev-flow-control: log compaction events and prompt a recap. PreCompact hook (matcher: *).
# Pure logging — always exits 0. Re-arms the (session-scoped) repo-graph nudge after compaction.
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SELF_DIR/dfc-common.sh"

input="$(cat)"
ts="$(dfc_now_iso)"
sid="$(dfc_field "$input" '.session_id')"
sdir="$(dfc_session_dir "$sid")"
mkdir -p "$sdir" 2>/dev/null || true

trigger="$(dfc_field "$input" '.trigger')"

printf '{"timestamp":"%s","session_id":"%s","hook":"PreCompact","event":"compact","trigger":"%s"}\n' \
  "$ts" "$sid" "$trigger" >> "$sdir/tools.jsonl" 2>/dev/null || true
printf '{"timestamp":"%s","session_id":"%s","hook":"PreCompact","event":"compact","trigger":"%s"}\n' \
  "$ts" "$sid" "$trigger" >> "$(dfc_proj)/.agent-runs/current.jsonl" 2>/dev/null || true

# Re-arm the repo-graph nudge for the post-compaction stretch of work (session-scoped).
rm -f "$sdir/read-count" "$sdir/graph-warned" 2>/dev/null || true

echo "dev-flow-control: compaction imminent — recap key decisions, open files, current GSD phase, and any pending approval before context is compacted."
exit 0
