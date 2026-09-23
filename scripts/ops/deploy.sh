#!/usr/bin/env bash

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

BRANCH="${DEPLOY_BRANCH:-main}"
DRY_RUN=0
SKIP_TESTS=0

usage() {
  cat <<'EOF'
Usage: deploy.sh [options]

Fast-forward deploy of the verified production checkout.

Options:
  --dry-run         Validate and print the plan without changing anything
  --skip-tests      Skip lint and CI tests (build still runs)
  --app-dir PATH    Application checkout (default: this checkout)
  --branch NAME     Remote branch (default: main)
  --service NAME    systemd service (default: deftrack.service)
  --health-url URL  Readiness endpoint
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --skip-tests) SKIP_TESTS=1; shift ;;
    --app-dir) APP_DIR="$2"; ENV_FILE="$APP_DIR/.env"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

APP_DIR="$(canonical_path "$APP_DIR")"

preflight_args=(--app-dir "$APP_DIR" --service "$SERVICE_NAME" --health-url "$HEALTH_URL" --require-clean)
bash "$SCRIPT_DIR/preflight.sh" "${preflight_args[@]}"

current_branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
[[ "$current_branch" == "$BRANCH" ]] || die "Checkout is on '$current_branch'; expected deployment branch '$BRANCH'"

log "Deploy plan: origin/$BRANCH -> $APP_DIR -> $SERVICE_NAME"
if [[ "$SKIP_TESTS" -eq 1 ]]; then
  warn "Lint and CI tests will be skipped"
fi
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "Dry run complete; no repository, dependency, build, or service state was changed"
  exit 0
fi

log "Fetching origin/$BRANCH"
run_as_app git -C "$APP_DIR" fetch --prune origin "$BRANCH"

log "Applying remote commit with fast-forward only"
run_as_app git -C "$APP_DIR" merge --ff-only "origin/$BRANCH"

log "Installing locked dependencies"
run_as_app npm --prefix "$APP_DIR" ci

if [[ "$SKIP_TESTS" -eq 0 ]]; then
  log "Running lint"
  run_as_app npm --prefix "$APP_DIR" run lint
  log "Running CI tests"
  run_as_app npm --prefix "$APP_DIR" run test:ci
fi

log "Building shared, server, and client workspaces"
run_as_app npm --prefix "$APP_DIR" run build

log "Restarting $SERVICE_NAME"
run_privileged systemctl restart "$SERVICE_NAME"

if ! wait_for_health 30 2; then
  run_privileged systemctl status "$SERVICE_NAME" --no-pager || true
  run_privileged journalctl -u "$SERVICE_NAME" -n 50 --no-pager || true
  die "Deployment completed but readiness did not recover"
fi

deployed_commit="$(git -C "$APP_DIR" rev-parse --short HEAD)"
log "Deploy completed successfully at commit $deployed_commit"
