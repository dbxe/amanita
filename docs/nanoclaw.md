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

## When to rerun `nanoclaw configure` vs restart

For live NanoClaw validation, treat the runtime as **sticky**:

- NanoClaw session containers are long-lived
- the agent-runner reads `container.json` **once at startup**
- active sessions can keep continuation state and pending interactive questions across turns

That means a repo change is not automatically the same thing as a fresh live NanoClaw test.

Use this rule:

| Change type | Rerun `nanoclaw configure` | Restart NanoClaw / affected session | Notes |
| --- | --- | --- | --- |
| `src/nanoclaw.ts` or anything that changes generated `groups/<folder>/container.json` | Yes | Yes | This includes MCP instructions, env vars, mounts, server definitions, or group config shape. |
| MCP/business-logic files used by the mounted harness (`src/mcp.ts`, `src/intent.ts`, `src/agent-tools.ts`, `src/holder-tasks.ts`, `src/onboarding.ts`, `src/multibaas.ts`) | No | Yes for live NanoClaw retests | The repo is mounted into the container, but active session state can still make the next Discord/DM test non-fresh. Restart before trusting the result. |
| Docs-only or test-only changes | No | No | Unless you are explicitly testing the live NanoClaw UX text. |
| Pure local harness tests (`npm test`, `npm run build`, local CLI entrypoints) | No | No | These do not depend on NanoClaw session containers. |

Practical default for channel-facing tests:

1. if `container.json` generation changed, rerun `nanoclaw configure` for the target group
2. restart NanoClaw or stop the affected session container
3. retest with a fresh message

If you skip step 2 after business-logic changes, the live Discord/DM result is **suspect**, because you may still be exercising stale session state rather than the code you just changed.

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

The NanoClaw container runs the harness MCP through the built artifact:

```text
/workspace/extra/multibaas-agent-harness/dist/mcp.js
```

So for live NanoClaw tests, make sure the repo build is current before `nanoclaw configure` and restart. `npm test` already does this because it rebuilds `dist/`.

## Auth model

For NanoClaw-backed runs, do not put a real `MULTIBAAS_API_KEY` in `container.json`.

Use OneCLI path-scoped secret injection instead:

- model-provider traffic scoped to `/v1/*`
- MultiBaas traffic scoped to `/api/v0/*`

This matters because both services may be reached through `host.docker.internal`, so host matching alone is not enough.

The harness is compatible with this model by sending a placeholder bearer token when no direct MultiBaas key is configured.

Treat this as a hard boundary for NanoClaw-backed work:

- MultiBaas secrets belong in **OneCLI**
- do **not** copy the real API key into `container.json`
- do **not** rely on mounted repo config or ad hoc env injection as a substitute secret path for the NanoClaw container
- if the container transport/runtime path is broken, fix the transport/runtime path instead of moving secrets out of OneCLI

If a prior secret install is dirty, this cleanup pattern was useful:

```bash
onecli secrets delete --id <secret-id>
```

## Test path for future coding agents

Before any live NanoClaw retest, run this preflight:

1. if the change touched `src/nanoclaw.ts` or any generated `container.json` behavior, rerun `nanoclaw configure` for the target group
2. if the change touched mounted harness business logic (`src/mcp.ts`, `src/intent.ts`, `src/agent-tools.ts`, `src/holder-tasks.ts`, `src/onboarding.ts`, `src/multibaas.ts`), rebuild the repo and restart NanoClaw or stop the affected session container before trusting the next live result
3. verify the OneCLI secret path is still the intended auth path; do not switch to container-held secrets as a debugging shortcut
4. only skip restart for docs-only, test-only, or repo-local validation that does not use a live NanoClaw session

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

1. run the preflight above so the live test starts from fresh runtime state
2. confirm NanoClaw is alive with a ping or simple balance query
3. confirm the harness mount exists in the target group's `container.json`
4. confirm OneCLI secrets are scoped correctly
5. run balance lookup
6. run top holders
7. create and list a watch
8. move on to webhook and alert validation last

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
