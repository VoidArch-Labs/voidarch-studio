#!/usr/bin/env bash
# dev-flow-control: block Write/Edit to protected or sensitive files.
# PreToolUse hook (matcher: Write|Edit). Exit 2 = block (stderr fed back to Claude).
# FAILS CLOSED on empty/malformed payloads (security-sensitive). Overrides are scoped
# approval records under .agent-runs/approvals/; broad legacy flags are deprecated.
set -u
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
. "$SELF_DIR/dfc-common.sh"

input="$(cat)"
dfc_guard_payload "$input" "file write (Write/Edit)"

file_path="$(dfc_field "$input" '.tool_input.file_path // .tool_input.path')"
sid="$(dfc_field "$input" '.session_id')"
[ -z "${file_path:-}" ] && exit 0   # valid payload, but no file path to gate
base="$(basename "$file_path")"

# Hard blocks — never overridable.
hard_deny() {
  echo "BLOCKED by dev-flow-control: $1 ($file_path). Hard block — no override available." >&2
  exit 2
}
case "$file_path" in
  */.git/*|.git/*) hard_deny "git internals are protected" ;;
esac
case "$base" in
  *.pem|*.key|id_rsa|id_ed25519|*.pfx|*.p12) hard_deny "private key / certificate material is protected" ;;
esac

# Escapable blocks — overridable ONLY via a scoped approval (or deprecated legacy flag).
gate() { # $1 = reason, $2 = deprecated legacy flag name
  local reason="$1" flag="$2"
  if dfc_check_approval "$file_path" "$sid"; then exit 0; fi
  if dfc_check_approval "edit:protected" "$sid"; then exit 0; fi
  if dfc_legacy_flag "$flag"; then exit 0; fi
  echo "BLOCKED by dev-flow-control: $reason ($file_path). Record a scoped approval under .agent-runs/approvals/ (approval-request skill) whose tool_pattern matches this path, then retry." >&2
  exit 2
}

case "$base" in
  .env|.env.*)                 gate ".env files are protected" ".allow-protected-edits" ;;
  secrets.*|*.secret)          gate "secret files are protected" ".allow-protected-edits" ;;
  *credentials*|credentials.*) gate "credential files are protected" ".allow-protected-edits" ;;
esac
case "$file_path" in
  *production.*|*.production|*prod.config*|*.prod.env) gate "production config is protected" ".allow-protected-edits" ;;
esac
case "$base" in
  package-lock.json|pnpm-lock.yaml|yarn.lock|poetry.lock|Cargo.lock|Gemfile.lock|composer.lock|go.sum)
    gate "lockfile edits need dependency-change approval" ".allow-dependency-changes" ;;
esac

exit 0
