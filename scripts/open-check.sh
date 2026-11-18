#!/usr/bin/env bash
# Open one .xmind in a freshly restarted original XMind and report whether it renders.
# Usage: bash scripts/open-check.sh <file.xmind> [file2 ...]
set -u
cd "$(dirname "$0")/.." || exit 1

kill_xmind() {
  powershell -NoProfile -Command "Get-Process Xmind -ErrorAction SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1
  for _ in $(seq 1 20); do
    n=$(tasklist | grep -ci '^Xmind.exe' || true)
    [ "$n" = "0" ] && return 0
    sleep 0.3
  done
}

for f in "$@"; do
  kill_xmind
  python scripts/launch-orig-xmind.py "$f" > target/verify/launch-last.log 2>&1
  sleep 3
  printf '%-40s ' "$(basename "$f")"
  node scripts/orig-windows.mjs 2>/dev/null | tail -1
done
