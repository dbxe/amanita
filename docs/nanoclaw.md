# NanoClaw integration

This runbook is intentionally operational. It covers how to mount the runtime into NanoClaw, verify that the live environment is healthy, and recover stale or poisoned state. It is not the place to define the DAO product story.

Use this doc for:

- configure
- preflight
- OneCLI secret coverage
- restart and stale-session recovery
- debugging `missing backend`, `needs-link`, and stuck-session failures
- operator pacing during slow live inference
- using `pnpm run chat` as the canonical local maintainer test path

For broader live prompt coverage, use [`docs/nanoclaw-live-tests.md`](docs/nanoclaw-live-tests.md). For the DAO story framing, use [`docs/arbitrum-dao-demo.md`](docs/arbitrum-dao-demo.md).

## Working local install notes

Use the canonical local fork and branch:

```bash
cd ~/git/dbxe/nanoclaw
git checkout openagents
```

The working local install used the standard NanoClaw service/container setup with:

- the `discord` channel adapter checked into the fork
- the `opencode` provider checked into the fork
- `OPENCODE_PROVIDER=openai`
- `OPENCODE_MODEL=openai/qwen36-35b`
- `OPENAI_BASE_URL=http://host.docker.internal:18080/v1`

Why this mattered:

- the local model endpoint is reachable from the container via `host.docker.internal`
- the provider is speaking an OpenAI-compatible `/v1/chat/completions` path
- Discord support is part of the forked source of truth instead of a local patch

## Configure a group

Use the repo helper to update a NanoClaw group's `container.json`:

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
```

Run the same command for any DM or Discord group that should mount this runtime.

This writes:

- `mcpServers.multibaas-runtime`
- a read-only `additionalMounts` entry for this repo
- an in-container state directory for watches
- a container-safe MultiBaas base URL

The mounted MCP path is:

```text
/workspace/extra/multibaas-runtime/dist/mcp.js
```

If `src/mcp.ts` or `src/nanoclaw.ts` changed, rebuild and rerun `nanoclaw configure` before trusting live results.

## Auth model

For NanoClaw-backed runs, do not put a real `MULTIBAAS_API_KEY` in `container.json`.

Use OneCLI path-scoped secret injection instead:

- model-provider traffic scoped to `/v1/*`
- MultiBaas traffic scoped to `/api/v0/*`

The runtime is compatible with this by sending a placeholder bearer token when no direct MultiBaas key is configured.

Treat this as a hard boundary:

- MultiBaas secrets belong in OneCLI
- do not move the real API key into `container.json`
- do not rely on mounted repo config as a replacement secret path
- if the transport path is broken, fix the transport path instead of copying secrets into the container

Useful cleanup when a previous secret install is wrong:

```bash
onecli secrets delete --id <secret-id>
```

## Operator preflight

`nanoclaw preflight` is an **operator health check**. It is not part of the product story.

Run it before live retests:

```bash
cd ~/git/dbxe/amanita
npm test
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
npm run dev -- nanoclaw preflight \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name>
```

Its purpose is to verify:

- the mounted runtime build exists
- the target group's `container.json` exists and points at the runtime
- the backend registry or single-base-url config is present
- active session and container state are visible
- OneCLI `/api/v0/*` secret coverage exists for each configured backend

The preflight output reports:

- group folder and agent-group ID
- container config path
- backend mode: `registry`, `single-base-url`, or `missing`
- configured backend profiles
- MCP `dist/mcp.js` path and presence
- running containers
- session directories
- per-profile OneCLI API secret coverage
- active session rows

Interpretation rules:

- `backend mode: missing` means the mounted group is not configured with either backend registry JSON or a direct base URL
- missing OneCLI coverage for a configured profile means the runtime will likely fail authentication for that backend inside NanoClaw
- missing `dist/mcp.js` means the group is mounted, but the built MCP artifact is not present where NanoClaw expects it

## Minimal validation after preflight

Keep the first live prompts narrow:

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "hello"
pnpm run chat -- "What backends are available for the current Arbitrum DAO setup?"
pnpm run chat -- "Is 0xE6841D92B0C345144506576eC13ECf5103aC7f49 linked, ready, or still syncing?"
```

These are operator checks, not the finished DAO demo.

## CLI maintainer path

`pnpm run chat` is the canonical **local maintainer test path**.

After the NanoClaw client fix in [`scripts/chat.ts`](~/git/dbxe/nanoclaw/scripts/chat.ts), it is designed to survive slow live inference:

- it waits up to **15 minutes** for a first reply
- it prints a periodic waiting update every **30 seconds** while no reply has arrived yet
- after replies start, it exits after **15 seconds** of silence

That means:

- slow first token is no longer enough to make the local client look dead
- maintainers get explicit waiting feedback instead of a silent two-minute cliff
- a CLI timeout now means a real long-turn failure, not just an overly short client lifetime

Use it for both:

- basic liveness
- real local maintainer validation on known-good and exploratory live prompts

DM or Discord can still be useful as secondary confirmation channels, but they are not the primary local maintainer loop.

## Patience rule

Once the agent has recently passed basic liveness or narrow validation prompts, **do not assume silence means failure immediately**.

For this setup:

- the live agent inference can be slow
- narrow prompts on healthy contracts can still take noticeable time
- overlapping or repeated prompts make the result less trustworthy

Practical rule:

1. confirm liveness with `hello` or one narrow readiness question
2. send one prompt
3. let the agent work
4. do not hammer the same session with rapid follow-ups while it is still processing

Treat "slow after recent liveness success" differently from "dead". If the agent already answered basic checks in the same session or a fresh nearby session, be patient before escalating to reset or restart.

This matters when the test path is `pnpm run chat`, because slow first token is normal in this setup. The local client now waits long enough to make that explicit. If it times out after 15 minutes, treat that as a real failure to investigate rather than a short-lived client artifact.

## When to rerun configure vs when to restart

Treat NanoClaw as sticky:

- session containers are long-lived
- the runner reads `container.json` once at startup
- active sessions keep continuation and pending-question state across turns

Use this rule:

| Change type | Rerun `nanoclaw configure` | Restart NanoClaw or affected session | Notes |
| --- | --- | --- | --- |
| `src/nanoclaw.ts` or anything that changes generated `container.json` | Yes | Yes | This includes env vars, mounts, MCP instructions, and server definitions. |
| Mounted runtime business logic such as `src/mcp.ts`, `src/multibaas.ts`, `src/query-service.ts`, `src/event-view-service.ts`, `src/investigation-service.ts`, `src/multichain-service.ts` | No | Yes for live retests | The repo is mounted, but stale session state can still hide the new behavior. |
| Docs-only or test-only changes | No | No | Unless you are explicitly retesting live prompt text. |

Practical default for channel-facing retests:

1. rebuild this repo
2. rerun `nanoclaw configure` if container config generation changed
3. run `nanoclaw preflight`
4. restart NanoClaw or stop the exact affected session container
5. retest from a fresh message

Do not confuse impatience with recovery criteria. A slow reply after recent liveness success is not, by itself, evidence that the session is poisoned.

## Restarting NanoClaw

Do not hardcode the launchd label suffix. Discover it first:

```bash
SERVICE_LABEL=$(launchctl list | awk '/com\.nanoclaw-v2-/{print $3; exit}')
launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"
```

If you only need to stop one active session container:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker stop <exact-container-name>
```

## Resetting a stale or poisoned group

`nanoclaw reset-group` is a recovery tool for stale or poisoned session state. It is not a product feature.

Run it when:

- the same group keeps resuming bad continuation state
- pending-question loops survive normal restarts
- you need a clean operator baseline before retesting

Command:

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw reset-group \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name>
```

What it does:

- stops running NanoClaw containers for that group
- creates a backup of `data/v2.db`
- deletes the group's session rows from the host DB
- deletes matching `pending_questions` rows
- archives the group's session directories under `data/v2-sessions-archive/`

Use it as part of the development and stabilization loop. Do not describe it as part of the DAO demo.

## Stuck-session and repeated-question recovery

If NanoClaw keeps showing background traffic when nobody is chatting, inspect the target session DBs:

```text
~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/inbound.db
~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/outbound.db
```

The common failure cases here were:

- `messages_in.status = 'pending'` rows in `inbound.db`
- preserved provider continuation state in `outbound.db`
- repeated `pending_questions` rows in `~/git/dbxe/nanoclaw/data/v2.db`

Practical recovery order:

1. stop the noisy session container
2. inspect `pending` inbound rows
3. use `nanoclaw reset-group` if the whole group is suspect
4. only do more targeted DB cleanup if a narrower reset is required

If Discord or DM keeps repeating the same choice card every 15-20 seconds, treat that as NanoClaw interactive-question state first, not as a runtime reasoning problem.

## Debugging common operator failures

### Missing backend

Symptoms:

- preflight reports `backend mode: missing`
- live runs say the runtime cannot reach a backend

Checks:

1. rerun `nanoclaw configure` for the target group
2. inspect the generated group config:

```bash
cat ~/git/dbxe/nanoclaw/groups/cli-with-<name>/container.json
```

3. confirm the runtime env includes either `MULTIBAAS_BACKENDS_JSON` or `MULTIBAAS_BASE_URL`
4. rerun `nanoclaw preflight`

### Missing or partial OneCLI secret coverage

Symptoms:

- preflight lists configured profiles but marks one or more as `missing`
- live runs behave like missing credentials despite valid backend config

Checks:

1. inspect OneCLI secrets:

```bash
onecli secrets list
```

2. confirm each configured backend host has `/api/v0/*` coverage
3. remove incorrect secrets and reinstall them with the correct path scope

### `needs-link` or `syncing`

Treat these as real runtime states, not immediate product failures.

Checks:

1. inspect the address or interface from the host-side CLI
2. confirm the contract definition is known and the contract is linked
3. confirm indexing has progressed enough for the requested view
4. if the question depends on full history, preserve the waiting state explicitly

### MCP server unavailable

If a live reply says tools from `container.json` are unavailable, verify the MCP server starts cleanly before debugging prompts:

```bash
cd ~/git/dbxe/amanita
node dist/mcp.js
```

If startup throws, fix the MCP server first. A broken startup path can make the whole mounted tool surface disappear even when `container.json` looks correct.

## Useful operator checks

Inspect live NanoClaw logs:

```bash
tail -n 120 ~/git/dbxe/nanoclaw/logs/nanoclaw.log
tail -n 120 ~/git/dbxe/nanoclaw/logs/nanoclaw.error.log
```

Inspect the target group config:

```bash
cat ~/git/dbxe/nanoclaw/groups/cli-with-<name>/container.json
```

Confirm host-side MultiBaas state with repo-local CLI commands:

```bash
cd ~/git/dbxe/amanita
npm run dev -- backend list
npm run dev -- contract inspect --contract 0xE6841D92B0C345144506576eC13ECf5103aC7f49
npm run dev -- query multichain-inspect --targets l1@mainnet-remote:0xE6841D92B0C345144506576eC13ECf5103aC7f49,l2@arbitrum-one-remote:0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0
```

## Webhook and notification path

Manual NanoClaw notification test:

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw notify \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder dm-with-<name> \
  --text "test alert"
```

Webhook receiver with NanoClaw delivery enabled:

```bash
cd ~/git/dbxe/amanita
MULTIBAAS_AGENT_STATE_DIR=~/git/dbxe/nanoclaw/groups/cli-with-<name>/.agent-state \
npm run dev -- webhook serve \
  --secret <webhook-secret> \
  --port 8787 \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder dm-with-<name>
```

When registering the callback URL, match it to where MultiBaas is actually running:

- host-run local MultiBaas: `http://127.0.0.1:8787/webhooks/multibaas`
- container-run local MultiBaas: `http://host.docker.internal:8787/webhooks/multibaas`

If a webhook had accumulated failed deliveries, expect retry backoff before treating the callback path as broken.
