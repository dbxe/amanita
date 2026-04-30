# MultiBaas agent harness

Minimal MultiBaas event-query and webhook loop for the hackathon MVP.

## What works now

- query the saved MultiBaas event query `helloworld_balance`
- show top holders
- look up one address balance
- save a whale watch in local state
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

## Minimal product loop

```bash
# top holders
npm run dev -- query top-holders --limit 5

# one address balance
npm run dev -- query balance --address 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172

# save a watch
npm run dev -- watch add --address 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 --label whale

# inspect watches
npm run dev -- watch list

# reevaluate all watches against the latest saved-query snapshot
npm run dev -- watch evaluate
```

Local watch state is stored under `.agent-state/`.

## Local intent demo

This is the fastest end-to-end demo path right now:

```bash
npm run dev -- agent "Give me the top 5 holders"
npm run dev -- agent "What is the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172?"
npm run dev -- agent "Alert me if the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 moves"
```

The `agent` command currently recognizes:

- top-holder requests
- single-address balance requests
- balance-watch creation
- list watches
- evaluate watches

## Webhooks

Run the local webhook receiver:

```bash
npm run dev -- webhook serve --secret <webhook-secret> --port 8787
```

When you have a reachable callback URL, register or update the shared MultiBaas webhook:

```bash
npm run dev -- webhook ensure --url https://your-host.example/webhooks/multibaas
```

The webhook handler validates `X-MultiBaas-Signature` and `X-MultiBaas-Timestamp`, refreshes the saved-query snapshot, and appends alerts to `.agent-state/alerts.jsonl`.

## MCP server

The same live operations are also exposed over stdio MCP:

```bash
npm run mcp
```

Tools exposed:

- `get_top_holders`
- `get_address_balance`
- `create_balance_watch`
- `list_balance_watches`
- `evaluate_balance_watches`
- `ensure_event_webhook`

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
- optionally adds this repo to NanoClaw's mount allowlist

NanoClaw itself still needs to be installed and initialized separately (`pnpm install`, credentials, group/session setup, daemon running).

## Next layer

The current local demo path is working. The next full runtime step is to initialize NanoClaw locally, wire a CLI group, and message the mounted MCP-backed agent through `pnpm run chat ...`.
