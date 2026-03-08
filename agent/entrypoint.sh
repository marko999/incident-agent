#!/bin/sh
set -e

# Configure git to use GH_TOKEN for GitHub HTTPS operations
if [ -n "$GH_TOKEN" ]; then
  git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
  echo "$GH_TOKEN" | gh auth login --with-token 2>/dev/null || true
fi

exec python run.py "$@"
