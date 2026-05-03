#!/usr/bin/env bash
set -euo pipefail

LOGRUNNER_REMOTE_DIR="${LOGRUNNER_REMOTE_DIR:-/opt/logrunner-prod}"

echo "== deploy manifest =="
if [ -f "$LOGRUNNER_REMOTE_DIR/shared/deploy-manifest.json" ]; then
  cat "$LOGRUNNER_REMOTE_DIR/shared/deploy-manifest.json"
else
  echo "missing: $LOGRUNNER_REMOTE_DIR/shared/deploy-manifest.json"
fi

echo
echo "== current releases =="
readlink "$LOGRUNNER_REMOTE_DIR/current/runtime" || true
readlink "$LOGRUNNER_REMOTE_DIR/current/nanoclaw" || true

echo
echo "== services =="
systemctl is-active logrunner-prod.service || true
systemctl --no-pager --full status logrunner-prod.service | sed -n '1,20p' || true
if systemctl list-unit-files logrunner-prod-webhook.service >/dev/null 2>&1; then
  systemctl is-active logrunner-prod-webhook.service || true
  systemctl --no-pager --full status logrunner-prod-webhook.service | sed -n '1,16p' || true
fi
if systemctl list-unit-files caddy.service >/dev/null 2>&1; then
  systemctl is-active caddy.service || true
  systemctl --no-pager --full status caddy.service | sed -n '1,12p' || true
fi

echo
echo "== recent logs =="
journalctl -u logrunner-prod.service -n 80 --no-pager || true
