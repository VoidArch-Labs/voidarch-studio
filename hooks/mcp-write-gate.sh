#!/usr/bin/env bash
# dev-flow-control: gate write-like / expensive / external MCP actions.
# PreToolUse hook (matcher: mcp__.*). Exit 2 = block. FAILS CLOSED on empty/malformed payloads.
# Overrides are scoped approval records under .agent-runs/approvals/ whose tool_pattern matches
# the tool; broad .allow-mcp-writes is a deprecated fallback (DFC_ALLOW_LEGACY_FLAGS=1).
# GitKraken/Kepler owns Git workflow state, but write-like GitKraken actions still require approval.
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SELF_DIR/dfc-common.sh"

input="$(cat)"
dfc_guard_payload "$input" "MCP action"

tool="$(dfc_field "$input" '.tool_name')"
sid="$(dfc_field "$input" '.session_id')"
[ -z "${tool:-}" ] && exit 0

ltool="$(printf '%s' "$tool" | tr 'A-Z' 'a-z')"   # case-insensitive matching
is_write=""; reason=""

case "$tool" in
  mcp__github__*create*|mcp__github__*update*|mcp__github__*merge*|mcp__github__*delete*|mcp__github__*push*) is_write=1; reason="GitHub write" ;;
  mcp__*github*__*merge*|mcp__*github*__*delete*|mcp__*github*__*create_*) is_write=1; reason="GitHub destructive/create write" ;;
  mcp__firecrawl__firecrawl_crawl|mcp__firecrawl__firecrawl_map|mcp__firecrawl__firecrawl_extract|mcp__firecrawl__firecrawl_agent) is_write=1; reason="Firecrawl crawl/map/extract/agent mode" ;;
  mcp__agent-cli__jules_create_session|mcp__agent-cli__jules_api_create_session|mcp__agent-cli__jules_approve_plan|mcp__agent-cli__jules_remote_new|mcp__agent-cli__jules_remote_apply|mcp__agent-cli__jules_send_message) is_write=1; reason="Jules session/control action" ;;
  mcp__agent-cli__copilot_delegate|mcp__agent-cli__copilot_autopilot|mcp__agent-cli__copilot_fleet) is_write=1; reason="Copilot remote delegation" ;;
esac

# GitKraken / Kepler write-like actions (case-insensitive on the lowercased tool name).
# Read-only operations (status, graph, log, diff, blame, list, get_*, workspace_list, launchpad,
# fetch, pull) stay allowed.
if [ -z "$is_write" ]; then
  case "$ltool" in
    mcp__*gitkraken*__*|mcp__*gitlens*__*)
      case "$ltool" in
        *status*|*graph*|*_log*|*log_or_diff*|*diff*|*blame*|*get_*|*list*|*workspace_list*|*launchpad*|*fetch*|*pull*|*get_detail*|*get_comments*|*get_file_content*|*assigned_to_me*)
          : ;;  # read-only → allow
        *commit*|*push*|*merge*|*delete*|*create*|*open_pr*|*pull_request_create*|*stage*|*discard*|*reset*|*cleanup*|*work_end*|*add_or_commit*|*checkout*|*stash*|*worktree*|*resolve*|*start_work*|*start_review*|*add_comment*|*composer*)
          is_write=1; reason="GitKraken write-like action" ;;
        *) : ;;  # unknown GitKraken tool → default allow (read-bias; documented)
      esac
      ;;
  esac
fi

[ -z "$is_write" ] && exit 0   # read-only / unknown-but-not-write → allow

# Write-like: allow only with a valid scoped approval (or deprecated legacy flag).
if dfc_check_approval "$tool" "$sid"; then exit 0; fi
if dfc_check_approval "mcp:write" "$sid"; then exit 0; fi
if dfc_legacy_flag ".allow-mcp-writes"; then exit 0; fi

echo "BLOCKED by dev-flow-control: write-like MCP action '$tool' ($reason). Record a scoped approval under .agent-runs/approvals/ (approval-request skill) whose tool_pattern matches '$tool', then retry." >&2
exit 2
