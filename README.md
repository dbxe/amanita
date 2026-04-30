# MultiBaas agent harness

Minimal MultiBaas event-query and webhook loop for the hackathon MVP.

## Documentation map

- `README.md` — quickstart, working commands, and current MVP status
- `docs/architecture.md` — repo shape, module boundaries, and design direction
- `docs/nanoclaw.md` — NanoClaw setup, auth wiring, restart, and test runbook
- `docs/phase-01.md` — next-phase product and architecture direction
- `AGENTS.md` — coding-agent conventions for working in this repo

## What works now

- query the saved MultiBaas event query `helloworld_balance`
- show top holders
- compute top-holder concentration
- query top holders and concentration for linked, indexed ERC-20 contract addresses
- resolve known token aliases for top-holder requests and ask for clarification when the contract/interface is ambiguous
- look up one address balance
- save a whale watch in local state
- persist a task record for balance-monitor requests
- receive signed MultiBaas-style webhook payloads and reevaluate watches
- accept a small set of natural-language intents through a local `agent` command
- expose the same capabilities through a stdio MCP server for NanoClaw

## Prerequisites

1. Node 22+
2. A populated `hardhat/deployment-config.<network>.ts`
3. The sample token deployed and linked from `hardhat/`
4. The saved query `helloworld_balance` created on MultiBaas

If you need to set up the fixture from scratch:

```bash
cd hardhat
npm install
npm run deploy
npm run mint
npm run setup-event-query
```

## Install

```bash
npm install
```

`src/config.ts` will read MultiBaas settings from either:

- `MULTIBAAS_BASE_URL` and `MULTIBAAS_API_KEY`, or
- `hardhat/deployment-config.<network>.ts`

When the harness runs **inside NanoClaw**, authenticated MultiBaas calls should use **OneCLI path-scoped secret injection** rather than a raw API key in `container.json`. The harness will send a placeholder bearer token when no direct key is configured so OneCLI can rewrite it on `/api/v0/*` requests.

## Minimal product loop

```bash
# top holders
npm run dev -- query top-holders --limit 5

# top holders for a linked ERC-20 contract
npm run dev -- query top-holders --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --limit 5

# top-holder concentration
npm run dev -- query concentration --limit 5

# top-holder concentration for a linked ERC-20 contract
npm run dev -- query concentration --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --limit 5

# one address balance
npm run dev -- query balance --address 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172

# save a watch
npm run dev -- watch add --address 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 --label whale

# inspect watches
npm run dev -- watch list

# inspect persisted tasks
npm run dev -- task list

# reevaluate pending holder-query tasks
npm run dev -- task evaluate

# reevaluate all watches against the latest saved-query snapshot
npm run dev -- watch evaluate
```

Local watch state is stored under `.agent-state/`.

## Local intent demo

This is the fastest end-to-end demo path right now:

```bash
npm run dev -- agent "Give me the top 5 holders"
npm run dev -- agent "Give me the top 5 holders for token 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5"
npm run dev -- agent "What are the top balances of sampletoken?"
npm run dev -- agent "What is the top 5 holder concentration?"
npm run dev -- agent "What is the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172?"
npm run dev -- agent "Alert me if the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 moves"
```

For ERC-20 holder requests, the agent now:

- asks for clarification when the request names only an address but not the interface
- resolves known token aliases like `sampletoken`
- asks for the contract address when the token name is unknown
- checks readiness before answering
- persists waiting holder-query tasks and exposes `task evaluate` for follow-up checks

The `agent` command currently recognizes:

- top-holder requests
- holder-concentration requests
- single-address balance requests
- balance-watch creation
- list watches
- list tasks
- evaluate watches

## Webhooks

Run the local webhook receiver:

```bash
npm run dev -- webhook serve --secret <webhook-secret> --port 8787
```

To have webhook-triggered alerts delivered back through a NanoClaw session, add the NanoClaw target flags:

```bash
npm run dev -- webhook serve \
  --secret <webhook-secret> \
  --port 8787 \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder dm-with-<name>
```

When you have a reachable callback URL, register or update the shared MultiBaas webhook:

```bash
npm run dev -- webhook ensure --url https://your-host.example/webhooks/multibaas
```

The webhook handler validates `X-MultiBaas-Signature` and `X-MultiBaas-Timestamp`, refreshes the saved-query snapshot, and appends alerts to `.agent-state/alerts.jsonl`.

When you evaluate a watch that was created inside a NanoClaw group, point the host-side receiver at that group's state directory instead of the repo root:

```bash
MULTIBAAS_AGENT_STATE_DIR=~/git/qwibitai/nanoclaw/groups/cli-with-<name>/.agent-state \
  npm run dev -- webhook serve --secret <webhook-secret> --port 8787
```

## MCP server

The same live operations are also exposed over stdio MCP:

```bash
npm run mcp
```

Tools exposed:

- `get_top_holders`
- `get_holder_concentration`
- `get_address_balance`
- `create_balance_watch`
- `list_balance_watches`
- `list_tasks`
- `evaluate_tasks`
- `evaluate_balance_watches`
- `ensure_event_webhook`

`get_top_holders` accepts optional `contractAddress` and `tokenName` inputs for the ERC-20 onboarding flow, and `get_holder_concentration` also accepts an optional `contractAddress` for linked ERC-20 contracts.

## NanoClaw bridge

This repo can write the NanoClaw group config needed to mount the harness repo and register the MCP server:

```bash
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
```

What that does:

- adds a read-only mount for this repo into the NanoClaw container
- registers the `multibaas-agent` MCP server in the target group's `container.json`
- rewrites a host-local MultiBaas base URL like `localhost` to `host.docker.internal` for container access
- sets a stable in-container state directory for balance watches
- optionally adds this repo to NanoClaw's mount allowlist

NanoClaw itself still needs to be installed and initialized separately (`pnpm install`, credentials, group/session setup, daemon running).

For the working local NanoClaw install pattern, model pinning, OneCLI path-scoped secrets, restart flow, and deterministic test path, see [`docs/nanoclaw.md`](docs/nanoclaw.md).

You can also queue a manual notification into NanoClaw's normal outbound delivery path:

```bash
npm run dev -- nanoclaw notify \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder dm-with-<name> \
  --text "test alert"
```

## Next layer

The current local demo path is working through NanoClaw CLI:

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "What is the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172?"
pnpm run chat -- "Give me the top 5 holders for the token"
pnpm run chat -- "Alert me if the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 moves"
pnpm run chat -- "List watches"
```

The remaining MVP step is the **event-driven alert loop**: trigger a watched balance change, receive the MultiBaas webhook, and surface the resulting alert back through the runtime.

For the HelloWorld fixture, the deterministic replay path is to submit `transfer(address,uint256)` through the MultiBaas contract-method API using the whale address as `from`/`signer` with `signAndSubmit: true`. The initial deployer balance is exhausted by `hardhat/scripts/mint.ts`, so replaying from the deployer will revert with insufficient balance.
