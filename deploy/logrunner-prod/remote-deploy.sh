#!/usr/bin/env bash
set -euo pipefail

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required env: $name" >&2
    exit 2
  fi
}

quote_env() {
  local key="$1"
  local value="${!key:-}"
  if [ -n "$value" ]; then
    printf "%s=%q\n" "$key" "$value"
  fi
}

run_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Need root or sudo to install remote prerequisites" >&2
    return 1
  fi
}

run_as_user() {
  local user="$1"
  shift
  if [ "$(id -un)" = "$user" ]; then
    "$@"
  elif command -v runuser >/dev/null 2>&1; then
    run_root runuser -u "$user" -- "$@"
  else
    run_root su -s /bin/bash "$user" -c "$(printf '%q ' "$@")"
  fi
}

apt_install() {
  run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

node_major() {
  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0
}

ensure_remote_prereqs() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "Remote bootstrap currently supports Ubuntu/Debian hosts with apt-get" >&2
    exit 2
  fi

  run_root env DEBIAN_FRONTEND=noninteractive apt-get update -y
  apt_install ca-certificates curl git gnupg docker.io docker-compose-v2 docker-buildx

  if [ "$(node_major)" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | run_root bash -
    apt_install nodejs
  fi

  run_root systemctl enable --now docker >/dev/null 2>&1 || true
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is installed but not reachable by $(whoami). Deploy as root or a user in the docker group." >&2
    exit 2
  fi

  if ! command -v pnpm >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@latest --activate
  fi
}

ensure_service_user() {
  if ! id "$LOGRUNNER_SERVICE_USER" >/dev/null 2>&1; then
    run_root useradd --create-home --shell /bin/bash "$LOGRUNNER_SERVICE_USER"
  fi
  run_root usermod -aG docker "$LOGRUNNER_SERVICE_USER"
}

extract_url() {
  grep -Eo 'https?://[A-Za-z0-9._:-]+' | head -n1 || true
}

onecli_api_host() {
  onecli config get api-host 2>/dev/null | node -e '
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  const trimmed = input.trim();
  try {
    const parsed = JSON.parse(trimmed);
    const value = parsed.data ?? parsed.value;
    if (typeof value === "string" && value) {
      console.log(value);
      return;
    }
  } catch {}
  const match = trimmed.match(/https?:\/\/[\w.\-]+(?::\d+)?/);
  if (match) console.log(match[0]);
});
' || true
}

ensure_onecli() {
  export PATH="$HOME/.local/bin:$PATH"

  if [ -n "${ONECLI_URL:-}" ]; then
    if ! command -v onecli >/dev/null 2>&1; then
      local cli_log="$LOGRUNNER_REMOTE_DIR/shared/onecli-cli-install.log"
      mkdir -p "$(dirname "$cli_log")"
      if ! curl -fsSL onecli.sh/cli/install | sh > "$cli_log" 2>&1; then
        echo "OneCLI CLI install failed. See $cli_log" >&2
        exit 2
      fi
    fi
    onecli config set api-host "$ONECLI_URL" >/dev/null 2>&1 || true
    return
  fi

  local existing_url=""
  if command -v onecli >/dev/null 2>&1; then
    existing_url="$(onecli_api_host)"
  fi
  if [ -n "$existing_url" ] && [ "${LOGRUNNER_REINSTALL_ONECLI:-0}" != "1" ]; then
    ONECLI_URL="$existing_url"
    export ONECLI_URL
    return
  fi

  echo "Installing OneCLI gateway and CLI on remote host..."
  local install_log="$LOGRUNNER_REMOTE_DIR/shared/onecli-install.log"
  mkdir -p "$(dirname "$install_log")"
  local output=""
  if ! output="$(curl -fsSL onecli.sh/install | sh 2>&1)"; then
    printf '%s\n' "$output" > "$install_log"
    echo "OneCLI gateway install failed. See $install_log" >&2
    exit 2
  fi
  printf '%s\n' "$output" > "$install_log"

  if ! command -v onecli >/dev/null 2>&1; then
    if ! curl -fsSL onecli.sh/cli/install | sh >> "$install_log" 2>&1; then
      echo "OneCLI CLI install failed. See $install_log" >&2
      exit 2
    fi
  fi

  local url=""
  url="$(printf '%s\n' "$output" | extract_url)"
  if [ -z "$url" ]; then
    url="$(onecli_api_host)"
  fi
  if [ -z "$url" ]; then
    echo "Could not determine OneCLI URL after install. See $install_log" >&2
    exit 2
  fi

  onecli config set api-host "$url" >/dev/null 2>&1 || true
  ONECLI_URL="$url"
  export ONECLI_URL
}

host_from_url() {
  node -e 'console.log(new URL(process.argv[1]).hostname)' "$1"
}

scheme_from_url() {
  node -e 'console.log(new URL(process.argv[1]).protocol)' "$1"
}

ensure_caddy_proxy() {
  if [ "${LOGRUNNER_ENABLE_CADDY:-1}" != "1" ]; then
    return
  fi

  local scheme host
  scheme="$(scheme_from_url "$LOGRUNNER_WEBHOOK_PUBLIC_URL")"
  if [ "$scheme" != "https:" ]; then
    echo "Skipping Caddy because LOGRUNNER_WEBHOOK_PUBLIC_URL is not HTTPS."
    return
  fi

  host="$(host_from_url "$LOGRUNNER_WEBHOOK_PUBLIC_URL")"
  apt_install caddy
  run_root tee /etc/caddy/Caddyfile >/dev/null <<CADDY
$host {
  reverse_proxy 127.0.0.1:8787
}
CADDY
  run_root systemctl enable --now caddy >/dev/null
  run_root systemctl reload caddy
}

backend_profile_names() {
  node --input-type=module <<'NODE'
import fs from 'node:fs';

const file = process.env.MULTIBAAS_BACKENDS_FILE;
if (file && fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const profileName of Object.keys(data.profiles ?? {}).sort()) {
    if (data.profiles?.[profileName]?.baseUrl) {
      console.log(profileName);
    }
  }
  process.exit(0);
}

console.log(process.env.MULTIBAAS_PROFILE || 'live');
NODE
}

write_runtime_backend_configs() {
  local runtime_release="$1"
  local host_file="$LOGRUNNER_REMOTE_DIR/shared/backends.host.runtime.json"
  local container_file="$runtime_release/.multibaas/backends.local.json"

  mkdir -p "$(dirname "$host_file")" "$(dirname "$container_file")"
  HOST_MULTIBAAS_BACKENDS_FILE="$host_file" \
  CONTAINER_MULTIBAAS_BACKENDS_FILE="$container_file" \
  STATE_ROOT="$LOGRUNNER_REMOTE_DIR/shared/runtime-state" \
  node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';

function safeName(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]/g, '_');
}

function readSourceConfig() {
  const file = process.env.MULTIBAAS_BACKENDS_FILE;
  if (file && fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  const profileName = process.env.MULTIBAAS_PROFILE || 'live';
  if (!process.env.MULTIBAAS_BASE_URL) {
    throw new Error('Missing MULTIBAAS_BASE_URL and no MULTIBAAS_BACKENDS_FILE was provided');
  }

  return {
    defaultProfile: profileName,
    profiles: {
      [profileName]: {
        apiKey: process.env.MULTIBAAS_API_KEY,
        baseUrl: process.env.MULTIBAAS_BASE_URL,
        networkName: process.env.MULTIBAAS_NETWORK || profileName,
      },
    },
  };
}

const source = readSourceConfig();
const hostConfig = {
  defaultProfile: process.env.MULTIBAAS_PROFILE || source.defaultProfile || Object.keys(source.profiles ?? {})[0],
  profiles: {},
};
const containerConfig = {
  defaultProfile: hostConfig.defaultProfile,
  profiles: {},
};

for (const [profileName, profile] of Object.entries(source.profiles ?? {})) {
  if (!profile?.baseUrl) continue;
  const safeProfileName = safeName(profileName);
  hostConfig.profiles[profileName] = {
    ...profile,
    stateDir: path.join(process.env.STATE_ROOT, safeProfileName),
  };
  containerConfig.profiles[profileName] = {
    ...profile,
    apiKey: 'placeholder',
    stateDir: `/workspace/agent/.agent-state/${safeProfileName}`,
  };
}

if (Object.keys(hostConfig.profiles).length === 0) {
  throw new Error('No MultiBaas backend profiles with baseUrl were found');
}

fs.writeFileSync(process.env.HOST_MULTIBAAS_BACKENDS_FILE, `${JSON.stringify(hostConfig, null, 2)}\n`, { mode: 0o600 });
fs.writeFileSync(process.env.CONTAINER_MULTIBAAS_BACKENDS_FILE, `${JSON.stringify(containerConfig, null, 2)}\n`);
NODE

  chmod 600 "$host_file"
  run_root chown "$LOGRUNNER_SERVICE_USER:$LOGRUNNER_SERVICE_USER" "$host_file"
  mkdir -p "$LOGRUNNER_REMOTE_DIR/shared/runtime-state"
  run_root chown -R "$LOGRUNNER_SERVICE_USER:$LOGRUNNER_SERVICE_USER" "$LOGRUNNER_REMOTE_DIR/shared/runtime-state"
  MULTIBAAS_BACKENDS_FILE="$host_file"
  export MULTIBAAS_BACKENDS_FILE
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

delete_matching_onecli_secrets() {
  local name="$1"
  onecli secrets list 2>/dev/null | SECRET_NAME="$name" node -e '
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(input);
    for (const secret of parsed.data ?? []) {
      if (secret.name === process.env.SECRET_NAME) {
        console.log(secret.id);
      }
    }
  } catch {}
});
' | while read -r id; do
    [ -n "$id" ] && onecli secrets delete --id "$id" >/dev/null 2>&1 || true
  done
}

create_onecli_generic_secret() {
  local name="$1"
  local value="$2"
  local host="$3"
  local path_pattern="$4"

  delete_matching_onecli_secrets "$name"
  onecli secrets create \
    --name "$name" \
    --type generic \
    --value "$value" \
    --host-pattern "$host" \
    --path-pattern "$path_pattern" \
    --header-name Authorization \
    --value-format 'Bearer {value}' >/dev/null
}

ensure_onecli_secrets() {
  if [ -z "${ONECLI_URL:-}" ]; then
    echo "ONECLI_URL was not set by ensure_onecli" >&2
    exit 2
  fi

  onecli config set api-host "$ONECLI_URL" >/dev/null 2>&1 || true
  if [ -n "${ONECLI_API_KEY:-}" ]; then
    onecli auth login --api-key "$ONECLI_API_KEY" >/dev/null 2>&1 || true
  fi

  local openai_secret="${OPENAI_API_KEY:-${OPENCODE_API_KEY:-}}"
  if [ -n "$openai_secret" ] && [ -n "${OPENAI_BASE_URL:-}" ]; then
    create_onecli_generic_secret \
      "${OPENAI_ONECLI_SECRET_NAME:-Logrunner OpenAI-Compatible Endpoint}" \
      "$openai_secret" \
      "$(host_from_url "$OPENAI_BASE_URL")" \
      "${OPENAI_ONECLI_PATH_PATTERN:-/v1/*}"
  fi

  if [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ] && [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
    create_onecli_generic_secret \
      "${MODEL_ONECLI_SECRET_NAME:-Logrunner Model Endpoint}" \
      "$ANTHROPIC_AUTH_TOKEN" \
      "$(host_from_url "$ANTHROPIC_BASE_URL")" \
      "${MODEL_ONECLI_PATH_PATTERN:-/v1/*}"
  fi

  node --input-type=module <<'NODE' | while IFS="$(printf '\t')" read -r profileName baseUrl apiKey; do
import fs from 'node:fs';

const file = process.env.MULTIBAAS_BACKENDS_FILE;
if (file && fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [profileName, profile] of Object.entries(data.profiles ?? {})) {
    if (profile?.baseUrl && profile?.apiKey) {
      console.log([profileName, profile.baseUrl, profile.apiKey].join('\t'));
    }
  }
  process.exit(0);
}

if (process.env.MULTIBAAS_BASE_URL && process.env.MULTIBAAS_API_KEY) {
  console.log([
    process.env.MULTIBAAS_PROFILE || 'live',
    process.env.MULTIBAAS_BASE_URL,
    process.env.MULTIBAAS_API_KEY,
  ].join('\t'));
}
NODE
    [ -z "$profileName" ] && continue
    create_onecli_generic_secret \
      "${MULTIBAAS_ONECLI_SECRET_NAME:-Logrunner MultiBaas} ($profileName)" \
      "$apiKey" \
      "$(host_from_url "$baseUrl")" \
      "${MULTIBAAS_ONECLI_PATH_PATTERN:-/api/v0/*}"
  done
}

redact_remote_logrunner_env() {
  if [ ! -f "$ENV_FILE" ]; then
    return
  fi

  local tmp
  tmp="$(mktemp)"
  grep -Ev '^(OPENAI_API_KEY|OPENCODE_API_KEY|ANTHROPIC_AUTH_TOKEN|MULTIBAAS_API_KEY)=' "$ENV_FILE" > "$tmp" || true
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

clone_ref() {
  local repo="$1"
  local ref="$2"
  local dest="$3"

  rm -rf "$dest"
  mkdir -p "$dest"
  git -C "$dest" init --quiet
  git -C "$dest" remote add origin "$repo"
  if ! git -C "$dest" fetch --quiet --depth 1 origin "$ref"; then
    git -C "$dest" fetch --quiet origin "$ref"
  fi
  git -C "$dest" checkout --quiet --detach FETCH_HEAD
  git -C "$dest" clean -ffdX --quiet
}

write_seed_script() {
  local nanoclaw_dir="$1"
  cat > "$nanoclaw_dir/.seed-logrunner-prod.ts" <<'TS'
import path from 'path';

import { DATA_DIR } from './src/config.js';
import { createAgentGroup, getAgentGroup } from './src/db/agent-groups.js';
import { initDb } from './src/db/connection.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroup,
  getMessagingGroupAgentByPair,
} from './src/db/messaging-groups.js';
import { runMigrations } from './src/db/migrations/index.js';
import { initGroupFilesystem } from './src/group-init.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const agentGroupId = process.env.LOGRUNNER_AGENT_GROUP_ID?.trim() || 'ag-logrunner-prod';
const agentProvider = process.env.LOGRUNNER_AGENT_PROVIDER?.trim() || 'opencode';
const folder = process.env.LOGRUNNER_AGENT_FOLDER?.trim() || 'logrunner-prod';
const name = process.env.LOGRUNNER_AGENT_NAME?.trim() || 'Logrunner Prod';
const messagingGroupId = process.env.LOGRUNNER_DISCORD_MESSAGING_GROUP_ID?.trim() || 'mg-logrunner-prod-discord';
const cliMessagingGroupId = process.env.LOGRUNNER_CLI_MESSAGING_GROUP_ID?.trim() || 'mg-logrunner-prod-cli';
const platformId = required('LOGRUNNER_DISCORD_PLATFORM_ID');
const now = new Date().toISOString();

const db = initDb(path.join(DATA_DIR, 'v2.db'));
runMigrations(db);

if (!getAgentGroup(agentGroupId)) {
  createAgentGroup({
    id: agentGroupId,
    name,
    folder,
    agent_provider: agentProvider,
    created_at: now,
  });
  console.log(`Created agent group ${agentGroupId} (${folder})`);
} else {
  db.prepare('UPDATE agent_groups SET name = ?, folder = ?, agent_provider = ? WHERE id = ?').run(
    name,
    folder,
    agentProvider,
    agentGroupId,
  );
  console.log(`Updated agent group ${agentGroupId} (${folder})`);
}

const agentGroup = getAgentGroup(agentGroupId);
if (!agentGroup) throw new Error(`Agent group not found after create: ${agentGroupId}`);
initGroupFilesystem(agentGroup, {
  instructions:
    `# ${name}\n\n` +
    'You are a production demo agent for live MultiBaas protocol intelligence. ' +
    'Use the MultiBaas runtime MCP tools for contract metadata, holder, concentration, control-event, investigation, and watch tasks. ' +
    'Keep public-channel replies concise and grounded in tool results.',
});

if (!getMessagingGroup(messagingGroupId)) {
  createMessagingGroup({
    id: messagingGroupId,
    channel_type: 'discord',
    platform_id: platformId,
    name: 'Logrunner Discord',
    is_group: 1,
    unknown_sender_policy: 'public',
    created_at: now,
  });
  console.log(`Created Discord messaging group ${messagingGroupId}`);
} else {
  db.prepare(
    'UPDATE messaging_groups SET channel_type = ?, platform_id = ?, name = ?, is_group = ?, unknown_sender_policy = ? WHERE id = ?',
  ).run('discord', platformId, 'Logrunner Discord', 1, 'public', messagingGroupId);
  console.log(`Updated Discord messaging group ${messagingGroupId}`);
}

if (!getMessagingGroupAgentByPair(messagingGroupId, agentGroupId)) {
  createMessagingGroupAgent({
    id: 'mga-logrunner-prod-discord',
    messaging_group_id: messagingGroupId,
    agent_group_id: agentGroupId,
    engage_mode: 'mention-sticky',
    engage_pattern: null,
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    created_at: now,
  });
  console.log(`Wired ${messagingGroupId} -> ${agentGroupId}`);
} else {
  db.prepare(
    `UPDATE messaging_group_agents
       SET engage_mode = ?, engage_pattern = ?, sender_scope = ?, ignored_message_policy = ?, session_mode = ?, priority = ?
     WHERE messaging_group_id = ? AND agent_group_id = ?`,
  ).run('mention-sticky', null, 'all', 'drop', 'shared', 0, messagingGroupId, agentGroupId);
  console.log(`Updated wiring ${messagingGroupId} -> ${agentGroupId}`);
}

if (!getMessagingGroup(cliMessagingGroupId)) {
  createMessagingGroup({
    id: cliMessagingGroupId,
    channel_type: 'cli',
    platform_id: 'local',
    name: 'Logrunner CLI',
    is_group: 0,
    unknown_sender_policy: 'public',
    created_at: now,
  });
  console.log(`Created CLI messaging group ${cliMessagingGroupId}`);
} else {
  db.prepare(
    'UPDATE messaging_groups SET channel_type = ?, platform_id = ?, name = ?, is_group = ?, unknown_sender_policy = ? WHERE id = ?',
  ).run('cli', 'local', 'Logrunner CLI', 0, 'public', cliMessagingGroupId);
  console.log(`Updated CLI messaging group ${cliMessagingGroupId}`);
}

if (!getMessagingGroupAgentByPair(cliMessagingGroupId, agentGroupId)) {
  createMessagingGroupAgent({
    id: 'mga-logrunner-prod-cli',
    messaging_group_id: cliMessagingGroupId,
    agent_group_id: agentGroupId,
    engage_mode: 'pattern',
    engage_pattern: '.',
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'shared',
    priority: 0,
    created_at: now,
  });
  console.log(`Wired ${cliMessagingGroupId} -> ${agentGroupId}`);
} else {
  db.prepare(
    `UPDATE messaging_group_agents
       SET engage_mode = ?, engage_pattern = ?, sender_scope = ?, ignored_message_policy = ?, session_mode = ?, priority = ?
     WHERE messaging_group_id = ? AND agent_group_id = ?`,
  ).run('pattern', '.', 'all', 'drop', 'shared', 0, cliMessagingGroupId, agentGroupId);
  console.log(`Updated wiring ${cliMessagingGroupId} -> ${agentGroupId}`);
}
TS
}

LOGRUNNER_REMOTE_DIR="${LOGRUNNER_REMOTE_DIR:-/opt/logrunner-prod}"
LOGRUNNER_SERVICE_USER="${LOGRUNNER_SERVICE_USER:-logrunner}"
ENV_FILE="$LOGRUNNER_REMOTE_DIR/shared/logrunner.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

require LOGRUNNER_REMOTE_DIR
require NANOCLAW_REPO
require NANOCLAW_REF
require LOGRUNNER_DISCORD_PLATFORM_ID
require DISCORD_BOT_TOKEN
require DISCORD_APPLICATION_ID
require DISCORD_PUBLIC_KEY
derive_openai_base_url
if [ -z "${OPENAI_BASE_URL:-}" ] && [ -z "${OPENCODE_BASE_URL:-}" ] && [ -z "${ANTHROPIC_BASE_URL:-}" ]; then
  echo "Missing required env: OPENAI_BASE_URL, OPENCODE_BASE_URL, or ANTHROPIC_BASE_URL" >&2
  exit 2
fi
validate_model_settings
if [ -z "${MULTIBAAS_BASE_URL:-}" ] && { [ -z "${MULTIBAAS_BACKENDS_FILE:-}" ] || [ ! -f "${MULTIBAAS_BACKENDS_FILE:-}" ]; }; then
  echo "Missing required env: MULTIBAAS_BASE_URL or MULTIBAAS_BACKENDS_FILE" >&2
  exit 2
fi
require LOGRUNNER_WEBHOOK_PUBLIC_URL

ensure_remote_prereqs
ensure_service_user

mkdir -p "$LOGRUNNER_REMOTE_DIR"/{incoming,releases,shared,tmp,current}
chmod 700 "$LOGRUNNER_REMOTE_DIR/shared"
run_root chown -R "$LOGRUNNER_SERVICE_USER:$LOGRUNNER_SERVICE_USER" "$LOGRUNNER_REMOTE_DIR/shared"
ensure_onecli
ensure_onecli_secrets
redact_remote_logrunner_env
run_root chown "$LOGRUNNER_SERVICE_USER:$LOGRUNNER_SERVICE_USER" "$ENV_FILE" 2>/dev/null || true

DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

runtime_stage="$LOGRUNNER_REMOTE_DIR/tmp/runtime-${LOGRUNNER_REF:-archive}-$$"
rm -rf "$runtime_stage"
mkdir -p "$runtime_stage"
if [ -n "${LOGRUNNER_ARCHIVE:-}" ] && [ -f "$LOGRUNNER_ARCHIVE" ]; then
  tar -xzf "$LOGRUNNER_ARCHIVE" -C "$runtime_stage"
  runtime_commit="${LOGRUNNER_REF:-unknown}"
else
  require LOGRUNNER_REPO
  require LOGRUNNER_REF
  clone_ref "$LOGRUNNER_REPO" "$LOGRUNNER_REF" "$runtime_stage"
  runtime_commit="$(git -C "$runtime_stage" rev-parse HEAD)"
fi
echo "$runtime_commit" > "$runtime_stage/.deploy-commit"

(
  cd "$runtime_stage"
  npm ci
  env \
    -u MULTIBAAS_BACKENDS_FILE \
    -u MULTIBAAS_BACKENDS_JSON \
    -u MULTIBAAS_PROFILE \
    -u MULTIBAAS_BASE_URL \
    -u MULTIBAAS_API_KEY \
    -u MULTIBAAS_NETWORK \
    npm test
)

runtime_release="$LOGRUNNER_REMOTE_DIR/releases/runtime-$runtime_commit"
rm -rf "$runtime_release"
mv "$runtime_stage" "$runtime_release"
ln -sfn "$runtime_release" "$LOGRUNNER_REMOTE_DIR/current/runtime"
write_runtime_backend_configs "$runtime_release"

nanoclaw_stage="$LOGRUNNER_REMOTE_DIR/tmp/nanoclaw-$$"
clone_ref "$NANOCLAW_REPO" "$NANOCLAW_REF" "$nanoclaw_stage"
nanoclaw_commit="$(git -C "$nanoclaw_stage" rev-parse HEAD)"
echo "$nanoclaw_commit" > "$nanoclaw_stage/.deploy-commit"

mkdir -p "$LOGRUNNER_REMOTE_DIR/shared"/{nanoclaw-data,nanoclaw-groups,nanoclaw-logs}
run_root chown -R "$LOGRUNNER_SERVICE_USER:$LOGRUNNER_SERVICE_USER" \
  "$LOGRUNNER_REMOTE_DIR/shared/nanoclaw-data" \
  "$LOGRUNNER_REMOTE_DIR/shared/nanoclaw-groups" \
  "$LOGRUNNER_REMOTE_DIR/shared/nanoclaw-logs"
rm -rf "$nanoclaw_stage/data" "$nanoclaw_stage/groups" "$nanoclaw_stage/logs"
ln -s "$LOGRUNNER_REMOTE_DIR/shared/nanoclaw-data" "$nanoclaw_stage/data"
ln -s "$LOGRUNNER_REMOTE_DIR/shared/nanoclaw-groups" "$nanoclaw_stage/groups"
ln -s "$LOGRUNNER_REMOTE_DIR/shared/nanoclaw-logs" "$nanoclaw_stage/logs"

nanoclaw_env="$LOGRUNNER_REMOTE_DIR/shared/nanoclaw.env"
CONTAINER_IMAGE_BASE="${CONTAINER_IMAGE_BASE:-logrunner-prod-agent}"
CONTAINER_IMAGE="${CONTAINER_IMAGE:-$CONTAINER_IMAGE_BASE:latest}"
{
  quote_env ASSISTANT_NAME
  quote_env ONECLI_URL
  quote_env ONECLI_API_KEY
  quote_env CONTAINER_IMAGE_BASE
  quote_env CONTAINER_IMAGE
  quote_env LOGRUNNER_AGENT_PROVIDER
  quote_env OPENCODE_PROVIDER
  quote_env OPENCODE_PROVIDER_NAME
  quote_env OPENCODE_PROVIDER_PACKAGE
  quote_env OPENCODE_MODEL
  quote_env OPENCODE_SMALL_MODEL
  quote_env OPENCODE_BASE_URL
  quote_env OPENAI_BASE_URL
  quote_env ANTHROPIC_BASE_URL
  quote_env DISCORD_BOT_TOKEN
  quote_env DISCORD_APPLICATION_ID
  quote_env DISCORD_PUBLIC_KEY
  quote_env MAX_MESSAGES_PER_PROMPT
  quote_env MAX_CONCURRENT_CONTAINERS
  quote_env TZ
} > "$nanoclaw_env"
chmod 600 "$nanoclaw_env"
run_root chown "$LOGRUNNER_SERVICE_USER:$LOGRUNNER_SERVICE_USER" "$nanoclaw_env"
ln -sfn "$nanoclaw_env" "$nanoclaw_stage/.env"

(
  cd "$nanoclaw_stage"
  pnpm install --frozen-lockfile
  pnpm run build
  build_args=()
  if [ "${INSTALL_CJK_FONTS:-false}" = "true" ]; then
    build_args+=(--build-arg INSTALL_CJK_FONTS=true)
  fi
  DOCKER_BUILDKIT=1 docker build "${build_args[@]}" -t "$CONTAINER_IMAGE" container
)

nanoclaw_release="$LOGRUNNER_REMOTE_DIR/releases/nanoclaw-$nanoclaw_commit"
rm -rf "$nanoclaw_release"
mv "$nanoclaw_stage" "$nanoclaw_release"
ln -sfn "$nanoclaw_release" "$LOGRUNNER_REMOTE_DIR/current/nanoclaw"

write_seed_script "$nanoclaw_release"
(
  cd "$nanoclaw_release"
  run_as_user "$LOGRUNNER_SERVICE_USER" env \
    LOGRUNNER_AGENT_GROUP_ID="${LOGRUNNER_AGENT_GROUP_ID:-ag-logrunner-prod}" \
    LOGRUNNER_AGENT_PROVIDER="${LOGRUNNER_AGENT_PROVIDER:-opencode}" \
    LOGRUNNER_AGENT_FOLDER="${LOGRUNNER_AGENT_FOLDER:-logrunner-prod}" \
    LOGRUNNER_AGENT_NAME="${LOGRUNNER_AGENT_NAME:-Logrunner Prod}" \
    LOGRUNNER_DISCORD_PLATFORM_ID="$LOGRUNNER_DISCORD_PLATFORM_ID" \
    pnpm exec tsx .seed-logrunner-prod.ts
)
rm -f "$nanoclaw_release/.seed-logrunner-prod.ts"

(
  cd "$runtime_release"
  export MULTIBAAS_BACKENDS_FILE
  export MULTIBAAS_RUNTIME_COMMIT="$runtime_commit"
  export MULTIBAAS_RUNTIME_DEPLOYED_AT="$DEPLOYED_AT"
  if [ -n "${MULTIBAAS_PROFILE:-}" ]; then export MULTIBAAS_PROFILE; fi
  if [ -n "${MULTIBAAS_BASE_URL:-}" ]; then export MULTIBAAS_BASE_URL; fi
  run_as_user "$LOGRUNNER_SERVICE_USER" env \
    MULTIBAAS_BACKENDS_FILE="$MULTIBAAS_BACKENDS_FILE" \
    MULTIBAAS_RUNTIME_COMMIT="$runtime_commit" \
    MULTIBAAS_RUNTIME_DEPLOYED_AT="$DEPLOYED_AT" \
    MULTIBAAS_PROFILE="${MULTIBAAS_PROFILE:-}" \
    MULTIBAAS_BASE_URL="${MULTIBAAS_BASE_URL:-}" \
    node dist/index.js nanoclaw configure \
      --nanoclaw-dir "$nanoclaw_release" \
      --group-folder "${LOGRUNNER_AGENT_FOLDER:-logrunner-prod}" \
      --write-allowlist
)

unit_file="/etc/systemd/system/logrunner-prod.service"
run_root tee "$unit_file" >/dev/null <<UNIT
[Unit]
Description=Logrunner production NanoClaw
After=network-online.target docker.service
Wants=network-online.target docker.service

[Service]
Type=simple
User=$LOGRUNNER_SERVICE_USER
SupplementaryGroups=docker
WorkingDirectory=$LOGRUNNER_REMOTE_DIR/current/nanoclaw
EnvironmentFile=$nanoclaw_env
ExecStartPre=/bin/bash -lc 'docker ps --filter "name=nanoclaw-v2-" --format "{{.Names}}" | xargs -r docker stop -t 1'
ExecStart=/bin/bash -lc 'exec pnpm start'
ExecStopPost=/bin/bash -lc 'docker ps --filter "name=nanoclaw-v2-" --format "{{.Names}}" | xargs -r docker stop -t 1'
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
UNIT

run_root systemctl daemon-reload
run_root systemctl enable logrunner-prod.service >/dev/null
run_root systemctl restart logrunner-prod.service

webhook_env="$LOGRUNNER_REMOTE_DIR/shared/runtime-webhook.env"
{
  quote_env MULTIBAAS_BACKENDS_FILE
  quote_env MULTIBAAS_PROFILE
  quote_env MULTIBAAS_BASE_URL
  quote_env MULTIBAAS_API_KEY
  quote_env MULTIBAAS_WEBHOOK_SECRET
} > "$webhook_env"
chmod 600 "$webhook_env"
run_root chown "$LOGRUNNER_SERVICE_USER:$LOGRUNNER_SERVICE_USER" "$webhook_env"

while read -r profileName; do
  [ -z "$profileName" ] && continue
  (
    cd "$runtime_release"
    MULTIBAAS_BACKENDS_FILE="$MULTIBAAS_BACKENDS_FILE" \
    MULTIBAAS_PROFILE="$profileName" \
    node dist/index.js webhook ensure \
      --url "$LOGRUNNER_WEBHOOK_PUBLIC_URL" \
      --label "${LOGRUNNER_WEBHOOK_LABEL:-logrunner-prod-runtime-events}"
  )
done < <(backend_profile_names)

run_root tee /etc/systemd/system/logrunner-prod-webhook.service >/dev/null <<UNIT
[Unit]
Description=Logrunner production MultiBaas webhook receiver
After=network-online.target logrunner-prod.service
Wants=network-online.target

[Service]
Type=simple
User=$LOGRUNNER_SERVICE_USER
WorkingDirectory=$LOGRUNNER_REMOTE_DIR/current/runtime
EnvironmentFile=$webhook_env
ExecStart=/bin/bash -lc 'exec node dist/index.js webhook serve --port 8787 --nanoclaw-dir "$LOGRUNNER_REMOTE_DIR/current/nanoclaw" --group-folder "${LOGRUNNER_AGENT_FOLDER:-logrunner-prod}"'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
run_root systemctl daemon-reload
run_root systemctl enable logrunner-prod-webhook.service >/dev/null
run_root systemctl restart logrunner-prod-webhook.service
ensure_caddy_proxy

manifest="$LOGRUNNER_REMOTE_DIR/shared/deploy-manifest.json"
cat > "$manifest" <<JSON
{
  "deployedAt": "$DEPLOYED_AT",
  "runtimeCommit": "$runtime_commit",
  "runtimeRelease": "$runtime_release",
  "nanoclawCommit": "$nanoclaw_commit",
  "nanoclawRelease": "$nanoclaw_release",
  "discordPlatformId": "$LOGRUNNER_DISCORD_PLATFORM_ID",
  "agentFolder": "${LOGRUNNER_AGENT_FOLDER:-logrunner-prod}",
  "agentProvider": "${LOGRUNNER_AGENT_PROVIDER:-opencode}",
  "openaiBaseUrl": "${OPENAI_BASE_URL:-}",
  "multibaasBaseUrl": "${MULTIBAAS_BASE_URL:-}"
}
JSON

run_root systemctl --no-pager --full status logrunner-prod.service | sed -n '1,18p'
echo "Deploy manifest: $manifest"
