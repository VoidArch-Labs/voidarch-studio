#!/usr/bin/env bash
# dev-flow-control: warn (or block) at Stop if files changed but no verification ran this session.
# Stop hook. Warn = exit 0 with message; strict block = exit 2 (touch .strict-verify).
# "Verification" is recorded by log-agent-run.sh in the session marker verification.json when a
# test/lint/typecheck/build command runs. Markers are session-scoped, so a stale marker from a
# previous session does not falsely satisfy this gate.
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SELF_DIR/dfc-common.sh"

input="$(cat)"
sid="$(dfc_field "$input" '.session_id')"

proj="$(dfc_proj)"
cd "$proj" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# Nothing changed → nothing to verify.
if git diff --quiet --ignore-submodules 2>/dev/null && \
   git diff --cached --quiet --ignore-submodules 2>/dev/null; then
  exit 0
fi

marker="$(dfc_session_dir "$sid")/verification.json"

# Newest mtime among changed tracked files.
newest=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  m="$(dfc_mtime "$f")"
  [ "$m" -gt "$newest" ] 2>/dev/null && newest="$m"
done < <(git status --porcelain 2>/dev/null | sed -E 's/^...//' | sed -E 's/.* -> //')

marker_time=0
[ -f "$marker" ] && marker_time="$(dfc_mtime "$marker")"

# Verified if a verification ran after the most recent change, this session.
if [ "$marker_time" -ge "$newest" ] 2>/dev/null && [ "$marker_time" -gt 0 ]; then
  exit 0
fi

msg="dev-flow-control: files changed but no verification (test/lint/typecheck/build) was recorded this session since the last change. Run verification before Ship (GSD Verify phase)."

if [ -f "$proj/.strict-verify" ]; then
  echo "$msg" >&2
  exit 2
fi

echo "$msg"
exit 0
