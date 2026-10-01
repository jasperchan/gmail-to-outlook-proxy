#!/bin/bash
# Apply pending database migrations using the current build of the app image.
# db:migrate snapshots the database to data/backups/ first (keeps the last 3).
# Migrations must stay compatible with the previous release, which keeps running
# until deploy/update.sh restarts it.
source "$(dirname "$0")/common.sh"
docker compose build
docker compose run --rm --no-deps app npm run db:migrate
