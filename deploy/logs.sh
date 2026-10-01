#!/bin/bash
source "$(dirname "$0")/common.sh"
docker compose logs app -f -t "$@"
