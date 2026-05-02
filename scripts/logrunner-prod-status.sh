#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${LOGRUNNER_ENV_FILE:-$ROOT_DIR/deploy/logrunner-prod/.env.prod}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

if [ -z "${LOGRUNNER_SSH_TARGET:-}" ]; then
  echo "Missing required env: LOGRUNNER_SSH_TARGET" >&2
  exit 2
fi

LOGRUNNER_REMOTE_DIR="${LOGRUNNER_REMOTE_DIR:-/opt/logrunner-prod}"

scp "$ROOT_DIR/deploy/logrunner-prod/remote-status.sh" "$LOGRUNNER_SSH_TARGET:$LOGRUNNER_REMOTE_DIR/tmp/remote-status.sh"
ssh "$LOGRUNNER_SSH_TARGET" "chmod 700 '$LOGRUNNER_REMOTE_DIR/tmp/remote-status.sh' && LOGRUNNER_REMOTE_DIR='$LOGRUNNER_REMOTE_DIR' bash '$LOGRUNNER_REMOTE_DIR/tmp/remote-status.sh'"
