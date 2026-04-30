# NanoClaw integration

This is the repo-local runbook for wiring the harness into NanoClaw and exercising it in a repeatable way.

## Install notes that mattered here

Before running NanoClaw setup, fetch the `channels` branch so Discord setup is available later:

```bash
cd ~/git/qwibitai/nanoclaw
git fetch origin channels:refs/remotes/origin/channels
```

The working local install here used the standard `nanoclaw.sh` flow with a custom model endpoint:

```bash
NANOCLAW_NO_DIAGNOSTICS=1 \
POSTGRES_PORT=5433 \
NANOCLAW_ANTHROPIC_BASE_URL=http://host.docker.internal:18080 \
NANOCLAW_ANTHROPIC_AUTH_TOKEN=placeholder \
bash nanoclaw.sh
```

Why this mattered:

- the local model endpoint is reachable from the container via `host.docker.internal`
- the auth token is intentionally a placeholder so OneCLI can rewrite the outgoing header
- this was done with the standard installer path, not the advanced/manual path

## Model selection

If NanoClaw falls back to a default Claude model, pin each active group to the served model in:

```text
~/git/qwibitai/nanoclaw/data/v2-sessions/<agent-group-id>/.claude-shared/settings.json
```

For the local Qwen-backed setup that worked here:

```json
"model": "qwen36-35b"
```

This mattered for both the CLI-facing group and the Discord-facing group.

## Restarting NanoClaw

Do not hardcode the launchd label suffix. Discover the active label first:

```bash
SERVICE_LABEL=$(launchctl list | awk '/com\.nanoclaw-v2-/{print $3; exit}')
launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"
```

## Wiring this repo into a NanoClaw group

Use the harness helper to update the target group's `container.json`:

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
```

Run the same command for any DM or Discord group you want the harness mounted into.

This writes:

- `mcpServers.multibaas-agent`
- a read-only `additionalMounts` entry for this repo
- an in-container state directory for watches
- a container-safe MultiBaas base URL

## Auth model

For NanoClaw-backed runs, do not put a real `MULTIBAAS_API_KEY` in `container.json`.

Use OneCLI path-scoped secret injection instead:

- model-provider traffic scoped to `/v1/*`
- MultiBaas traffic scoped to `/api/v0/*`

This matters because both services may be reached through `host.docker.internal`, so host matching alone is not enough.

The harness is compatible with this model by sending a placeholder bearer token when no direct MultiBaas key is configured.

If a prior secret install is dirty, this cleanup pattern was useful:

```bash
onecli secrets delete --id <secret-id>
```

## Test path for future coding agents

Start with the deterministic local CLI channel:

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "What is the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172?"
pnpm run chat -- "Give me the top 5 holders for the token"
pnpm run chat -- "Alert me if the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 moves"
pnpm run chat -- "List watches"
pnpm run chat -- "Check watches"
```

After that works, validate the channel-facing experience through Discord or DM with the same prompts.

Recommended validation order:

1. confirm NanoClaw is alive with a ping or simple balance query
2. confirm the harness mount exists in the target group's `container.json`
3. confirm OneCLI secrets are scoped correctly
4. run balance lookup
5. run top holders
6. create and list a watch
7. move on to webhook and alert validation last
