# Web3 intelligence agent harness

## What this repo is for

This repo is the hackathon submission workspace for an **event-driven Web3 agent harness** built around:

- **MultiBaas Event Queries** for event-sourced views over EVM contracts
- **MultiBaas Webhooks** for waking the system on new onchain events
- **NanoClaw** as the local agent host/runtime
- a thin local harness layer that holds the integration logic / "secret sauce"

Core product idea:

1. User asks for a derived onchain view in natural language
2. Agent uses MultiBaas event queries to reconstruct hidden or non-enumerable state
3. User saves a monitor/watch
4. MultiBaas webhook fires later
5. the harness wakes the agent and the user gets an updated explanation / alert

## Current repo shape

This repo currently contains a `hardhat/` subproject used as the **chain fixture + deployment helper** for local demos:

- deploy a sample ERC-20
- link it on MultiBaas
- mint/distribute balances so holder queries are meaningful

The harness app/integration logic should live outside `hardhat/`. Treat `hardhat/` as the local contract/test-data setup, not the final agent runtime.

## Chosen local architecture

We are **not** building on heavy OpenClaw.

We are using **NanoClaw** as the local host because it already provides:

- a long-running local daemon
- persistent SQLite-backed state
- a built-in `cli/local` channel for local testing
- agent containers
- support for extra **MCP servers** via `container.json`

The harness should be structured as:

1. **Core library** — query builders, monitor logic, webhook validation, NanoClaw wake logic
2. **CLI** — manual/debug entrypoints for local development
3. **Thin MCP server** — the interface NanoClaw calls from inside the agent container

Use the generated TypeScript SDK as the main MultiBaas client. Do **not** build around the old MCP POC as the source of truth.

## Local reference repos

These local repos are expected to be used together:

| Purpose | Path |
|---|---|
| NanoClaw local agent harness | `~/git/qwibitai/nanoclaw` |
| MultiBaas docs | `~/git/curvegrid/docs` |
| Generated TypeScript SDK | `~/git/curvegrid/multibaas-sdk-typescript` |
| Older MCP proof of concept | `~/git/curvegrid/multibaas-mcp-poc` |

Recommended use:

- **Primary client surface**: `multibaas-sdk-typescript`
- **Reference for API behavior / semantics**: public MultiBaas docs
- **Reference for MCP boilerplate only**: `multibaas-mcp-poc`
- **Local host/runtime**: `nanoclaw`

## NanoClaw integration notes

These are the setup details that mattered in practice on this machine. Keep them here so future integration work does not have to rediscover them.

### 1. Fetch the NanoClaw `channels` branch before channel setup

Before running the standard NanoClaw install flow, fetch the `channels` branch so Discord setup is available later:

```bash
cd ~/git/qwibitai/nanoclaw
git fetch origin channels:refs/remotes/origin/channels
```

### 2. Use the standard installer, but seed the custom model endpoint

The working local install here used the normal `nanoclaw.sh` flow, with these environment variables:

```bash
NANOCLAW_NO_DIAGNOSTICS=1 \
POSTGRES_PORT=5433 \
NANOCLAW_ANTHROPIC_BASE_URL=http://host.docker.internal:18080 \
NANOCLAW_ANTHROPIC_AUTH_TOKEN=placeholder \
bash nanoclaw.sh
```

Why this matters:

- the local model endpoint is reachable from the container via `host.docker.internal`
- the auth token is intentionally a placeholder so OneCLI can rewrite the outgoing auth header
- this was done with the **standard** installer path, not the advanced/manual path

### 3. If NanoClaw defaults back to Sonnet, pin the active groups to the served model

For the local Qwen-backed setup here, the active NanoClaw groups needed:

```json
"model": "qwen36-35b"
```

in each active group's:

```text
~/git/qwibitai/nanoclaw/data/v2-sessions/<agent-group-id>/.claude-shared/settings.json
```

In practice, this mattered for both the Discord-facing group and the CLI-facing group. Without this, NanoClaw could fall back to a default Claude model like `claude-sonnet-4-6`, which then failed against the local inference backend.

After editing those settings files, restart the launchd service:

```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw-v2-ccd863cf
```

### 4. Wire the harness into the NanoClaw groups

Use the harness helper to update the target group's `container.json`:

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
```

Run the same command for any DM/Discord group you want the harness mounted into.

This writes the required:

- `mcpServers.multibaas-agent`
- `additionalMounts` entry for this repo
- in-container state dir for watches
- rewritten MultiBaas base URL for container access

### 5. Use OneCLI path-scoped secrets, not raw container env secrets

For NanoClaw-backed runs, do **not** put a real `MULTIBAAS_API_KEY` into `container.json`.

The working setup uses:

- Anthropic-compatible/local model auth scoped to `/v1/*`
- MultiBaas auth scoped to `/api/v0/*`

That means the harness can send a placeholder bearer token and OneCLI rewrites it on the correct path.

This separation matters because both services may be reached through `host.docker.internal`, so host matching alone is not enough.

### 6. Useful cleanup / recovery command

If a previous OneCLI secret install is dirty or duplicated, this was a useful cleanup pattern:

```bash
onecli secrets delete --id <secret-id>
```

Use it to remove stale secrets before recreating them with the correct host/path scope.

## Local MVP target

The current local MVP should prove this loop inside the harness itself:

1. Deploy + link a sample ERC-20 on MultiBaas
2. Mint/distribute balances
3. Save the MultiBaas query `helloworld_balance`
4. Run the local harness and ask for top holders or one address balance
5. Save a whale watch in local state
6. Run the webhook receiver
7. Have MultiBaas deliver `event.emitted` payloads to the shared webhook
8. The harness reevaluates watches and writes alerts

After that is stable, the next layer is:

1. Mount the harness into the NanoClaw agent container
2. Register the harness as an MCP server in NanoClaw `container.json`
3. Route CLI requests and later webhook-driven wakeups through NanoClaw

At the moment, this repo supports both:

- a local `agent` command for immediate natural-language demos
- a stdio MCP server for NanoClaw integration

Important design choice:

- **MultiBaas webhook endpoints are broad event-delivery pipes**
- **The harness owns the actual watch/monitor registry and filtering logic**

That means the normal model is:

- one or a small number of MultiBaas webhook endpoints
- many harness-managed watches

## First tool surface

Keep the initial tool set narrow and high value:

- `get_top_holders`
- `get_address_balance`
- `create_balance_watch`
- `list_watches`

Under the hood these should use:

- `EventQueriesApi.executeArbitraryEventQuery`
- `EventQueriesApi.setEventQuery` / `executeEventQuery` when saved queries help
- `WebhooksApi.createWebhook` / `updateWebhook` / `listWebhooks`

## Hardhat subproject

### Setup

1. `cd hardhat`
2. `npm install`
3. Copy `deployment-config.template.ts` → `deployment-config.<network>.ts` and fill in keys

### Commands

- `npm run deploy` — Deploy + link on MultiBaas (Hardhat v3 + Ignition)
- `npm run mint` — Distribute 1000 HWT: 100 to whale, 900 across 99 random accounts

### MultiBaas

- **Deployment target**: whatever is configured in `hardhat/deployment-config.<network>.ts`
- **Primary local integration surface**: `~/git/curvegrid/multibaas-sdk-typescript`
- **Public docs**:
  - event queries: `https://docs.curvegrid.com/multibaas/api/execute-arbitrary-event-query`
  - webhooks: `https://docs.curvegrid.com/multibaas/webhooks`
- **Web3 routes**:
  - `POST /web3/:token` — URL-key auth, extended whitelist, supports writes like `eth_sendRawTransaction`
  - `POST /web3` — bearer auth, restricted read-only whitelist
- **Admin REST base**: `/api/v0` with bearer admin key
- **Important resources**:
  - contracts: `/api/v0/contracts`
  - event queries: `/api/v0/queries`
  - webhooks: `/api/v0/webhooks`
  - tx submit: `/api/v0/chains/ethereum/transactions/submit`

### Known good notes

- Hardhat v3 + Ignition with `hardhat-multibaas-plugin` v3.0.0
- Network config is loaded from `deployment-config.<network>.ts` at runtime
- Scripts must use `network.getOrCreate("development")` (not `network.connect()`)
- The default local scripts currently target `development`
- Contract is linked on MultiBaas via `mb.link()` in the Ignition module

## Implementation bias

Prefer:

- **typed SDK calls over ad hoc curl**
- **harness-owned query builders over free-form LLM-generated event-query JSON**
- **one reusable webhook ingress + local monitor store** over one webhook per watch
- **NanoClaw MCP integration** over shelling out to arbitrary CLI commands from the agent
- **OneCLI path-scoped secret injection** over raw API keys in NanoClaw `container.json`

For NanoClaw-specific auth wiring:

- keep model-provider secrets scoped to their own API paths (for example `/v1/*`)
- scope MultiBaas credentials to `/api/v0/*`
- allow the harness to use a placeholder bearer token when running in NanoClaw so OneCLI can rewrite it
- do not add a real `MULTIBAAS_API_KEY` to group container env unless there is no safer option

## Naming guidance

The current repo directory name may change later, so new code and docs should stay naming-neutral.

Use capability- or domain-based names instead of repo-name-based names.

Prefer neutral names for:

- package metadata
- env vars
- local state directories
- webhook labels
- CLI text

When adding new surfaces, prefer names tied to the function of the system:

- `MULTIBAAS_*` or other domain-scoped env vars over repo-scoped prefixes
- generic runtime/state paths over repo-name paths
- neutral labels like `balance-watch` over project-branded labels
- user-facing CLI/help text that describes the tool, not the repo

Treat the current repo name as a filesystem location, not as a naming source for new identifiers.
