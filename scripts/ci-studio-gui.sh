#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${DFC_DASHBOARD_PORT:-4949}"
URL="http://127.0.0.1:${PORT}"
PW_DIR="$(mktemp -d)"
LOG="$ROOT/artifacts/studio-server.log"
mkdir -p "$ROOT/artifacts"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$PW_DIR"
}
trap cleanup EXIT

cd "$ROOT"
pnpm dfc:dashboard --repo-root "$ROOT" --port "$PORT" >"$LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 90); do
  if curl --fail --silent "$URL/api/state" >/dev/null; then
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    cat "$LOG"
    exit 1
  fi
  sleep 1
done

curl --fail --silent "$URL/api/state" >/dev/null || {
  cat "$LOG"
  echo "Studio dashboard did not become ready" >&2
  exit 1
}

cd "$PW_DIR"
npm init -y >/dev/null
npm install --silent playwright@1.55.0
npx playwright install --with-deps chromium

cd "$ROOT"
NODE_PATH="$PW_DIR/node_modules" \
STUDIO_URL="$URL" \
STUDIO_SCREENSHOT="$ROOT/artifacts/studio-smoke.png" \
node scripts/ci-studio-gui.cjs
