# Amanita

## What this repo is for

This repo is the hackathon submission workspace for an **event-driven Web3 agent harness** built around:

- **MultiBaas Event Queries** for event-sourced views over EVM contracts
- **MultiBaas Webhooks** for waking the system on new onchain events
- **NanoClaw** as the local agent host/runtime
- **Amanita** as the integration layer / "secret sauce"

Core product idea:

1. User asks for a derived onchain view in natural language
2. Agent uses MultiBaas event queries to reconstruct hidden or non-enumerable state
3. User saves a monitor/watch
4. MultiBaas webhook fires later
5. Amanita wakes the agent and the user gets an updated explanation / alert

## Current repo shape

This repo currently contains a `hardhat/` subproject used as the **chain fixture + deployment helper** for local demos:

- deploy a sample ERC-20
- link it on MultiBaas
- mint/distribute balances so holder queries are meaningful

The **Amanita app/integration logic should live outside `hardhat/`**. Treat `hardhat/` as the local contract/test-data setup, not the final agent runtime.

## Chosen local architecture

We are **not** building on heavy OpenClaw.

We are using **NanoClaw** as the local host because it already provides:

- a long-running local daemon
- persistent SQLite-backed state
- a built-in `cli/local` channel for local testing
- agent containers
- support for extra **MCP servers** via `container.json`

Amanita should be structured as:

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

## Local MVP target

The local MVP should prove this loop:

1. Deploy + link a sample ERC-20 on MultiBaas
2. Mint/distribute balances
3. Run NanoClaw locally and wire an agent to `cli/local`
4. Mount Amanita into the NanoClaw agent container
5. Register Amanita as an MCP server in NanoClaw `container.json`
6. Ask:
   - "Give me the top 20 holders for token X"
7. Amanita executes a MultiBaas event query and returns a readable answer
8. Ask:
   - "Alert me if whale Y moves balance"
9. Amanita stores the watch, creates/reuses a shared MultiBaas webhook, and later wakes NanoClaw when a matching event arrives

Important design choice:

- **MultiBaas webhook endpoints are broad event-delivery pipes**
- **Amanita owns the actual watch/monitor registry and filtering logic**

That means the normal model is:

- one or a small number of MultiBaas webhook endpoints
- many Amanita-managed watches

## First Amanita tool surface

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
- **Amanita-owned query builders over free-form LLM-generated event-query JSON**
- **one reusable webhook ingress + local monitor store** over one webhook per watch
- **NanoClaw MCP integration** over shelling out to arbitrary CLI commands from the agent
