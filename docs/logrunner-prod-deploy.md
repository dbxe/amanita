# Logrunner Prod Deployment

This runbook deploys the demo to a short-lived Linux VM with Docker. Use a VM, not a serverless container target: NanoClaw starts per-session Docker containers, so the host must have a reachable Docker daemon.

## Target Shape

- NanoClaw runs as `logrunner-prod.service`.
- This runtime is mounted into the NanoClaw agent group from an immutable release directory.
- Each deploy builds from the exact local Git `HEAD` archive and stamps the MCP server with that commit.
- `get_runtime_status` is exposed as an MCP tool so the Discord agent can report the running runtime commit.
- NanoClaw `data/`, `groups/`, and `logs/` persist under `/opt/logrunner-prod/shared/` across redeploys.

## VM Shape

Use a small Ubuntu 24.04 VM for the hackathon week. The easiest path is SSH as `root` with the Hetzner key because the deploy script can install missing prerequisites without a docker-group re-login.

Firewall inbound rules:

- TCP `22` from your IP, or from anywhere if this is a throwaway hackathon VM.
- TCP `80` and `443` from anywhere when using the built-in Caddy HTTPS reverse proxy for MultiBaas webhooks.
- ICMP from anywhere for basic reachability checks.

The remote script bootstraps `git`, `curl`, Docker, Node.js 22, `pnpm`, OneCLI, and Caddy when needed. If you do not want Caddy, set `LOGRUNNER_ENABLE_CADDY=0` and provide your own HTTPS forwarding to port `8787`.

## Configure Secrets

Copy the example and fill in the live values. Keep the copied file local; it is gitignored and is not meant to be stored in GitHub Actions secrets.

```bash
cp deploy/logrunner-prod/.env.prod.example deploy/logrunner-prod/.env.prod
```

Required values:

- `LOGRUNNER_SSH_TARGET`
- `LOGRUNNER_SSH_KEY`
- `LOGRUNNER_DISCORD_PLATFORM_ID` as `discord:<guild-id>:<channel-id>`
- `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`
- `OPENAI_CHAT_COMPLETIONS_URL` or `OPENAI_BASE_URL` for the OpenAI-compatible inference endpoint
- `OPENAI_API_KEY` for first-time remote OneCLI secret install
- `OPENCODE_PROVIDER`, `OPENCODE_MODEL`, `OPENCODE_SMALL_MODEL`, and optional model limits such as `OPENCODE_MODEL_OUTPUT_LIMIT`
- `LOGRUNNER_NANOCLAW_INSTRUCTION_PROFILE=compact` for low-token-budget remote model endpoints
- `MULTIBAAS_BACKENDS_FILE` pointing at your gitignored multibackend config, or `MULTIBAAS_BASE_URL` + `MULTIBAAS_API_KEY` for a single-backend fallback
- `MULTIBAAS_PROFILE` for the default backend profile used by single-backend tools
- `LOGRUNNER_WEBHOOK_PUBLIC_URL` for MultiBaas event callbacks
- `LOGRUNNER_WEBHOOK_LABEL`, defaulting to a Logrunner-specific label so deploy can create and retain its own signing secret

If your live MultiBaas backends are already in `.multibaas/backends.local.json`, set:

```bash
MULTIBAAS_BACKENDS_FILE=/Users/danielbriskin/git/dbxe/amanita-deploy-rails/.multibaas/backends.local.json
MULTIBAAS_PROFILE=mainnet-remote
```

Local and deployed runs can share this same MultiBaas backend file. Keep Discord separate by using a different live Discord app/bot token in `deploy/logrunner-prod/.env.prod`.

For multichain deployments, the file should contain one profile per live backend. The deploy uploads a chmod-600 host copy with the real API keys, writes a sanitized mounted copy with placeholder API keys for NanoClaw containers, and relies on OneCLI to inject the real credentials at request time.

## OneCLI On The VM

The deploy owns the remote OneCLI setup:

1. If `ONECLI_URL` is blank, the remote script installs or reuses a OneCLI gateway on the VM.
2. It writes the resolved `ONECLI_URL` into NanoClaw's service environment.
3. It creates/replaces generic OneCLI secrets:
   `OPENAI_ONECLI_SECRET_NAME` for `OPENAI_BASE_URL` on `OPENAI_ONECLI_PATH_PATTERN`, usually `/v1/*`.
   one `MULTIBAAS_ONECLI_SECRET_NAME (<profile>)` entry for each configured MultiBaas profile on `MULTIBAAS_ONECLI_PATH_PATTERN`, usually `/api/v0/*`.

For a first deploy, set `OPENAI_API_KEY` in `.env.prod` or store it in the macOS Keychain as `DEMO_OPENAI_API_KEY`, then provide MultiBaas API keys through `MULTIBAAS_BACKENDS_FILE` or the single-backend `MULTIBAAS_API_KEY` fallback. The local deploy script defaults to `OPENAI_API_KEY_SOURCE=keychain`, so the Keychain item wins over an ignored `.env.prod` value unless `OPENAI_API_KEY` was explicitly exported in the shell. To use a different Keychain item name, set `OPENAI_API_KEY_KEYCHAIN_ITEM`; to force the env-file key, set `OPENAI_API_KEY_SOURCE=env`. The remote deploy script redacts raw env-file key values back out of `/opt/logrunner-prod/shared/logrunner.env` after installing them into OneCLI. Keep raw keys out of NanoClaw `container.json`; the runtime sends placeholder bearer tokens from inside NanoClaw so OneCLI can inject real credentials.

If you need to force a fresh OneCLI gateway install on the VM, set:

```bash
LOGRUNNER_REINSTALL_ONECLI=1
```

The `dbxe/nanoclaw` `openagents` branch includes the `opencode` provider used by this deploy path. If you provide a full `.../chat/completions` URL, the deploy derives `OPENAI_BASE_URL` by stripping that final path segment before configuring OpenCode.

## NanoClaw Source

Do not deploy from a dirty NanoClaw worktree. The NanoClaw setup wizard and skills mutate source files, for example by adding Discord channel imports or provider support. For a repeatable demo:

1. Use `https://github.com/dbxe/nanoclaw.git` unless the VM has GitHub SSH deploy credentials.
2. Use `NANOCLAW_REF=openagents` while that branch is the tested local branch.
3. For a frozen judging release, either set `NANOCLAW_REF` to the tested commit SHA or create a lightweight prod branch/tag that points at that commit.

This keeps the VM deploy deterministic: every deploy fetches a known NanoClaw commit instead of depending on wizard side effects.

## Deploy

```bash
scripts/deploy-logrunner-prod.sh
```

The script runs `npm test`, uploads a Git archive of the current commit, builds both projects on the VM, rewires the Discord group, restarts systemd, and writes `/opt/logrunner-prod/shared/deploy-manifest.json`.

Check status:

```bash
scripts/logrunner-prod-status.sh
```

In Discord, ask the bot:

```text
@<bot-name> what runtime version are you running?
```

The agent should call `get_runtime_status` and return the commit from the deploy manifest.

## Updating During The Demo

Commit the change, then rerun:

```bash
scripts/deploy-logrunner-prod.sh
```

Do not patch files manually on the VM. The release directories are intentionally replaced from a fresh archive so stale `dist/`, old MCP schemas, and long-lived NanoClaw session state do not silently survive a deploy.

If a Discord thread appears stuck on old context, stop the active NanoClaw session container or restart `logrunner-prod.service`; the service already restarts during deploy.

## Webhook Callbacks

Balance-watch alerts and event-driven follow-up need a public HTTPS URL that MultiBaas can call. For a short-lived VM with IPv4, use an `sslip.io` name and let Caddy terminate HTTPS:

```bash
LOGRUNNER_WEBHOOK_PUBLIC_URL=https://<vm-ipv4>.sslip.io/webhooks/multibaas
LOGRUNNER_ENABLE_CADDY=1
```

The deploy runs `webhook ensure` for each configured MultiBaas backend profile before starting the receiver and stores generated signing secrets in profile-scoped state under `/opt/logrunner-prod/shared/runtime-state`. If you create the webhook manually in MultiBaas, set `MULTIBAAS_WEBHOOK_SECRET` to that signing secret.

If you use your own DNS name, point it at the VM and use the same `LOGRUNNER_WEBHOOK_PUBLIC_URL` shape. If you use a tunnel instead, disable Caddy and forward HTTPS traffic to VM port `8787`.

The webhook signing secret is inbound verification material for the host-side receiver. It does not have to be in NanoClaw `container.json`; for this deploy it is stored either in the runtime state created by `webhook ensure` or in the VM env file if `MULTIBAAS_WEBHOOK_SECRET` is provided. The host-side webhook service uses `/opt/logrunner-prod/shared/backends.host.runtime.json` for runtime-owned watch evaluation; that file is chmod-600 and is not mounted into NanoClaw containers.
