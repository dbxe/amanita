# Logrunner

A research agent that **jacks into EVM event history** the way a web research agent browses the internet.

Logrunner reaches blockchain state that smart-contract storage can't expose: it queries decoded event logs, builds pivot-table-style aggregations across them, registers webhooks so the chain itself can wake the agent, and correlates evidence across multiple EVM networks. Built for the [ETHGlobal OpenAgents](https://ethglobal.com/events/openagents) hackathon.

The name is a nod to Cyberpunk 2077's netrunners. Logrunner runs through event logs.

---

## What this repo is

This repo is **Logrunner the runtime** — the code that turns natural-language research questions into bounded, decoded blockchain queries and back into grounded answers. It is exposed to a chat interface as an MCP server.

The agent harness around it is NanoClaw, a third-party Dockerized harness integrated as plumbing on a [lightly modified fork](https://github.com/dbxe/nanoclaw) (the `openagents` branch — branch-based feature opt-ins like Discord support are how NanoClaw ships, plus a few small runtime fixes). The core hackathon contribution lives entirely in this repository: the typed event-query substrate, the webhook-driven monitor, the multichain target layer, the incident-shaped demo surface, and ~30 MCP tools wiring it together.

---

## The demo

Four prompts, sent in sequence to a NanoClaw chat channel wired to this MCP server. The scenario is the Arbitrum Security Council's freeze of ~30,765 ETH following the KelpDAO / rsETH exploit.

| # | Prompt | What it shows |
|---|--------|---------------|
| 1 | *"What's going on with Arbitrum governance lately? I heard the council froze some ETH. What's the brief?"* | Real tool call, real live blockchain data. The reply carries a tool-call receipt: which contract, which event, how many blocks scanned. |
| 2 | *"Does the event data show the transaction freezing the ETH?"* | Multichain in one answer. The receipt lists four event streams across Ethereum mainnet (L1 timelock + upgrade executor) and Arbitrum One (L2 timelock + upgrade executor). |
| 3 | *"Has the proposal to release the frozen ETH already landed on chain? If not, let me know when it does."* | The agent takes action, not just reports. It registers a MultiBaas event-emitted webhook and emits an activation receipt. After this, the chain wakes the agent only when the event actually fires — no polling. |
| 4 | *"By the way, who are the top ARB token holders on Ethereum?"* | State that contract storage can't enumerate. There is no `getAllHolders` on an ERC-20; Logrunner derives the live balance sheet by aggregating every `Transfer` event the token has ever emitted. |

Every reply embeds an `event_query` block with the exact tool call, target contract, event filter, and number of events scanned. That receipt is the part that makes the agent feel grounded rather than ungrounded.

The full transcript is in [`docs/demo-log.md`](docs/demo-log.md). The script and pass criteria are in [`docs/phase-03-demo-script.md`](docs/phase-03-demo-script.md).

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
│  NanoClaw  (Dockerized agent harness — third-party)             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Inference provider                                      │   │
│  │  • llama-swap → local Gemma 4 26B A4B    (recording)     │   │
│  │  • OpenCode → 0G Galileo / Qwen 2.5 7B   (hosted demo)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │  MCP (stdio)                       │
└────────────────────────────┼────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Logrunner runtime  ◄── this repo                               │
│  • event-view spec compiler (typed pivot tables over events)    │
│  • event-monitor service (webhook registration + dispatch)      │
│  • multichain target resolver                                   │
│  • incident-shaped surfaces (KelpDAO frozen-ETH demo)           │
│  • ~30 MCP tools                                                │
│  • local CLI mirroring the same operations                      │
└────────────────────────────┬────────────────────────────────────┘
                             │  REST  ( /api/v0/* — one client per backend profile )
                ┌────────────┴────────────┐
                ▼                         ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  MultiBaas instance         │  │  MultiBaas instance         │
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

Each MultiBaas instance ([Curvegrid](https://www.curvegrid.com/multibaas)) is a separate deployment indexing exactly one EVM chain. Logrunner's backend registry holds one client per chain and routes each typed query to the right profile. The "multichain" feel comes from this layer fanning out concurrently, not from a single MultiBaas talking to multiple chains.

Two MultiBaas capabilities carry the demo. Logrunner adds a typed substrate around both so the LLM can compose them safely.

### Event queries

MultiBaas indexes and decodes every emitted event for a linked contract. Logrunner's `event-view` module ([`src/event-view.ts`](src/event-view.ts)) is a bounded, typed spec compiler that turns a structured view definition — selected fields, filters by indexed inputs, unions of compatible event streams, group-by, and aggregators (`add`, `subtract`, `first`, `last`, `min`, `max`) — into a MultiBaas event query.

This matters because much of EVM state isn't readable from contract storage. ERC-20 holders, governance proposal histories, timelock execution traces, and pool liquidity over time all live in the event log. The event-view layer is the substrate that lets the agent treat that log as a queryable database.

### Webhook monitors

The `event-monitor` service ([`src/event-monitor-service.ts`](src/event-monitor-service.ts)) registers a MultiBaas `event.emitted` webhook, persists a marker filter alongside it, and routes incoming deliveries through a signature-validated local ingress ([`src/webhook-service.ts`](src/webhook-service.ts)) that dispatches matches back to the NanoClaw session. The agent does not poll. The chain calls back.

### Multichain

A backend registry maps named profiles (e.g. `mainnet-remote`, `arbitrum-one-remote`) to MultiBaas instances ([`src/config.ts`](src/config.ts), [`src/multichain-service.ts`](src/multichain-service.ts)). The same query primitives work across networks, and the `inspect_targets_across_backends` tool runs them concurrently so a single answer can correlate L1 and L2 evidence.

---

## What's real, what's scaffolded

Honest scope, in plain language.

**Real, in the demo:**

- The blockchain data is live. Every `event_query` receipt corresponds to an actual MultiBaas API call against a live deployment indexing Ethereum mainnet or Arbitrum One.
- The webhook in beat 3 is a real MultiBaas `event.emitted` registration. When (or if) a matching `ProposalCreated` event fires, the agent gets woken up.
- The holder reconstruction in beat 4 is a genuine `Transfer` aggregation, not a static snapshot.
- The multichain split in beat 2 is two MultiBaas instances queried concurrently.

**Scripted / scaffolded:**

- The four demo prompts are scenario-shaped, and the event-query templates powering each beat are handcrafted for this incident (see [`src/arbitrum-governance-incident-service.ts`](src/arbitrum-governance-incident-service.ts)). The agent picks among them via tool descriptions, but the queries themselves are not yet composed by the model on the fly.
- MultiBaas requires each contract to be **pre-linked and synced** before the agent can query it. This is not yet ad-hoc against any contract on any chain.
- The recording uses a **local model** (Gemma 4 26B A4B served by llama-swap) for responsiveness. The hosted version uses **0G's Galileo testnet** (Qwen 2.5 7B) — a smaller model, with the longer-term framing that DAOs and dApps could fund their own agent deployments with onchain resources and token-paid inference.

The next milestone is collapsing the scaffolded layer: letting the model compose event-view specs directly from the typed substrate, rather than choosing among incident-shaped wrappers.

---

## Repo layout

```
src/
  event-view.ts                          ← typed event-query spec
  event-view-service.ts                  ← runtime execution + formatting
  event-monitor-service.ts               ← webhook-backed monitors
  webhook-service.ts                     ← signature-validated ingress
  multichain-service.ts                  ← cross-backend target inspection
  arbitrum-governance-incident-service.ts ← demo-specific surfaces
  arbitrum-dao-service.ts                ← Arbitrum DAO contract registry
  multibaas.ts                           ← SDK integration layer
  config.ts                              ← per-profile config resolution
  mcp.ts                                 ← stdio MCP surface
  nanoclaw.ts                            ← NanoClaw container.json helper
  index.ts                               ← local CLI entrypoint
  ...                                    ← typed services, holders, tasks, watches
hardhat/                                 ← local fixture (deploy + mint a sample token)
docs/                                    ← architecture, runbooks, demo scripts
```

A more granular module map lives in [`AGENTS.md`](AGENTS.md).

---

## Running locally

Prerequisites: Node 22+, a MultiBaas backend you can reach, and (for the chat path) NanoClaw running on the host.

```bash
npm install
npm run build
```

Configure MultiBaas via either:

- env vars: `MULTIBAAS_BASE_URL` + `MULTIBAAS_API_KEY`
- a backend registry: `.multibaas/backends.local.json` selected by `MULTIBAAS_PROFILE` (see `.multibaas/backends.example.json`)
- the local hardhat fixture: `hardhat/deployment-config.<network>.ts`

### Local CLI (no agent)

Every MCP tool has a CLI counterpart. Useful for development and for verifying answers when the agent looks suspicious.

```bash
npm run dev -- backend list
npm run dev -- query arbitrum-governance-incident --focus brief --limit 3
npm run dev -- query multichain-inspect --targets l1@mainnet-remote:0xE684...,l2@arbitrum-one-remote:0x34d4...
npm run dev -- query event-investigation --contract 0xb50721bcf8d664c30412cfbc6cf7a15145234ad1 --lead holder_distribution --limit 10
```

### MCP server

```bash
npm run mcp
```

This is the entrypoint NanoClaw mounts. The full list of tools is in [`src/mcp.ts`](src/mcp.ts).

### NanoClaw integration

This repo can write the NanoClaw group config needed to mount the runtime and register the MCP server:

```bash
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
```

Operational runbook (preflight, reset, stale-session recovery, secret injection): [`docs/nanoclaw.md`](docs/nanoclaw.md).

### Webhook receiver

For beat 3 to actually fire, MultiBaas needs a reachable callback URL:

```bash
npm run dev -- webhook serve --secret <webhook-secret> --port 8787
npm run dev -- webhook ensure --url https://your-host.example/webhooks/multibaas
```

Signature validation, persisted monitor evaluation, and alert routing are handled in [`src/webhook-service.ts`](src/webhook-service.ts).

---

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — module boundaries, design direction, pressure points
- [`docs/phase-03-demo-script.md`](docs/phase-03-demo-script.md) — the four-beat demo with pass/fail criteria
- [`docs/demo-log.md`](docs/demo-log.md) — captured transcript from the recording pass
- [`docs/nanoclaw.md`](docs/nanoclaw.md) — NanoClaw setup, auth, preflight, reset
- [`docs/nanoclaw-live-tests.md`](docs/nanoclaw-live-tests.md) — live validation matrix
- [`docs/research-event-query-use-cases.md`](docs/research-event-query-use-cases.md) — the broader space of investigations event queries unlock
- [`AGENTS.md`](AGENTS.md) — repo conventions for coding agents and maintainers

---

## Credits

- [NanoClaw](https://nanoclaw.dev) — agent harness
- [MultiBaas](https://www.curvegrid.com/multibaas) — Curvegrid's blockchain backend platform; the indexing, event-query, and webhook substrate Logrunner builds on
- [0G](https://0g.ai) — inference backend for the hosted demo
- ETHGlobal OpenAgents — the hackathon
