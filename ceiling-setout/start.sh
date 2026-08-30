#!/usr/bin/env bash
# Launcher for macOS and Linux. Does the same as start.bat: checks what it needs,
# installs once, then starts the app.
set -e
cd "$(dirname "$0")"

echo
echo "  Ceiling setout"
echo "  =============="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is not installed, and it is the only thing this needs."
  echo "  Get the LTS build from https://nodejs.org, then run this again."
  exit 1
fi

major=$(node -p "process.versions.node.split('.')[0]")
if [ "$major" -lt 20 ]; then
  echo "  Node.js 20 or newer is needed. This machine has $(node -v)."
  echo "  Install the current LTS from https://nodejs.org and run this again."
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "  Setting up pnpm..."
  corepack enable >/dev/null 2>&1 || npm install -g pnpm
fi

if [ ! -d node_modules ]; then
  echo "  Installing (first run only, about a minute)..."
  pnpm install
fi

echo
echo "  Starting. Open http://localhost:5173"
echo "  Ctrl-C here to stop."
echo
pnpm dev
