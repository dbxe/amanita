# MultiBaas agent harness

Minimal MultiBaas event-query and webhook loop for the hackathon MVP.

## What works now

- query the saved MultiBaas event query `helloworld_balance`
- show top holders
- look up one address balance
- save a whale watch in local state
- receive signed MultiBaas-style webhook payloads and reevaluate watches

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

## Next layer

The current MVP is **harness-only**. The next step is to wrap these commands in a thin MCP server and mount that into NanoClaw.
