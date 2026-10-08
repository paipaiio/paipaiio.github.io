#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$PROJECT_DIR"

exec node --test --experimental-test-coverage \
  --test-coverage-include='**/assets/js/fastsearch.js' \
  --test-coverage-lines=80 --test-coverage-branches=80 --test-coverage-functions=80 \
  "$PROJECT_DIR"/tests/*.test.mjs
