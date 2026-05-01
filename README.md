# MultiBaas protocol intelligence runtime

This repo is moving toward an **agentic MultiBaas tool runtime**: a system where the model answers protocol questions by composing typed tools and execution services, not by extending a growing library of prompt-specific workflows.

## Documentation map

- `README.md` — quickstart and current repo posture
- `docs/architecture.md` — repo shape, module boundaries, and design direction
- `docs/nanoclaw.md` — NanoClaw setup, auth wiring, restart, and test runbook
- `docs/phase-01.md` — original Phase 01 plan and partially completed implementation record
- `docs/phase-02.md` — current next-phase plan focused on agentic tool composition
- `AGENTS.md` — coding-agent conventions for working in this repo

## North star

The product direction is:

- expose a reusable, typed MultiBaas-backed capability layer
- let the model decompose questions into tool calls
- keep readiness, waiting states, and execution trustworthiness explicit
- avoid hidden token/query defaults and avoid regex-driven workflow growth

The repo still contains some MVP-era operational surfaces, but the main compatibility router and planning shell have been removed. When making changes, prefer the Phase 02 direction in [`docs/phase-02.md`](docs/phase-02.md) over reintroducing workflow-specific routing.

## Current implemented compatibility surface

- query top holders, concentration, balances, and watches dynamically for linked/indexed ERC-20 contracts
- execute an explicitly named saved MultiBaas event query when you provide `--query`
- resolve known token aliases for top-holder requests and ask for clarification when the contract/interface is ambiguous
- look up one address balance
- save a whale watch in local state
- persist a task record for balance-monitor requests
- receive signed MultiBaas-style webhook payloads and reevaluate watches
- expose the same capabilities through a stdio MCP server for NanoClaw

These surfaces are useful for validation and backward compatibility, but they should not be treated as the final architecture.

## Prerequisites

1. Node 22+
2. A populated `hardhat/deployment-config.<network>.ts`
3. The sample token deployed and linked from `hardhat/`

If you need to set up the fixture from scratch:

```bash
cd hardhat
npm install
npm run deploy
npm run mint
```

## Install

```bash
npm install
```

`src/config.ts` will read MultiBaas settings from either:

- `MULTIBAAS_BASE_URL` and `MULTIBAAS_API_KEY`, or
- `hardhat/deployment-config.<network>.ts`

When the runtime runs **inside NanoClaw**, authenticated MultiBaas calls should use **OneCLI path-scoped secret injection** rather than a raw API key in `container.json`. The runtime will send a placeholder bearer token when no direct key is configured so OneCLI can rewrite it on `/api/v0/*` requests.

## Minimal product loop

```bash
# top holders for a linked ERC-20 contract
npm run dev -- query top-holders --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --limit 5

# top-holder concentration for a linked ERC-20 contract
npm run dev -- query concentration --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --limit 5

# one address balance for a token contract
npm run dev -- query balance --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --address 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172

# grounded token investigation
npm run dev -- query investigate --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --limit 5

# save a watch for a token contract
npm run dev -- watch add --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --address 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 --label whale

# inspect watches
npm run dev -- watch list

# inspect persisted tasks
npm run dev -- task list

# reevaluate pending holder-query tasks
npm run dev -- task evaluate

# reevaluate all watches against the latest tracked balance snapshot
npm run dev -- watch evaluate
```

For a legacy saved-query path, pass `--query <saved-query-name>` explicitly.

Local watch state is stored under `.agent-state/`.

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

The webhook handler validates `X-MultiBaas-Signature` and `X-MultiBaas-Timestamp`, refreshes the tracked balance snapshot for each watch source, and appends alerts to `.agent-state/alerts.jsonl`.

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

- `resolve_contract_target`
- `get_token_metadata`
- `investigate_token`
- `get_top_holders`
- `get_holder_concentration`
- `get_address_balance`
- `create_balance_watch`
- `list_balance_watches`
- `list_tasks`
- `evaluate_tasks`
- `evaluate_balance_watches`
- `ensure_event_webhook`

Preferred Phase 02 path:

- `resolve_contract_target` for token resolution and readiness inspection
- `get_token_metadata` for ERC-20 metadata such as name, symbol, decimals, and total supply
- `investigate_token` for grounded token analysis that combines readiness, metadata, concentration, and top-holder context
- `get_top_holders`, `get_holder_concentration`, `get_address_balance`, and `create_balance_watch` for typed analytical and monitoring actions
- those typed tools can work from either `contractAddress` or `tokenName`, so the model does not need a natural-language compatibility router for common ERC-20 questions

## NanoClaw bridge

This repo can write the NanoClaw group config needed to mount the runtime repo and register the MCP server:

```bash
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
```

What that does:

- adds a read-only mount for this repo into the NanoClaw container
- registers the `multibaas-runtime` MCP server in the target group's `container.json`
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

The current capability-first CLI path is working through NanoClaw:

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "how many decimals does 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 have?"
pnpm run chat -- "Investigate token 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59"
pnpm run chat -- "What is the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 for token 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59?"
pnpm run chat -- "Give me the top 5 holders for token 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59"
pnpm run chat -- "Alert me if the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 moves for token 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59"
pnpm run chat -- "List watches"
```

The remaining implemented operational loop is the **event-driven alert loop**: trigger a watched balance change, receive the MultiBaas webhook, and surface the resulting alert back through the runtime.

For the HelloWorld fixture, the deterministic replay path is to submit `transfer(address,uint256)` through the MultiBaas contract-method API using the whale address as `from`/`signer` with `signAndSubmit: true`. The initial deployer balance is exhausted by `hardhat/scripts/mint.ts`, so replaying from the deployer will revert with insufficient balance.
