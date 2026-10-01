#!/bin/bash
# pull and rebuild; refuses to run over local changes so the server never drifts,
# and never restarts onto a database schema it hasn't been migrated to
source "$(dirname "$0")/common.sh"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Tracked files have local changes, commit or move them to .env first:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
git pull --ff-only
docker compose build
if ! docker compose run --rm --no-deps app npm run -s db:migrate -- --check; then
  echo "Database migrations are pending; the running version was left untouched." >&2
  echo "Review migrations/, run deploy/migrate.sh, then run deploy/update.sh again." >&2
  exit 1
fi
docker compose up -d
