#!/bin/bash
# shared setup: run from the repo root and load deploy/.env
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ -f deploy/.env ]; then
  set -a
  source deploy/.env
  set +a
fi
