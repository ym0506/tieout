#!/bin/sh
# Runs the project's Forge CLI with a Node version it supports
# (Forge CLI 15 needs Node 22.23+ or 24.22+). Uses the newest Node 24 under ~/.nvm if present.
set -e
NODE24=$(ls -d "$HOME"/.nvm/versions/node/v24.* 2>/dev/null | sort -V | tail -1)
if [ -n "$NODE24" ]; then PATH="$NODE24/bin:$PATH"; export PATH; fi
cd "$(dirname "$0")/.."
exec ./node_modules/.bin/forge "$@"
