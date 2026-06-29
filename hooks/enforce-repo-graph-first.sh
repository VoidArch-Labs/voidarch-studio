#!/usr/bin/env bash
# dev-flow-control: nudge toward a repo-graph scan before broad raw file reads.
# PreToolUse hook (matcher: Read|Grep|Glob). NEVER blocks — warns once per SESSION.
# Markers are session-specific (.agent-runs/sessions/<id>/...), so one stale global marker
# cannot silence the nudge forever.
#
# Config (env, with defaults):
#   GRAPH_INDEX_TOOL              (default: graphify)
#   GRAPH_INDEX_OUTPUT_DIR        (default: .agent-runs/graph)
#   GRAPH_INDEX_FRESHNESS_MINUTES (default: 60)
#   DFC_GRAPH_READ_THRESHOLD      (default: 4)
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SELF_DIR/dfc-common.sh"

input="$(cat)"   # not security-sensitive; do NOT fail closed
sid="$(dfc_field "$input" '.session_id')"
sdir="$(dfc_session_dir "$sid")"
mkdir -p "$sdir" 2>/dev/null || true

# Already scanned (fresh) or already warned this session → stay quiet.
[ -f "$sdir/graph-scanned.json" ] && exit 0
[ -f "$sdir/graph-warned" ] && exit 0

# Honor a fresh external graph output dir as "scanned" without a hook-set marker.
gdir="${GRAPH_INDEX_OUTPUT_DIR:-$(dfc_proj)/.agent-runs/graph}"
fresh_min="${GRAPH_INDEX_FRESHNESS_MINUTES:-60}"
if [ -d "$gdir" ] || [ -d "$(dfc_proj)/graphify-out" ]; then
  : > "$sdir/graph-scanned.json" 2>/dev/null || true
  exit 0
fi

counter="$sdir/read-count"
count=0
[ -f "$counter" ] && count="$(cat "$counter" 2>/dev/null || echo 0)"
case "$count" in ''|*[!0-9]*) count=0 ;; esac
count=$((count + 1))
printf '%s' "$count" > "$counter" 2>/dev/null || true

threshold="${DFC_GRAPH_READ_THRESHOLD:-4}"
if [ "$count" -ge "$threshold" ]; then
  : > "$sdir/graph-warned" 2>/dev/null || true
  echo "dev-flow-control: $count raw file reads without a repo-graph scan this session. For medium+ tasks, run graph-context-scan (${GRAPH_INDEX_TOOL:-graphify}) first to target reads and save tokens. (writing a fresh ${GRAPH_INDEX_OUTPUT_DIR:-.agent-runs/graph} silences this for the session)"
fi

exit 0
