#!/usr/bin/env bash
# dev-flow-control: block destructive / irreversible / history-rewriting shell commands.
# PreToolUse hook (matcher: Bash). Exit 2 = block. FAILS CLOSED on empty/malformed payloads.
# Overrides are scoped approval records under .agent-runs/approvals/ whose tool_pattern matches
# the command; broad .allow-destructive-shell is a deprecated fallback (DFC_ALLOW_LEGACY_FLAGS=1).
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SELF_DIR/dfc-common.sh"

input="$(cat)"
dfc_guard_payload "$input" "shell command (Bash)"

cmd="$(dfc_field "$input" '.tool_input.command')"
sid="$(dfc_field "$input" '.session_id')"
[ -z "${cmd:-}" ] && exit 0

gate() { # $1 = reason
  local reason="$1"
  if dfc_check_approval "$cmd" "$sid"; then exit 0; fi
  if dfc_check_approval "bash:destructive" "$sid"; then exit 0; fi
  if dfc_legacy_flag ".allow-destructive-shell"; then exit 0; fi
  echo "BLOCKED by dev-flow-control: $reason. Record a scoped approval under .agent-runs/approvals/ (approval-request skill) whose tool_pattern matches this command, then retry." >&2
  exit 2
}

norm="$(printf '%s' "$cmd" | tr -s ' ')"

# Filesystem / disk destruction
case "$norm" in
  *"rm -rf"*|*"rm -fr"*|*"rm -r -f"*) gate "rm -rf (recursive force delete)" ;;
  *"mkfs"*|*"dd if="*|*"dd of=/dev/"*)  gate "disk-destructive command" ;;
  *":(){ :|:& };:"*) gate "fork bomb" ;;
esac

# Git history / branch destruction. force-with-lease is a "slightly safer chainsaw" — still a
# history rewrite, so it is approval-gated too.
case "$norm" in
  *"git reset --hard"*)                 gate "git reset --hard" ;;
  *"git clean -fd"*|*"git clean -fdx"*|*"git clean -xfd"*|*"git clean -df"*) gate "git clean -fd" ;;
  *"git branch -D"*)                    gate "git branch -D (force delete)" ;;
  *"git push --force-with-lease"*)      gate "git push --force-with-lease (history rewrite — safer than --force, still approval-gated)" ;;
  *"git push --force"*)                 gate "git push --force" ;;
  *"git push -f"*)                      gate "git push -f (force push)" ;;
esac

# Remote-piped execution
case "$norm" in
  *curl*"| sh"*|*curl*"| bash"*|*curl*"|sh"*|*curl*"|bash"*|*wget*"| sh"*|*wget*"| bash"*|*wget*"|sh"*|*wget*"|bash"*)
    gate "piping a remote download into a shell" ;;
esac

# Deployment / publish (external side effects)
case "$norm" in
  *"terraform destroy"*|*"kubectl delete"*|*"vercel --prod"*|*"vercel deploy --prod"*|*"npm publish"*|*"docker push"*|*"git push"*"--tags"*)
    gate "deployment/publish command — route through approval-request" ;;
esac

# Production database destruction (schema-level)
case "$norm" in
  *"drop database"*|*"DROP DATABASE"*|*"drop table"*|*"DROP TABLE"*|*"truncate table"*|*"TRUNCATE TABLE"*)
    gate "destructive database command" ;;
esac

# GitKraken CLI ('gk') write-like operations. Read-only gk (status/graph/log) stays allowed.
case "$norm" in
  *"gk "*commit*|*"gk "*push*|*"gk "*"pr create"*|*"gk "*"pr merge"*|*"gk "*merge*|*"gk "*"work end"*|*"gk "*discard*|*"gk "*reset*|*"gk "*cleanup*)
    gate "GitKraken CLI write-like action (commit/push/PR/merge/work-end/discard/reset/cleanup)" ;;
esac

exit 0
