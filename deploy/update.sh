#!/bin/bash
# pull and rebuild; refuses to run over local changes so the server never drifts
source "$(dirname "$0")/common.sh"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Tracked files have local changes, commit or move them to .env first:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
git pull --ff-only
docker compose up -d --build
