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
case "$LOGRUNNER_SSH_TARGET" in
  *203.0.113.*|*REPLACE_WITH*)
    echo "Replace LOGRUNNER_SSH_TARGET with the actual VM SSH target before checking status." >&2
    exit 2
    ;;
esac

LOGRUNNER_REMOTE_DIR="${LOGRUNNER_REMOTE_DIR:-/opt/logrunner-prod}"
LOGRUNNER_SSH_KEY="${LOGRUNNER_SSH_KEY:-$HOME/.ssh/hetzner_logrunner_prod}"

ssh_args=(-o StrictHostKeyChecking=accept-new)
scp_args=(-o StrictHostKeyChecking=accept-new)
if [ -n "${LOGRUNNER_SSH_KEY:-}" ]; then
  if [ ! -f "$LOGRUNNER_SSH_KEY" ]; then
    echo "SSH key not found: $LOGRUNNER_SSH_KEY" >&2
    exit 2
  fi
  ssh_args+=(-i "$LOGRUNNER_SSH_KEY")
  scp_args+=(-i "$LOGRUNNER_SSH_KEY")
fi

scp "${scp_args[@]}" "$ROOT_DIR/deploy/logrunner-prod/remote-status.sh" "$LOGRUNNER_SSH_TARGET:$LOGRUNNER_REMOTE_DIR/tmp/remote-status.sh"
ssh "${ssh_args[@]}" "$LOGRUNNER_SSH_TARGET" "chmod 700 '$LOGRUNNER_REMOTE_DIR/tmp/remote-status.sh' && LOGRUNNER_REMOTE_DIR='$LOGRUNNER_REMOTE_DIR' bash '$LOGRUNNER_REMOTE_DIR/tmp/remote-status.sh'"
