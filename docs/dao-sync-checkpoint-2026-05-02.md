# DAO Sync Checkpoint — 2026-05-02

Snapshot captured:

- UTC: `2026-05-01T16:03:56Z`
- JST: `2026-05-02T01:03:56+0900`

Purpose:

- track the overnight sync progress of the DAO-focused contract set
- compare current `latestBlockNumber` values against tomorrow's snapshot
- keep the story focused on Arbitrum DAO governance, treasury, timelocks, and upgrade control

Important scope note:

- The L2 ARB token was intentionally removed to avoid throttling the rest of the DAO sync set.
- The L1 bridged ARB token on Ethereum mainnet was linked from block `0`.
- Old JPYC / Uniswap / bridge-router demo contracts were removed from both deployments.

## Current linked set

### `mainnet-remote`

- `arbitrumdaol1timelock` — `0xE6841D92B0C345144506576eC13ECf5103aC7f49`
- `arbitrumdaol1upgradeexecutor` — `0x3ffFbAdAF827559da092217e474760E2b2c3CeDd`
- `arbtokenethereum` — `0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1`

Backend head block:

- `25,001,166`

### `arbitrum-one-remote`

- `arbitrumdaocoregovernor` — `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9`
- `arbitrumdaotreasurygovernor` — `0x789fC99093B09aD01C34DC7251D0C89ce743e5a4`
- `arbitrumdaol2coretimelock` — `0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0`
- `arbitrumdaol2treasurytimelock` — `0xbFc1FECa8B09A5c5D3EFfE7429eBE24b9c09EF58`
- `arbitrumdaol2upgradeexecutor` — `0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827`
- `arbitrumdaotreasury` — `0xF3FC178157fb3c87548bAA86F9d24BA38E649B58`

Backend head block:

- `458,316,330`

## Status snapshot

### Ethereum mainnet

| Label | Contract | Address | State | Latest block | Start block | Approx progress | Updated at |
|---|---|---|---|---:|---:|---:|---|
| `arbitrumdaol1timelock` | `L1ArbitrumTimelock` | `0xE6841D92B0C345144506576eC13ECf5103aC7f49` | `ready` | `25,001,110` | `0` | `100.0%` | `2026-05-01T15:53:02.657851Z` |
| `arbitrumdaol1upgradeexecutor` | `UpgradeExecutor` | `0x3ffFbAdAF827559da092217e474760E2b2c3CeDd` | `ready` | `25,001,143` | `0` | `100.0%` | `2026-05-01T15:59:23.074731Z` |
| `arbtokenethereum` | `L1ArbitrumToken` | `0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1` | `syncing` | `15,535,452` | `0` | `62.1%` | `2026-05-01T16:02:59.494923Z` |

### Arbitrum One

| Label | Contract | Address | State | Latest block | Start block | Approx progress | Updated at |
|---|---|---|---|---:|---:|---:|---|
| `arbitrumdaocoregovernor` | `L2ArbitrumGovernor` | `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9` | `syncing` | `22,862,285` | `0` | `5.0%` | `2026-05-01T16:01:40.91043Z` |
| `arbitrumdaotreasurygovernor` | `L2ArbitrumGovernor` | `0x789fC99093B09aD01C34DC7251D0C89ce743e5a4` | `syncing` | `0` | `0` | `0.0%` | `2026-05-01T15:58:41.404913Z` |
| `arbitrumdaol2coretimelock` | `ArbitrumTimelock` | `0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0` | `syncing` | `0` | `0` | `0.0%` | `2026-05-01T15:56:57.855484Z` |
| `arbitrumdaol2treasurytimelock` | `ArbitrumTimelock` | `0xbFc1FECa8B09A5c5D3EFfE7429eBE24b9c09EF58` | `syncing` | `17,031,702` | `0` | `3.7%` | `2026-05-01T16:03:40.186864Z` |
| `arbitrumdaol2upgradeexecutor` | `UpgradeExecutor` | `0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827` | `syncing` | `6,780,677` | `0` | `1.5%` | `2026-05-01T16:03:40.348855Z` |
| `arbitrumdaotreasury` | `FixedDelegateErc20Wallet` | `0xF3FC178157fb3c87548bAA86F9d24BA38E649B58` | `syncing` | `23,402,339` | `0` | `5.1%` | `2026-05-01T15:58:41.411472Z` |

## What to compare in the morning

Check these first:

1. Did the zero-progress Arbitrum contracts start moving?
   - `arbitrumdaotreasurygovernor`
   - `arbitrumdaol2coretimelock`

2. Did the partially-progressing Arbitrum contracts make meaningful gains?
   - `arbitrumdaocoregovernor`
   - `arbitrumdaol2treasurytimelock`
   - `arbitrumdaol2upgradeexecutor`
   - `arbitrumdaotreasury`

3. Did `arbtokenethereum` move far enough to be worth keeping in the demo story?

4. Did any contract remain stuck with both:
   - `latestBlockNumber = 0`
   - unchanged `updatedAt`

## Morning story threshold

The fallback demo story is already viable if these remain healthy:

- `arbitrumdaol1timelock`
- `arbitrumdaol1upgradeexecutor`
- at least one governor
- at least one timelock
- treasury or treasury timelock

That is enough to tell:

- how Arbitrum DAO governance is structured
- what governs proposal execution
- where treasury-impacting actions flow
- where L1/L2 governance authority lives

## Morning snapshot

Snapshot captured:

- compared on `2026-05-02` morning JST
- current mainnet head: `25,003,524`
- current Arbitrum head: `458,428,655`

### Mainnet delta

| Label | Previous latest block | Current latest block | Delta | Current state | Current approx progress |
|---|---:|---:|---:|---|---:|
| `arbitrumdaol1timelock` | `25,001,110` | `25,001,110` | `0` | `ready` | `100.0%` |
| `arbitrumdaol1upgradeexecutor` | `25,001,143` | `25,001,143` | `0` | `ready` | `100.0%` |
| `arbtokenethereum` | `15,535,452` | `19,162,039` | `+3,626,587` | `syncing` | `76.6%` |

### Arbitrum delta

| Label | Previous latest block | Current latest block | Delta | Current state | Current approx progress |
|---|---:|---:|---:|---|---:|
| `arbitrumdaocoregovernor` | `22,862,285` | `293,809,109` | `+270,946,824` | `syncing` | `64.1%` |
| `arbitrumdaotreasurygovernor` | `0` | `169,056,737` | `+169,056,737` | `syncing` | `36.9%` |
| `arbitrumdaol2coretimelock` | `0` | `264,346,219` | `+264,346,219` | `syncing` | `57.7%` |
| `arbitrumdaol2treasurytimelock` | `17,031,702` | `141,373,913` | `+124,342,211` | `syncing` | `30.8%` |
| `arbitrumdaol2upgradeexecutor` | `6,780,677` | `174,697,247` | `+167,916,570` | `syncing` | `38.1%` |
| `arbitrumdaotreasury` | `23,402,339` | `109,450,644` | `+86,048,305` | `syncing` | `23.9%` |

### Morning assessment

- The overnight pivot worked.
- Nothing in the DAO set looks stalled now.
- The two mainnet governance-control contracts remain ready.
- The mainnet bridged ARB token made meaningful progress and is worth keeping.
- Every Arbitrum DAO contract is now moving, including the two that were at `0` last night:
  - `arbitrumdaotreasurygovernor`
  - `arbitrumdaol2coretimelock`

### Operational conclusion

This is good enough to proceed with a limited live agent probe focused on:

- governance structure
- L1/L2 control topology
- which contracts are already ready vs still syncing
- what analyses will unlock as the remaining Arbitrum history completes

It is still too early to present full-history claims from the Arbitrum-side contracts as final.

## Afternoon check-in

Snapshot captured:

- UTC: `2026-05-02T06:06:28Z`
- JST: `2026-05-02T15:06:28+0900`
- current mainnet head: `25,005,369`
- current Arbitrum head: `458,516,316`

### Fresh direct checks

Confirmed by direct `contract inspect`:

- `mainnet-remote` `0xE6841D92B0C345144506576eC13ECf5103aC7f49`
  - linked as `arbitrumdaol1timelock`
  - `ready`
- `mainnet-remote` `0x3ffFbAdAF827559da092217e474760E2b2c3CeDd`
  - linked as `arbitrumdaol1upgradeexecutor`
  - `ready`
- `arbitrum-one-remote` `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9`
  - linked as `arbitrumdaocoregovernor`
  - `ready`
- `mainnet-remote` `0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1`
  - linked as `arbtokenethereum`
  - `syncing`
- `arbitrum-one-remote` `0x789fC99093B09aD01C34DC7251D0C89ce743e5a4`
  - linked as `arbitrumdaotreasurygovernor`
  - `syncing`
- `arbitrum-one-remote` `0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0`
  - linked as `arbitrumdaol2coretimelock`
  - `ready`
- `arbitrum-one-remote` `0xbFc1FECa8B09A5c5D3EFfE7429eBE24b9c09EF58`
  - linked as `arbitrumdaol2treasurytimelock`
  - `ready`
- `arbitrum-one-remote` `0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827`
  - linked as `arbitrumdaol2upgradeexecutor`
  - `ready`
- `arbitrum-one-remote` `0xF3FC178157fb3c87548bAA86F9d24BA38E649B58`
  - linked as `arbitrumdaotreasury`
  - `ready`

### What changed since the morning check

- The backend heads continued advancing on both chains.
- `arbitrumdaocoregovernor` is now directly inspectable as `ready`, which is stronger than the earlier morning snapshot where it was still reported as `syncing`.
- The two Ethereum mainnet governance-control contracts remain stable and `ready`.
- The Arbitrum-side timelocks, upgrade executor, and treasury wallet are now directly inspectable as `ready`.
- The remaining contracts still reporting `syncing` in this check-in are:
  - `arbtokenethereum`
  - `arbitrumdaotreasurygovernor`

### Current probe note

During the first version of this afternoon check-in, the common inspection path briefly returned backend `500`s while requesting `include=contractLookup` on routine address reads. That client path has now been corrected so routine inspection only asks MultiBaas for the linked address record. The common inspect path is healthy again.

For the live demo story right now, the reliable floor is:

- L1 timelock
- L1 upgrade executor
- L2 core governor
- L2 core timelock
- L2 treasury timelock
- L2 upgrade executor
- treasury wallet

Treasury-governor and bridged-token questions should still preserve syncing uncertainty until those two targets finish historical indexing.

### ETA check

Based on the raw MultiBaas status payloads sampled around `2026-05-02T06:14Z`:

- `arbitrumdaotreasurygovernor`
  - `latestBlockNumber = 281,912,360`
  - Arbitrum head at check time: `458,518,177`
  - working estimate: should finish later on `2026-05-02` if the current catch-up rate holds
- `arbtokenethereum`
  - `latestBlockNumber = 21,205,667`
  - mainnet head at check time: `25,005,408`
  - working estimate: could still finish on `2026-05-02`, but this is less reliable because repeated spot checks showed no movement and the same `updatedAt` during this sample window

This estimate is intentionally provisional. Recheck the raw `/status` payloads before treating either target as done.
