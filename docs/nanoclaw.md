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

If OneCLI keeps showing `/v1/messages` traffic when nobody is chatting, first check for a stuck pending inbound message in the session DB. In the setup here, the live loop was caused by a `messages_in.status = 'pending'` row in:

```text
~/git/qwibitai/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/inbound.db
```

The matching provider continuation is stored per session in:

```text
~/git/qwibitai/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/outbound.db
```

under `session_state.key = continuation:claude`. It is not stored in the global `data/v2.db`.

Practical recovery order:

1. stop the noisy session container
2. inspect `inbound.db` for `pending` rows
3. mark the stuck inbound row completed or failed if needed
4. clear the per-session continuation row only if the session still resumes into bad state

If Discord or DM keeps re-sending the same choice card every ~15-20 seconds, check the central NanoClaw DB for repeated `pending_questions` rows:

```text
~/git/qwibitai/nanoclaw/data/v2.db
```

In the setup here, the repeated "Query name needed" loop was not the harness task model retrying. It was NanoClaw's interactive question flow repeatedly creating `pending_questions` entries for the same session. Clicking **Never mind** stopped the live loop because it wrote a matching `question_response` back into the session inbox.

If you have changed `src/mcp.ts` or `src/nanoclaw.ts`, rerun `nanoclaw configure` for the affected group and restart NanoClaw before retesting. Existing session containers can keep older instructions or tool schemas alive long enough to reproduce outdated prompts.

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

## Webhook-driven notifications

For the final alert loop, the harness can write a normal outbound chat row into the target NanoClaw session so the existing delivery poll sends it through the channel adapter.

Manual notification test:

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw notify \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder dm-with-<name> \
  --text "test alert"
```

Webhook receiver with NanoClaw delivery enabled:

```bash
cd ~/git/dbxe/amanita
MULTIBAAS_AGENT_STATE_DIR=~/git/qwibitai/nanoclaw/groups/cli-with-<name>/.agent-state \
npm run dev -- webhook serve \
  --secret <webhook-secret> \
  --port 8787 \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder dm-with-<name>
```

The CLI channel remains useful for deterministic testing, but it is not a reliable push-notification surface because delivery only appears in a live connected terminal. For proactive alerts, prefer a DM or Discord-backed NanoClaw session.

## Deterministic whale-movement replay

For the HelloWorld fixture, do not assume the deployer still holds tokens after `hardhat/scripts/mint.ts`; that script distributes the full supply. To trigger the alert loop on demand, call the linked token through the MultiBaas contract-method API and submit the transaction from the whale address instead:

```bash
curl -sS -X POST "$MULTIBAAS_BASE_URL/api/v0/chains/ethereum/addresses/helloworld/contracts/helloworld/methods/transfer" \
  -H "Authorization: Bearer $MULTIBAAS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "signature": "transfer(address,uint256)",
    "args": ["0xd0E2ac1033B2a26314095BbE2e56D2974455B8B6", "1000000000000000000"],
    "from": "0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172",
    "signer": "0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172",
    "signAndSubmit": true,
    "nonceManagement": true
  }'
```

On success, MultiBaas returns `TransactionToSignResponse` with `submitted: true`, the saved query reflects the lower whale balance, and the webhook receiver can queue the resulting alert into the DM or Discord-backed NanoClaw session.
