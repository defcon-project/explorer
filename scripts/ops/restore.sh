#!/usr/bin/env bash

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups/mongodb}"
SELECTED_BACKUP=""
DRY_RUN=0
CONFIRMED=0
SERVICE_STOPPED=0
MONGO_CONFIG=""

usage() {
  cat <<'EOF'
Usage: restore.sh --backup PATH [options]

Restore a verified MongoDB dump. A safety backup is created first.

Options:
  --backup PATH      Backup directory below the configured backup root
  --dry-run          Validate only; do not stop services or modify MongoDB
  --yes              Required confirmation for a real restore
  --app-dir PATH     Application checkout (default: this checkout)
  --backup-dir PATH  Backup root (default: APP_DIR/backups/mongodb)
  --service NAME     systemd service (default: deftrack.service)
  --health-url URL   Readiness endpoint
  -h, --help         Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) SELECTED_BACKUP="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) CONFIRMED=1; shift ;;
    --app-dir) APP_DIR="$2"; ENV_FILE="$APP_DIR/.env"; BACKUP_DIR="$APP_DIR/backups/mongodb"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --service) SERVICE_NAME="$2"; shift 2 ;;
    --health-url) HEALTH_URL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

[[ -n "$SELECTED_BACKUP" ]] || die "--backup is required"
require_command mongorestore
require_command mongodump
require_command realpath
require_command curl

APP_DIR="$(canonical_path "$APP_DIR")"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="$(canonical_path "$BACKUP_DIR")"

if [[ "$SELECTED_BACKUP" != /* ]]; then
  SELECTED_BACKUP="$BACKUP_DIR/$SELECTED_BACKUP"
fi
SELECTED_BACKUP="$(assert_path_within "$SELECTED_BACKUP" "$BACKUP_DIR")"

[[ -d "$SELECTED_BACKUP" ]] || die "Backup directory not found: $SELECTED_BACKUP"
[[ -f "$SELECTED_BACKUP/.complete" ]] || die "Backup is incomplete or was not produced by the supported backup workflow"
collection_count="$(find "$SELECTED_BACKUP" -type f -name '*.bson.gz' | wc -l | tr -d ' ')"
[[ "$collection_count" -gt 0 ]] || die "Backup contains no BSON collections"
resolve_mongo_uri >/dev/null

log "Validated backup: $(basename "$SELECTED_BACKUP") ($collection_count collections)"
if [[ "$DRY_RUN" -eq 1 ]]; then
  log "Dry run complete; service and database state were not changed"
  exit 0
fi

[[ "$CONFIRMED" -eq 1 ]] || die "A real restore requires --yes"

cleanup() {
  [[ -z "$MONGO_CONFIG" ]] || rm -f -- "$MONGO_CONFIG"
  if [[ "$SERVICE_STOPPED" -eq 1 ]]; then
    run_privileged systemctl start "$SERVICE_NAME" || true
  fi
}
trap cleanup EXIT

log "Creating a safety backup before restore"
# Pass APP_DIR and ENV_FILE through the environment: backup.sh --app-dir would
# reset ENV_FILE to $APP_DIR/.env and ignore a custom ENV_FILE. --no-prune keeps
# the retention pass from deleting existing backups, including the selected one.
APP_DIR="$APP_DIR" ENV_FILE="$ENV_FILE" \
  bash "$SCRIPT_DIR/backup.sh" --backup-dir "$BACKUP_DIR" --no-prune >/dev/null

mongo_uri="$(resolve_mongo_uri)"
MONGO_CONFIG="$(create_mongo_tool_config "$mongo_uri")"
log "Stopping $SERVICE_NAME"
run_privileged systemctl stop "$SERVICE_NAME"
SERVICE_STOPPED=1

log "Restoring MongoDB with --drop"
mongorestore --config="$MONGO_CONFIG" --gzip --drop "$SELECTED_BACKUP"

log "Starting $SERVICE_NAME"
run_privileged systemctl start "$SERVICE_NAME"
SERVICE_STOPPED=0
rm -f -- "$MONGO_CONFIG"
MONGO_CONFIG=""

if ! wait_for_health 30 2; then
  run_privileged systemctl status "$SERVICE_NAME" --no-pager || true
  die "Restore completed, but application readiness did not recover"
fi

trap - EXIT
log "Restore completed successfully"
