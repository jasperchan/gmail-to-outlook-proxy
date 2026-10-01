#!/bin/bash
# copy the sqlite db to S3
source "$(dirname "$0")/common.sh"
if [ -z "${BACKUP_S3_URI:-}" ]; then
  echo "BACKUP_S3_URI not set, skipping backup"
  exit 0
fi
aws s3 cp data/db.sqlite "${BACKUP_S3_URI%/}/db_$(date +%Y%m%d%H%M%S).sqlite"
