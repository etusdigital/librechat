#!/bin/sh
set -eu
SUITE_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$SUITE_DIR/../../.." && pwd)
: "${ETUS_DESIGN_DIR:=$ROOT/../etus-design}"
ETUS_DESIGN_DIR=$(cd "$ETUS_DESIGN_DIR" && pwd)
export ETUS_DESIGN_DIR
export E2E_RESULTS_DIR="${E2E_RESULTS_DIR:-$SUITE_DIR/.results}"
COMPOSE="docker compose -f $SUITE_DIR/compose.yml"

if [ "${E2E_SKIP_BUILD:-}" != "1" ]; then
  docker build -t etus-design-e2e/librechat:local --build-arg VITE_ETUS_HUB_URL=https://hub.etus.test "$ROOT"
  if [ -z "${ETUS_DESIGN_SERVICE_IMAGE:-}" ]; then
    docker build -t etus-design-e2e/design-service:local -f "$ETUS_DESIGN_DIR/design-service/Dockerfile" "$ETUS_DESIGN_DIR"
    docker build -t etus-design-e2e/design-renderer:local -f "$ETUS_DESIGN_DIR/design-service/renderer/Dockerfile" "$ETUS_DESIGN_DIR"
    docker build -t etus-design-e2e/design-egress:local "$ETUS_DESIGN_DIR/design-service/egress"
  fi
fi

rm -rf "$E2E_RESULTS_DIR"
mkdir -p "$E2E_RESULTS_DIR"
$COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
started=$(date +%s)
status=0
$COMPOSE up -d --build --wait api nginx design-service fake-llm edge || status=$?
if [ "$status" = "0" ]; then
  $COMPOSE run --rm tests || status=$?
fi
finished=$(date +%s)
$COMPOSE logs --no-color api design-service fake-idp-hub nginx > "$E2E_RESULTS_DIR/services.log" 2>&1 || true
if [ "${E2E_KEEP:-}" != "1" ]; then
  $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true
fi
echo "etus-design e2e: exit $status in $((finished - started)) s (results in $E2E_RESULTS_DIR)"
exit "$status"
