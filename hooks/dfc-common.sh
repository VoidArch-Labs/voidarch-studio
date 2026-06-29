#!/usr/bin/env bash
# dev-flow-control — shared hook helpers. SOURCED by hook scripts; not a hook itself
# (not referenced in hooks.json). Keeps fail-closed parsing, scoped approvals, and
# session-scoped markers consistent across hooks. Depends on bash + (ideally) jq.

# Project root.
dfc_proj() { printf '%s' "${CLAUDE_PROJECT_DIR:-.}"; }

# jq present?
dfc_have_jq() { command -v jq >/dev/null 2>&1; }

# Per-session run directory (task/session-specific). Arg1 = session_id (may be empty/null).
# Falls back to .agent-runs/sessions/current-session when no session id is available.
dfc_session_dir() {
  local sid="${1:-}"
  local base; base="$(dfc_proj)/.agent-runs/sessions"
  if [ -n "$sid" ] && [ "$sid" != "null" ]; then
    printf '%s/%s' "$base" "$sid"
  else
    printf '%s/current-session' "$base"
  fi
}

# Portable mtime (epoch seconds). Arg1 = path.
dfc_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }

# Current UTC timestamp, fixed-width ISO-8601 (lexically comparable).
dfc_now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "1970-01-01T00:00:00Z"; }

# Extract a jq path (e.g. .tool_input.file_path) from $1. Prints value or empty.
# Falls back to a crude grep when jq is unavailable.
dfc_field() {
  local json="$1" path="$2"
  if dfc_have_jq; then
    printf '%s' "$json" | jq -r "$path // empty" 2>/dev/null
  else
    local key; key="$(printf '%s' "$path" | sed -E 's/.*\.//')"
    printf '%s' "$json" | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 \
      | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'
  fi
}

# FAIL CLOSED for a security-sensitive hook when the payload cannot be trusted.
# Arg1 = raw payload, Arg2 = human label. Exits 2 (block) if the payload is empty,
# or malformed JSON, or jq is unavailable (unless DFC_ALLOW_NO_JQ=1 is explicitly set).
dfc_guard_payload() {
  local json="$1" label="${2:-security-sensitive action}"
  if [ -z "${json//[[:space:]]/}" ]; then
    echo "BLOCKED by dev-flow-control: empty/unreadable payload for ${label}. Failing closed." >&2
    exit 2
  fi
  if dfc_have_jq; then
    if ! printf '%s' "$json" | jq -e . >/dev/null 2>&1; then
      echo "BLOCKED by dev-flow-control: malformed payload for ${label} (could not parse JSON). Failing closed." >&2
      exit 2
    fi
  else
    if [ "${DFC_ALLOW_NO_JQ:-0}" != "1" ]; then
      echo "BLOCKED by dev-flow-control: 'jq' unavailable to safely parse payload for ${label}. Install jq, or set DFC_ALLOW_NO_JQ=1 (unsafe). Failing closed." >&2
      exit 2
    fi
  fi
}

# Scoped approval check (replaces broad root flags).
# Arg1 = target tool name or command string, Arg2 = session_id (optional).
# Scans .agent-runs/approvals/*.json and <session>/approvals/*.json for a record whose
# tool_pattern (glob) matches the target, is not expired, and (if single_use) not yet consumed.
# Consumes single-use approvals on match. Returns 0 if an approval applies, else 1.
dfc_check_approval() {
  local target="$1" sid="${2:-}"
  dfc_have_jq || return 1   # approval records require jq to parse safely
  local now; now="$(dfc_now_iso)"
  local d f pat exp single lt lp matched
  for d in "$(dfc_proj)/.agent-runs/approvals" "$(dfc_session_dir "$sid")/approvals"; do
    [ -d "$d" ] || continue
    for f in "$d"/*.json; do
      [ -f "$f" ] || continue
      case "$f" in *.consumed.json) continue ;; esac
      [ -f "$f.consumed" ] && continue
      jq -e . "$f" >/dev/null 2>&1 || continue
      pat="$(jq -r '.tool_pattern // empty' "$f" 2>/dev/null)"
      [ -n "$pat" ] || continue
      exp="$(jq -r '.expires_at // empty' "$f" 2>/dev/null)"
      single="$(jq -r '.single_use // false' "$f" 2>/dev/null)"
      if [ -n "$exp" ] && [ "$exp" != "null" ]; then
        if [[ "$exp" < "$now" || "$exp" == "$now" ]]; then continue; fi
      fi
      matched=0
      case "$target" in
        $pat) matched=1 ;;
        *)
          lt="$(printf '%s' "$target" | tr 'A-Z' 'a-z')"
          lp="$(printf '%s' "$pat" | tr 'A-Z' 'a-z')"
          case "$lt" in $lp) matched=1 ;; esac
          ;;
      esac
      [ "$matched" = 1 ] || continue
      [ "$single" = "true" ] && : > "$f.consumed" 2>/dev/null
      return 0
    done
  done
  return 1
}

# Deprecated broad flag fallback. Only honored when DFC_ALLOW_LEGACY_FLAGS=1.
# Arg1 = flag filename (e.g. .allow-mcp-writes). Returns 0 if honored, else 1.
dfc_legacy_flag() {
  local flag="$1"
  [ "${DFC_ALLOW_LEGACY_FLAGS:-0}" = "1" ] || return 1
  if [ -f "$(dfc_proj)/$flag" ]; then
    echo "dev-flow-control: WARNING — honoring DEPRECATED broad flag '${flag}'. Migrate to scoped approvals under .agent-runs/approvals/. Broad flags are unsafe and will be removed." >&2
    return 0
  fi
  return 1
}
