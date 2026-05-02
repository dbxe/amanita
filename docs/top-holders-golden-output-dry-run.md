# Top Holders Golden Output Dry Run

Date: 2026-05-03

## Target Prompt

```text
Who are the top holders of ARB on Ethereum mainnet?
```

Expected tool route:

- `get_top_holders`
- `tokenName`: `ARB`
- `limit`: `10`
- backend: `mainnet-remote` / Ethereum mainnet

## Live Dry Run

Command:

```bash
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query top-holders --token ARB --limit 10
```

Current result: the runtime now returns a partial indexed snapshot while preserving the sync caveat.

````text
Verdict: current indexed top 10 holder snapshot; historical Transfer sync is still in progress, so rankings may move.

Checked
- Network: Ethereum mainnet (`mainnet-remote`)
- Token: L1 bridged ARB `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`
- Capability: ERC-20 holder reconstruction from Transfer events
- Sync status: Contract 0xb50721bcf8d664c30412cfbc6cf7a15145234ad1 is still syncing historical Transfer events (start block 0; latest observed head 24785512; updated 2026-05-02T20:29:59.61696Z).

Top 10 holders

| Rank | Holder | Raw balance |
| ---: | --- | ---: |
| 1 | `0x611f7bf868a6212f871e89f7e44684045ddfb09d` | 89745309240000000000000000 |
| 2 | `0x91d40e4818f4d4c57b4578d9eca6afc92ac8debe` | 10976072722423065800000000 |
| 3 | `0x221f8e99408f730981bfc311eb9372dc353f3ac0` | 8587683339797070000000012 |
| 4 | `0x4a4aaa0155237881fbd5c34bfae16e985a7b068d` | 4381289410400060000000000 |
| 5 | `0x92ea7496eba5f001d620005f88f3e8e686e3d4ea` | 3157759160000000000000006 |
| 6 | `0xbb3c6d28def21b6297016622a57a0b05015e3ad2` | 2529539978543000000000000 |
| 7 | `0x85dcd76d4fbd3aa0c85c27b9441222c19a14134b` | 2263028486958000000000000 |
| 8 | `0x9642b23ed1e01df1092b92641051881a322f5d4e` | 2000302184426233856695996 |
| 9 | `0x3cc936b795a188f0e246cbb2d74c5bd190aecf18` | 1836648020297630380197470 |
| 10 | `0xd87e2ac6ea9d7ec1256631830e29336b0b6116e8` | 1686436451857029672417627 |

```event_query
query: multibaas.eventQuery
purpose: reconstruct current ERC-20 holders from Transfer deltas
stream: mainnet-remote (Ethereum mainnet) | Token `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1` / Transfer
fields: from + to + value + block number + tx hash + timestamp
aggregation: add value to `to`; subtract value from `from`; rank positive balances descending
source: contract:0xb50721bcf8d664c30412cfbc6cf7a15145234ad1
limit: top 10 positive balances
status: syncing historical events; partial indexed snapshot
```

Boundary: do not infer total supply, percentages, or concentration from this holder list alone. Use holder concentration for that.
````

Readiness check:

```text
Contract interface inspection

Address: 0xb50721bcf8d664c30412cfbc6cf7a15145234ad1
Readiness: syncing

Linked contracts
- arbtokenethereum 1.0
  name: L1ArbitrumToken
  matches: erc20interface
  tags: erc20, metadata, balances, allowances, holders
```

Dry-run conclusion: the token target is correct and ERC-20 holder analytics are the right capability. The current mainnet ARB holder answer can return the indexed rows that exist now, but must label them as partial until historical `Transfer` sync is complete.

## Desired Syncing Response

If the user asks before the backend is ready, the answer should still show the current indexed rows and make the incompleteness explicit:

````text
Verdict: current indexed ARB holder snapshot on Ethereum mainnet; historical Transfer sync is still in progress, so rankings may move.

Checked:
- Network: Ethereum mainnet (`mainnet-remote`)
- Token: L1 bridged ARB (`0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1`)
- Interface: `arbtokenethereum 1.0`
- Capability: ERC-20 holder reconstruction from `Transfer` events

Top holders:

| Rank | Holder | Raw ARB balance |
| ---: | --- | ---: |
| 1 | `<holder_1>` | `<raw_balance_1>` |
| 2 | `<holder_2>` | `<raw_balance_2>` |
| 3 | `<holder_3>` | `<raw_balance_3>` |

```event_query
query: multibaas.eventQuery
purpose: reconstruct current ERC-20 holders from Transfer deltas
stream: mainnet-remote (Ethereum mainnet) | L1 bridged ARB `0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1` / Transfer
fields: from + to + value + block number + tx hash + timestamp
aggregation: add value to `to`; subtract value from `from`; rank positive balances descending
source: contract:0xb50721bcf8d664c30412cfbc6cf7a15145234ad1
limit: top 10 positive balances
status: syncing historical events; partial indexed snapshot
```
````

## Desired Ready Response

Once synced, the answer should be compact, confident, and clearly grounded in the event-backed holder view:

````text
Verdict: I found the top 10 ARB holders on Ethereum mainnet from the event-backed holder view.

Token:
- L1 bridged ARB: `0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1`
- Network: Ethereum mainnet (`mainnet-remote`)

Top holders:

| Rank | Holder | Raw ARB balance |
| ---: | --- | ---: |
| 1 | `<holder_1>` | `<raw_balance_1>` |
| 2 | `<holder_2>` | `<raw_balance_2>` |
| 3 | `<holder_3>` | `<raw_balance_3>` |
| 4 | `<holder_4>` | `<raw_balance_4>` |
| 5 | `<holder_5>` | `<raw_balance_5>` |
| 6 | `<holder_6>` | `<raw_balance_6>` |
| 7 | `<holder_7>` | `<raw_balance_7>` |
| 8 | `<holder_8>` | `<raw_balance_8>` |
| 9 | `<holder_9>` | `<raw_balance_9>` |
| 10 | `<holder_10>` | `<raw_balance_10>` |

Note: this is a holder reconstruction from indexed ERC-20 `Transfer` deltas. It should not infer total supply or concentration unless the agent also calls `get_holder_concentration`.

```event_query
query: multibaas.eventQuery
purpose: reconstruct current ERC-20 holders from Transfer deltas
stream: mainnet-remote (Ethereum mainnet) | L1 bridged ARB `0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1` / Transfer
fields: from + to + value + block number + tx hash + timestamp
aggregation: add value to `to`; subtract value from `from`; rank positive balances descending
source: contract:0xb50721bcf8d664c30412cfbc6cf7a15145234ad1
limit: top 10 positive balances
status: ready
```
````

The placeholder holder rows are intentional in this dry run. They should be replaced only by live tool output after the mainnet ARB holder view is ready.

## Implementation Notes

- The holder `event_query` block should be generated by runtime code, not written free-form by the model.
- The right home is near the holder capability surface, likely `src/holder-query-service.ts` or a small formatter beside `src/views.ts`.
- The formatter should derive the trace from the explicit contract target and analytical source, for example `contract:0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`.
- `get_top_holders` should return an evidence packet, not just the raw holder list. The agent can then synthesize the final answer while copying the fenced `event_query` block exactly.
- The packet should preserve the current guardrail: do not infer percentages, total supply, or concentration from a top-holder list alone.
