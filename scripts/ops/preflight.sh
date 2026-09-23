#!/usr/bin/env bash

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

REQUIRE_CLEAN=0
SKIP_HEALTH=0

usage() {
  cat <<'EOF'
Usage: preflight.sh [options]

Read-only validation of the production checkout and service.

Options:
  --app-dir PATH    Application checkout (default: this checkout)
  --service NAME    systemd service (default: deftrack.service)
  --health-url URL  Readiness endpoint
  --require-clean   Fail if the Git worktree is dirty
  --skip-health     Do not query the running application
  -h, --help        Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-dir) APP_DIR="$2"; ENV_FILE="$APP_DIR/.env"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    --require-clean) REQUIRE_CLEAN=1; shift ;;
    --skip-health) SKIP_HEALTH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

require_command git
require_command node
require_command npm
require_command curl
require_command realpath

APP_DIR="$(canonical_path "$APP_DIR")"
[[ -d "$APP_DIR/.git" ]] || die "Not a Git checkout: $APP_DIR"
[[ -f "$APP_DIR/package.json" ]] || die "Root package.json not found: $APP_DIR"
[[ -f "$ENV_FILE" ]] || die "Environment file not found: $ENV_FILE"

branch="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
commit="$(git -C "$APP_DIR" rev-parse --short HEAD)"
dirty="$(git -C "$APP_DIR" status --porcelain)"

log "Checkout: $APP_DIR"
log "Git: $branch @ $commit"
log "Node: $(node --version), npm: $(npm --version)"

if [[ -n "$dirty" ]]; then
  if [[ "$REQUIRE_CLEAN" -eq 1 ]]; then
    die "Production worktree is dirty; refusing a state-changing operation"
  fi
  warn "Git worktree contains local changes"
else
  log "Git worktree: clean"
fi

resolve_mongo_uri >/dev/null
for key in RPC_HOST RPC_PORT RPC_USER RPC_PASS; do
  read_env_value "$key" "$ENV_FILE" >/dev/null || die "Required environment key is missing: $key"
done
log "Required database and RPC configuration keys are present (values hidden)"

# Optional node feeds have no built-in URL; an unset key silently disables the feed.
for key in DNS_SEEDER_API_URL PRE_RELEASE_NODES_API_URL; do
  if read_env_value "$key" "$ENV_FILE" >/dev/null; then
    log "Optional feed $key: configured"
  else
    log "Optional feed $key: not set (feed disabled)"
  fi
done

if command -v stat >/dev/null 2>&1; then
  env_mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
  # Warn on any group-write or other-user bit (mask 037); 600 and 640 pass.
  if [[ "$env_mode" =~ ^[0-7]{3,4}$ ]] && (( 8#$env_mode & 8#037 )); then
    warn "$ENV_FILE permissions are $env_mode (group-writable or accessible to other users); 600 or 640 is recommended"
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  service_state="$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || true)"
  log "Service $SERVICE_NAME: ${service_state:-unknown}"
else
  warn "systemctl is unavailable; service validation skipped"
fi

if [[ "$SKIP_HEALTH" -eq 0 ]]; then
  response="$(curl --silent --show-error --fail --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
  [[ "$response" == *'"status":"ok"'* ]] || die "Readiness check did not return status=ok: $HEALTH_URL"
  log "Readiness: ok"
fi

log "Preflight completed successfully"
