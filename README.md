# Logrunner

Logrunner is a Web3 intelligence runtime for agents. It lets a chat agent query decoded EVM event history, aggregate it into evidence, register webhook-backed monitors, and correlate results across multiple MultiBaas-backed networks.

The short version: Logrunner gives an agent a typed way to use blockchain event logs the way a web research agent uses search results. It is built for the [ETHGlobal OpenAgents](https://ethglobal.com/events/openagents) hackathon.

---

## What This Repo Is

This repo contains the runtime, not the chat harness. It exposes reusable MultiBaas-backed capabilities through:

- a local CLI for deterministic development and debugging
- a stdio MCP server for agent use
- a webhook ingress for event-triggered follow-up work
- NanoClaw configuration helpers for mounting the runtime into a chat agent

The agent harness used in the demo is NanoClaw, integrated through a [lightly modified fork](https://github.com/dbxe/nanoclaw) on the `openagents` branch. NanoClaw handles Discord, sessions, containers, and model-provider plumbing. The fork carries branch-based feature opt-ins such as Discord/OpenCode support plus a few small runtime fixes. This repo owns the Web3 intelligence layer: typed event views, MultiBaas integration, event monitors, multichain target inspection, token-holder analysis, and the Arbitrum governance demo surfaces.

The project direction is **agentic tool composition over typed blockchain capabilities**. The current demo has some incident-shaped wrappers so the live path is reliable, but the reusable substrate lives below those wrappers.

---

## Demo Story

The current demo is a four-beat Discord conversation about Arbitrum governance after the KelpDAO / rsETH exploit, where the Arbitrum Security Council froze about 30,765 ETH.

| # | Prompt | What It Shows |
|---|---|---|
| 1 | "What's going on with Arbitrum governance lately? I heard the council froze some ETH. What's the brief?" | A grounded incident brief backed by a live `ProposalCreated` event-query preflight on the Arbitrum Core Governor. |
| 2 | "Does the event data show the transaction freezing the ETH?" | Evidence boundaries. The agent checks L1/L2 timelock and executor event streams and says what those events do and do not prove. |
| 3 | "Has the proposal to release the frozen ETH already landed on chain? If not, let me know when it does." | Action, not just reporting. The runtime registers a MultiBaas `event.emitted` webhook-backed monitor for the next binding `ProposalCreated` signal. |
| 4 | "By the way, who are the top ARB token holders on Ethereum?" | Event-derived state. ERC-20 contracts do not expose `getAllHolders`; Logrunner reconstructs holders by aggregating `Transfer` events. |

The important UX detail is the receipt block. Replies include compact fenced blocks such as:

```event_query
query: multibaas.eventQuery
stream: arbitrum-one-remote (Arbitrum One) | Core Governor `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9` / ProposalCreated
fields: proposal metadata + execution payload + description
match: Kelp | rsETH | frozen ETH | DeFi United | 30765 | 30,765 | `0x0000000000000000000000000000000000000DA0`
```

That makes the answer feel like cited process rather than unsupported narration: what stream was checked, what fields mattered, what matched, and what did not.

See:

- [`docs/phase-03-demo-script.md`](docs/phase-03-demo-script.md) for the demo beats and pass criteria
- [`docs/nanoclaw-live-tests.md`](docs/nanoclaw-live-tests.md) for broader live validation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  User                                                           │
│  Discord channel  /  local CLI socket                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │  chat message
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  NanoClaw  (Dockerized agent harness — lightly modified fork)   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Inference provider                                      │   │
│  │  • local OpenAI-compatible endpoint for recording        │   │
│  │  • hosted provider path for demo deployment              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │  MCP (stdio)                       │
└────────────────────────────┼────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Logrunner runtime  ◄── this repo                               │
│  • event-view spec compiler (typed pivot tables over events)    │
│  • event-monitor service (webhook registration + dispatch)      │
│  • multichain target resolver                                   │
│  • incident-shaped surfaces (KelpDAO frozen ETH demo)           │
│  • MCP tools                                                    │
│  • local CLI mirroring the same operations                      │
└────────────────────────────┬────────────────────────────────────┘
                             │  REST  (/api/v0/* — one client per backend profile)
                ┌────────────┴────────────┐
                ▼                         ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  MultiBaas deployment       │  │  MultiBaas deployment       │
│  profile: mainnet-remote    │  │  profile: arbitrum-one-     │
│                             │  │           remote            │
│  • indexes & decodes events │  │  • indexes & decodes events │
│  • event-query API          │  │  • event-query API          │
│  • signed event webhooks    │  │  • signed event webhooks    │
└──────────────┬──────────────┘  └──────────────┬──────────────┘
               │  RPC                           │  RPC
               ▼                                ▼
       Ethereum mainnet                    Arbitrum One
```

Each MultiBaas deployment indexes one EVM chain. Logrunner's backend registry maps profile names such as `mainnet-remote` and `arbitrum-one-remote` to those deployments, then routes typed operations to the right profile. Cross-chain answers are fan-out over multiple configured backends, not one magical multichain backend.

### Event Views

MultiBaas can query decoded events for linked contracts. Logrunner adds a bounded intermediate layer in [`src/event-view.ts`](src/event-view.ts): a typed event-view spec that describes fields, filters, compatible event unions, group keys, and aggregators such as `add`, `subtract`, `first`, `last`, `min`, and `max`.

That layer matters because important EVM state often lives in the event log rather than current storage:

- ERC-20 holder sets
- governance proposal histories
- timelock scheduling and execution traces
- upgrade-executor activity
- issuer, role, blacklist, pause, and ownership histories
- protocol activity ledgers for pools and other event-heavy contracts

The model should not author arbitrary backend JSON by default. It should compose typed capabilities that compile into safe event queries.

### Webhook Monitors

[`src/event-monitor-service.ts`](src/event-monitor-service.ts) persists monitor definitions and registers a reusable MultiBaas `event.emitted` webhook. [`src/webhook-service.ts`](src/webhook-service.ts) validates webhook signatures, evaluates local monitor filters, records alerts, and can notify NanoClaw.

For the Arbitrum release proposal beat, the runtime does not schedule a polling task. MultiBaas calls the webhook when the chain emits relevant events; the local runtime then filters for the incident markers before waking the agent.

### Multichain Targets

[`src/config.ts`](src/config.ts), [`src/multibaas.ts`](src/multibaas.ts), and [`src/multichain-service.ts`](src/multichain-service.ts) keep chain identity explicit. MultiBaas's EVM API path still uses `/chains/ethereum/...` even when a deployment is indexing Arbitrum, so Logrunner treats chain identity as backend-profile metadata, not as something inferred from that URL fragment.

---

## Current Scope

**Real in the demo:**

- Live MultiBaas API calls against Ethereum mainnet and Arbitrum One deployments.
- Decoded event-query receipts copied into the agent's answer.
- A real MultiBaas `event.emitted` webhook registration for the proposal monitor.
- ERC-20 holder reconstruction from `Transfer` event deltas.
- Cross-backend inspection across separate MultiBaas profiles.

**Still scaffolded:**

- The Arbitrum frozen ETH incident path uses handcrafted capability wrappers in [`src/arbitrum-governance-incident-service.ts`](src/arbitrum-governance-incident-service.ts). The model chooses and synthesizes from these tools, but it is not yet freely composing every incident query from first principles.
- Contracts generally need to be known, ABI-linked, and sufficiently indexed before historical event queries are useful.
- Some live-network answers must report sync readiness or partial indexed state instead of pretending a complete view is available.
- NanoClaw is integration plumbing. Useful fixes live in the fork, but this repo should not become a workflow-specific harness shell.

The next step is to collapse more of the incident-specific surface into general event-capability discovery and typed event-view composition.

---

## Repo Layout

```text
src/
  config.ts                         runtime and backend-profile config
  multibaas.ts                      MultiBaas SDK wrapper and low-level helpers
  event-view.ts                     typed event-query spec compiler
  event-view-service.ts             event-view execution and formatting
  event-intelligence-service.ts     ABI/event-surface inspection and lead execution
  event-monitor-service.ts          webhook-backed event monitors
  webhook-service.ts                local signed webhook ingress
  token-target-service.ts           token/address target resolution
  holder-query-service.ts           holder query orchestration and readiness
  views.ts                          holder, balance, and concentration view formatting
  multichain-service.ts             explicit cross-backend inspection
  arbitrum-dao-service.ts           bounded Arbitrum DAO target registry
  arbitrum-governance-incident-service.ts
                                    current demo-specific incident surface
  mcp.ts                            stdio MCP server
  nanoclaw.ts                       NanoClaw container.json helper
  index.ts                          local CLI

docs/                               architecture, runbooks, demo scripts
.agent-state/                       local task, watch, webhook, and alert state
```

For a more granular maintainer map, see [`AGENTS.md`](AGENTS.md).

---

## Running Locally

Requirements:

- Node 22+
- a reachable MultiBaas deployment
- NanoClaw only if you want the chat-agent path

Install and build:

```bash
npm install
npm run build
```

Configure MultiBaas with one of:

- `MULTIBAAS_BASE_URL` and `MULTIBAAS_API_KEY`
- `.multibaas/backends.local.json` selected by `MULTIBAAS_PROFILE`
- `MULTIBAAS_BACKENDS_JSON`

See `.multibaas/backends.example.json` for the backend-registry shape.

### Local CLI

Use the CLI to verify tool behavior before blaming the agent:

```bash
npm run dev -- backend list
npm run dev -- query arbitrum-governance-incident --focus brief --limit 3
npm run dev -- query arbitrum-governance-incident --focus monitor --limit 3
npm run dev -- query top-holders --token ARB --limit 10
npm run dev -- query multichain-inspect --targets mainnet-remote:0xE6841D92B0C345144506576eC13ECf5103aC7f49,arbitrum-one-remote:0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0
```

### MCP Server

```bash
npm run mcp
```

NanoClaw mounts the built MCP entrypoint at:

```text
/workspace/extra/multibaas-runtime/dist/mcp.js
```

After changing `src/mcp.ts`, `src/nanoclaw.ts`, or tool behavior that the chat agent depends on, run:

```bash
npm run build
```

### NanoClaw Integration

Configure a NanoClaw group to mount this repo and expose the MCP server:

```bash
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder openagent \
  --write-allowlist
```

Check the live integration:

```bash
npm run dev -- nanoclaw preflight \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder openagent
```

Reset a poisoned or overfull chat session:

```bash
npm run dev -- nanoclaw reset-group \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder openagent
```

The full runbook is [`docs/nanoclaw.md`](docs/nanoclaw.md).

### Webhook Receiver

For webhook-backed monitors, MultiBaas needs a reachable callback URL:

```bash
npm run dev -- webhook serve \
  --port 8787 \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder openagent

npm run dev -- webhook ensure \
  --url https://your-host.example/webhooks/multibaas
```

For local demos, a tunnel such as ngrok or localtunnel can provide the public URL. In a deployed VM, use the VM's public HTTPS endpoint instead.

---

## Testing

```bash
npm test
```

`npm test` builds the TypeScript output and runs the Node test suite against `dist/**/*.test.js`.

For live NanoClaw work, use this order:

1. `npm test`
2. `npm run build`
3. `npm run dev -- nanoclaw configure ...` if MCP config or generated instructions changed
4. `npm run dev -- nanoclaw preflight ...`
5. deterministic CLI query
6. Discord or DM validation

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — module boundaries and design direction
- [`docs/nanoclaw.md`](docs/nanoclaw.md) — NanoClaw setup, auth, preflight, reset, and stale-session recovery
- [`docs/phase-03-demo-script.md`](docs/phase-03-demo-script.md) — four-beat demo and pass criteria
- [`docs/nanoclaw-live-tests.md`](docs/nanoclaw-live-tests.md) — live validation matrix
- [`docs/research-event-query-use-cases.md`](docs/research-event-query-use-cases.md) — broader event-query investigation space
- [`docs/archive/`](docs/archive/) — historical phase notes and detailed research drafts
- [`AGENTS.md`](AGENTS.md) — repo conventions for coding agents and maintainers

---

## Credits

- [MultiBaas](https://www.curvegrid.com/multibaas), Curvegrid's blockchain backend platform
- [NanoClaw](https://nanoclaw.dev), the agent harness used for chat integration
- [0G](https://0g.ai), hosted inference path for the OpenAgents demo
- ETHGlobal OpenAgents
