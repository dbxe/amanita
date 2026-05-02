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

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env: $name" >&2
    exit 2
  fi
}

load_multibaas_backend() {
  if [ -n "${MULTIBAAS_BASE_URL:-}" ]; then
    return
  fi

  local file="${MULTIBAAS_BACKENDS_FILE:-$ROOT_DIR/.multibaas/backends.local.json}"
  if [ ! -f "$file" ]; then
    return
  fi

  local resolved
  resolved="$(MULTIBAAS_BACKENDS_FILE="$file" MULTIBAAS_PROFILE="${MULTIBAAS_PROFILE:-}" node --input-type=module <<'NODE'
import fs from 'node:fs';

const file = process.env.MULTIBAAS_BACKENDS_FILE;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const profileName = process.env.MULTIBAAS_PROFILE || data.defaultProfile;
const profile = profileName ? data.profiles?.[profileName] : undefined;
if (!profile?.baseUrl) process.exit(0);
const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
console.log(`MULTIBAAS_PROFILE=${quote(profileName)}`);
console.log(`MULTIBAAS_BASE_URL=${quote(profile.baseUrl)}`);
if (profile.apiKey) console.log(`MULTIBAAS_API_KEY=${quote(profile.apiKey)}`);
if (profile.networkName) console.log(`MULTIBAAS_NETWORK=${quote(profile.networkName)}`);
NODE
)"
  if [ -n "$resolved" ]; then
    eval "$resolved"
    export MULTIBAAS_PROFILE MULTIBAAS_BASE_URL MULTIBAAS_API_KEY MULTIBAAS_NETWORK
  fi
}

derive_openai_base_url() {
  if [ -n "${OPENAI_BASE_URL:-}" ] || [ -z "${OPENAI_CHAT_COMPLETIONS_URL:-}" ]; then
    return
  fi

  OPENAI_BASE_URL="$(node -e '
const url = new URL(process.argv[1]);
url.pathname = url.pathname.replace(/\/chat\/completions\/?$/, "");
console.log(url.toString().replace(/\/$/, ""));
' "$OPENAI_CHAT_COMPLETIONS_URL")"
  export OPENAI_BASE_URL
}

validate_model_settings() {
  if [ "${LOGRUNNER_AGENT_PROVIDER:-opencode}" != "opencode" ]; then
    return
  fi

  if [ -z "${OPENAI_BASE_URL:-}" ] && [ -z "${OPENCODE_BASE_URL:-}" ]; then
    echo "Missing required env for opencode: OPENAI_BASE_URL, OPENAI_CHAT_COMPLETIONS_URL, or OPENCODE_BASE_URL" >&2
    exit 2
  fi
  require OPENCODE_MODEL
  require OPENCODE_SMALL_MODEL
  case "$OPENCODE_MODEL:$OPENCODE_SMALL_MODEL" in
    *TODO_MODEL_ID*)
      echo "Replace OPENCODE_MODEL and OPENCODE_SMALL_MODEL with the deployed model id." >&2
      exit 2
      ;;
  esac
}

write_env() {
  local file="$1"
  local key="$2"
  local value="${!key:-}"
  if [ -n "$value" ]; then
    printf "%s=%q\n" "$key" "$value" >> "$file"
  fi
}

require LOGRUNNER_SSH_TARGET
load_multibaas_backend
derive_openai_base_url

LOGRUNNER_REMOTE_DIR="${LOGRUNNER_REMOTE_DIR:-/opt/logrunner-prod}"
NANOCLAW_REPO="${NANOCLAW_REPO:-git@github.com:dbxe/nanoclaw.git}"
NANOCLAW_REF="${NANOCLAW_REF:-openagents}"
LOGRUNNER_REF="${LOGRUNNER_REF:-$(git -C "$ROOT_DIR" rev-parse HEAD)}"
MULTIBAAS_BACKENDS_SOURCE_FILE="${MULTIBAAS_BACKENDS_FILE:-$ROOT_DIR/.multibaas/backends.local.json}"
validate_model_settings

if [ "${LOGRUNNER_ALLOW_DIRTY:-0}" != "1" ] && [ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=all)" ]; then
  echo "Working tree has uncommitted changes. Commit them or set LOGRUNNER_ALLOW_DIRTY=1." >&2
  exit 2
fi

(
  cd "$ROOT_DIR"
  npm test
)

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

archive="$tmp_dir/logrunner-$LOGRUNNER_REF.tar.gz"
git -C "$ROOT_DIR" archive --format=tar.gz -o "$archive" HEAD

combined_env="$tmp_dir/logrunner.env"
: > "$combined_env"
for key in \
  LOGRUNNER_REMOTE_DIR NANOCLAW_REPO NANOCLAW_REF LOGRUNNER_REF LOGRUNNER_AGENT_GROUP_ID LOGRUNNER_AGENT_PROVIDER \
  LOGRUNNER_AGENT_FOLDER LOGRUNNER_AGENT_NAME LOGRUNNER_DISCORD_PLATFORM_ID LOGRUNNER_DISCORD_MESSAGING_GROUP_ID \
  DISCORD_BOT_TOKEN DISCORD_APPLICATION_ID DISCORD_PUBLIC_KEY OPENAI_CHAT_COMPLETIONS_URL \
  OPENAI_BASE_URL OPENAI_API_KEY OPENAI_ONECLI_SECRET_NAME OPENAI_ONECLI_PATH_PATTERN \
  OPENCODE_PROVIDER OPENCODE_PROVIDER_NAME OPENCODE_PROVIDER_PACKAGE OPENCODE_MODEL \
  OPENCODE_SMALL_MODEL OPENCODE_BASE_URL OPENCODE_API_KEY ANTHROPIC_BASE_URL \
  ANTHROPIC_AUTH_TOKEN MULTIBAAS_BASE_URL MULTIBAAS_API_KEY ONECLI_URL ONECLI_API_KEY \
  MULTIBAAS_PROFILE MULTIBAAS_NETWORK LOGRUNNER_WEBHOOK_PUBLIC_URL MULTIBAAS_WEBHOOK_SECRET \
  MODEL_ONECLI_SECRET_NAME MODEL_ONECLI_PATH_PATTERN MULTIBAAS_ONECLI_SECRET_NAME \
  MULTIBAAS_ONECLI_PATH_PATTERN LOGRUNNER_REINSTALL_ONECLI ASSISTANT_NAME \
  MAX_MESSAGES_PER_PROMPT MAX_CONCURRENT_CONTAINERS TZ; do
  write_env "$combined_env" "$key"
done

ssh "$LOGRUNNER_SSH_TARGET" "mkdir -p '$LOGRUNNER_REMOTE_DIR/incoming' '$LOGRUNNER_REMOTE_DIR/shared' '$LOGRUNNER_REMOTE_DIR/tmp' && chmod 700 '$LOGRUNNER_REMOTE_DIR/shared'"
scp "$archive" "$LOGRUNNER_SSH_TARGET:$LOGRUNNER_REMOTE_DIR/incoming/logrunner-$LOGRUNNER_REF.tar.gz"
printf "LOGRUNNER_ARCHIVE=%q\n" "$LOGRUNNER_REMOTE_DIR/incoming/logrunner-$LOGRUNNER_REF.tar.gz" >> "$combined_env"
if [ -f "$MULTIBAAS_BACKENDS_SOURCE_FILE" ]; then
  remote_backends_file="$LOGRUNNER_REMOTE_DIR/shared/backends.source.local.json"
  scp "$MULTIBAAS_BACKENDS_SOURCE_FILE" "$LOGRUNNER_SSH_TARGET:$remote_backends_file"
  printf "MULTIBAAS_BACKENDS_FILE=%q\n" "$remote_backends_file" >> "$combined_env"
fi
scp "$combined_env" "$LOGRUNNER_SSH_TARGET:$LOGRUNNER_REMOTE_DIR/shared/logrunner.env"
scp "$ROOT_DIR/deploy/logrunner-prod/remote-deploy.sh" "$LOGRUNNER_SSH_TARGET:$LOGRUNNER_REMOTE_DIR/tmp/remote-deploy.sh"

ssh "$LOGRUNNER_SSH_TARGET" "chmod 700 '$LOGRUNNER_REMOTE_DIR/tmp/remote-deploy.sh' && bash '$LOGRUNNER_REMOTE_DIR/tmp/remote-deploy.sh'"
