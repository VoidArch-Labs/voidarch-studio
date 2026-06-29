#!/usr/bin/env bash
# dev-flow-control: observability logger. PostToolUse hook (matcher: *).
# Pure logging — NEVER blocks (always exit 0); logs a parse error if the payload is unreadable.
# Writes one JSON line per tool call to the session log .agent-runs/sessions/<id>/tools.jsonl
# (and a convenience aggregate .agent-runs/current.jsonl). Also records verification + graph use.
#
# NOTE: token/cache metrics are NOT available to hooks. Those come from Claude Code telemetry,
# the Session Report, or the observability-report skill — see templates/docs/observability.md.
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SELF_DIR/dfc-common.sh"

input="$(cat)"
ts="$(dfc_now_iso)"
sid="$(dfc_field "$input" '.session_id')"
sdir="$(dfc_session_dir "$sid")"
mkdir -p "$sdir" 2>/dev/null || true
slog="$sdir/tools.jsonl"
aggregate="$(dfc_proj)/.agent-runs/current.jsonl"

# Parse-error path (do not block; record what we can).
if dfc_have_jq && ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  printf '{"timestamp":"%s","session_id":"%s","hook":"PostToolUse","error":"unparseable payload"}\n' "$ts" "$sid" >> "$slog" 2>/dev/null || true
  exit 0
fi

tool="$(dfc_field "$input" '.tool_name')"
cmd="$(dfc_field "$input" '.tool_input.command')"
fp="$(dfc_field "$input" '.tool_input.file_path')"

# Split mcp__<server>__<tool> (pure bash).
mcp_server=""; mcp_tool=""
case "$tool" in
  mcp__*__*) rest="${tool#mcp__}"; mcp_server="${rest%%__*}"; mcp_tool="${rest#*__}" ;;
esac
lc_server="$(printf '%s' "$mcp_server" | tr 'A-Z' 'a-z')"

# Integration-usage booleans.
graph_used=false; case "$tool$cmd$fp" in *graphify*|*graph-context-scan*) graph_used=true ;; esac
c7=false;    [ "$lc_server" = "context7" ] && c7=true
fc=false;    [ "$lc_server" = "firecrawl" ] && fc=true
gk=false;    case "$lc_server" in *gitkraken*|*gitlens*) gk=true ;; esac
ghm=false;   [ "$lc_server" = "github" ] && ghm=true
jules=false; case "$tool$cmd" in *jules*) jules=true ;; esac

# Record verification activity (consumed by require-verification-before-ship.sh).
case "$cmd" in
  *test*|*lint*|*typecheck*|*tsc*|*"run build"*|*"run verify"*|*pytest*|*"go test"*|*"cargo test"*|*playwright*|*audit*|*"security"*)
    printf '{"verified_at":"%s","command":"%s"}\n' "$ts" "$(printf '%s' "$cmd" | tr -d '"')" > "$sdir/verification.json" 2>/dev/null || true ;;
esac
# Record graph usage (silences enforce-repo-graph-first.sh for the session).
[ "$graph_used" = true ] && printf '{"scanned_at":"%s","tool":"%s"}\n' "$ts" "${GRAPH_INDEX_TOOL:-graphify}" > "$sdir/graph-scanned.json" 2>/dev/null || true

# Build the structured event (spec field shape; hooks fill only what they can observe).
if dfc_have_jq; then
  line="$(printf '%s' "$input" | jq -c \
    --arg ts "$ts" --arg sid "$sid" --arg tool "$tool" --arg cmd "$cmd" --arg fp "$fp" \
    --arg mcp "$mcp_server" --arg mtool "$mcp_tool" \
    --argjson graph "$graph_used" --argjson c7 "$c7" --argjson fc "$fc" \
    --argjson gk "$gk" --argjson ghm "$ghm" --argjson jules "$jules" '{
      timestamp: $ts, run_id: "", session_id: $sid, task_id: "", gsd_phase: "",
      agent: "", subagent: "", skill: "", tool: $tool, mcp_server: $mcp, mcp_tool: $mtool,
      command: $cmd, file: $fp, files_read: [], files_changed: [],
      graph_used: $graph, context7_used: $c7, firecrawl_used: $fc, gitkraken_used: $gk,
      github_mcp_used: $ghm, jules_used: $jules,
      approval_id: "", approval_required: false, approval_status: "", result: "", error: ""
    }' 2>/dev/null)"
  [ -n "$line" ] || line="$(printf '{"timestamp":"%s","session_id":"%s","tool":"%s"}' "$ts" "$sid" "$tool")"
else
  line="$(printf '{"timestamp":"%s","session_id":"%s","tool":"%s","note":"jq unavailable"}' "$ts" "$sid" "$tool")"
fi

printf '%s\n' "$line" >> "$slog" 2>/dev/null || true
printf '%s\n' "$line" >> "$aggregate" 2>/dev/null || true

exit 0
