#!/usr/bin/env bash

set -Eeuo pipefail

# Default checkout: the repository that contains this script (scripts/ops/..).
APP_DIR="${APP_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
# Account that runs git/npm when a script runs as root. Empty = owner of APP_DIR.
APP_OWNER="${APP_OWNER:-}"
SERVICE_NAME="${SERVICE_NAME:-deftrack.service}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/health/ready}"
ENV_FILE="${ENV_FILE:-${APP_DIR}/.env}"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

warn() {
  printf '[%s] WARNING: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

die() {
  printf '[%s] ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

read_env_value() {
  local key="$1"
  local file="${2:-$ENV_FILE}"
  local value

  [[ -f "$file" ]] || return 1
  value="$(awk -v key="$key" 'index($0, key "=") == 1 { value = substr($0, length(key) + 2) } END { print value }' "$file")"
  value="${value%$'\r'}"

  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}

resolve_mongo_uri() {
  if [[ -n "${MONGODB_URI:-}" ]]; then
    printf '%s' "$MONGODB_URI"
    return 0
  fi

  read_env_value MONGODB_URI "$ENV_FILE" || die "MONGODB_URI is not set and was not found in $ENV_FILE"
}

create_mongo_tool_config() {
  local mongo_uri="$1"
  local config_file
  local quoted_uri

  require_command mktemp
  require_command chmod
  require_command node

  config_file="$(mktemp)"
  chmod 600 "$config_file"
  # Pass the URI through the environment, not argv, so it never shows up in ps.
  quoted_uri="$(DEFTRACK_MONGO_URI="$mongo_uri" node -e 'process.stdout.write(JSON.stringify(process.env.DEFTRACK_MONGO_URI))')"
  printf 'uri: %s\n' "$quoted_uri" > "$config_file"
  printf '%s' "$config_file"
}

run_as_app() {
  local owner

  if [[ "$(id -u)" -ne 0 ]]; then
    "$@"
    return
  fi

  owner="$APP_OWNER"
  if [[ -z "$owner" ]]; then
    require_command stat
    owner="$(stat -L -c '%U' -- "$APP_DIR" 2>/dev/null || true)"
  fi
  [[ -n "$owner" && "$owner" != "UNKNOWN" ]] || die "APP_OWNER is not set and the owner of $APP_DIR could not be determined"

  if [[ "$owner" == "root" ]]; then
    "$@"
  else
    require_command sudo
    sudo -u "$owner" -- "$@"
  fi
}

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    require_command sudo
    sudo -- "$@"
  fi
}

canonical_path() {
  realpath -m -- "$1"
}

assert_path_within() {
  local candidate
  local base
  candidate="$(canonical_path "$1")"
  base="$(canonical_path "$2")"

  case "$candidate" in
    "$base"/*) printf '%s' "$candidate" ;;
    *) die "Path escapes the allowed directory: $candidate (base: $base)" ;;
  esac
}

wait_for_health() {
  local attempts="${1:-20}"
  local delay_seconds="${2:-2}"
  local response

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    response="$(curl --silent --show-error --fail --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
    if [[ "$response" == *'"status":"ok"'* ]]; then
      log "Health check passed: $HEALTH_URL"
      return 0
    fi
    sleep "$delay_seconds"
  done

  return 1
}
