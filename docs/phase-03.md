# Phase 03

## Status note

Phase 03 is the demo-sharpening phase for the hackathon submission.

Phase 02 established the correct runtime direction: typed, composable MultiBaas-backed capabilities with explicit readiness and bounded event views. Phase 03 narrows that substrate into one focused video story:

> ChatGPT Deep Research for blockchain governance incidents.

The demo is not about backend readiness. Backend health is an operator concern. The user-facing story is that an agent can turn live blockchain events into an incident investigation, identify the next onchain transition that matters, and keep watching for it.

## Demo thesis

Blockchains expose public data, but incident response still requires stitching together proposals, votes, timelocks, upgrade executors, treasury movement, and cross-chain control surfaces.

For this demo, Arbitrum DAO is the focal system and the KelpDAO / rsETH frozen ETH response is the incident frame.

The agent should answer:

> As an Arbitrum delegate or protocol risk analyst, what can I verify onchain before the frozen ETH release proposal reaches execution?

## Incident frame

Public context:

- Arbitrum's Security Council froze `30,765.667501709008927568 ETH` connected to the KelpDAO / rsETH exploit.
- The frozen funds were moved to `0x0000000000000000000000000000000000000DA0`.
- A later Arbitrum Governance action is required to release the funds.
- A Constitutional AIP asks governance to approve releasing the frozen ETH for the rsETH recovery effort.

Evidence boundary:

- The demo investigates the governance response and next onchain transition.
- It must not claim to reconstruct the full exploit.
- It must not claim to trace all stolen funds.
- It must distinguish public incident context from live onchain evidence returned by MultiBaas.

## Product framing

Suggested opening:

> I wanted to build ChatGPT Deep Research for blockchain systems: an agent that can inspect live contracts, reconstruct state from emitted events, and turn scattered onchain activity into an intelligence brief.

Suggested infrastructure line:

> This demo uses NanoClaw as the agent harness and MultiBaas as the live EVM indexing and event-query layer exposed through MCP.

Suggested MultiBaas line:

> MultiBaas indexes EVM contracts, decodes their events, and lets us query those events like analytical views over live blockchain history.

## User-facing demo arc

Keep the recorded chat to four beats: three governance-incident beats, then one holder-analysis follow-up that shows the same event-query substrate outside the incident wrapper.

### Beat 1: Incident brief

Prompt:

```text
What's going on with Arbitrum governance lately? I heard the council froze some ETH. What's the brief?
```

The agent should:

- summarize the public incident context briefly
- identify the relevant Arbitrum DAO control surface
- explain that the next binding state transition is governance moving from public proposal to onchain proposal and then timelock execution
- keep backend/readiness language out unless something blocks the answer

Expected structure:

```text
Public context:
- frozen ETH amount and frozen address
- release requires governance

Onchain control path:
- Core Governor
- L2 Core Timelock
- L2 Upgrade Executor
- possible Ethereum-side L1 Timelock / Upgrade Executor if L1 execution is involved

What can happen next:
- ProposalCreated
- VoteCast / voting period
- ProposalQueued
- CallScheduled
- CallExecuted
```

### Beat 2: Onchain verification

Prompt:

```text
Does the event data show the transaction freezing the ETH?
```

The agent should:

- query Ethereum mainnet L1 Upgrade Executor events
- surface the recent `UpgradeExecuted` event tied to the public emergency-action transaction where available
- explain that this verifies protocol-control activity through a decoded event, not a block explorer scrape
- avoid claiming full exploit reconstruction

High-value evidence:

- `mainnet-remote`
- `arbitrumdaol1upgradeexecutor`
- `UpgradeExecuted(address,uint256,bytes)`
- transaction hash matching the public emergency action where present

### Beat 3: Next onchain transition + monitor

Prompt:

```text
Has the proposal to release the frozen ETH already landed on chain? If not, let me know when it does.
```

The agent should:

- query Arbitrum One Core Governor `ProposalCreated` events
- search proposal descriptions and metadata for Kelp / rsETH / frozen ETH / `30,765` / `0x0000000000000000000000000000000000000DA0`
- distinguish forum/public proposal existence from onchain governance existence
- if no match is found, say the next binding signal is Core Governor `ProposalCreated`
- create the MultiBaas webhook-backed monitor only after reporting the current status
- include the `monitor_activation` proof block with webhook status/id/path before claiming the monitor is active
- state the exact follow-up analysis it will run when triggered

This can be a strong answer even when the proposal is not yet onchain:

```text
The public proposal exists, but I do not see a matching onchain Core Governor ProposalCreated event yet. I scanned the recent ProposalCreated stream for Kelp, rsETH, frozen ETH markers, and the frozen address. The next binding signal is ProposalCreated on the Core Governor, and the webhook monitor is now watching that stream.
```

The monitor should:

- watch Arbitrum One Core Governor `ProposalCreated`
- use agent-side filtering over decoded webhook events for description, calldata, targets, and incident markers
- use the active MultiBaas `event.emitted` webhook path, not recurring NanoClaw scheduling

Monitor target:

```text
Network: arbitrum-one-remote
Contract: arbitrumdaocoregovernor
Address: `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9`
Event: ProposalCreated
Agent-side filters: Kelp, rsETH, frozen ETH, DeFi United, 30765, 30,765, `0x0000000000000000000000000000000000000DA0`
```

When triggered, inspect:

- proposal ID
- proposer
- targets
- values
- calldata / selectors
- description
- whether known high-risk contracts are touched
- whether the proposal later enters `CallScheduled`
- whether the proposal later reaches `CallExecuted`
- whether L1 timelock or L1 upgrade executor activity appears

### Beat 4: Holder reconstruction follow-up

Prompt:

```text
By the way, who are the top ARB token holders on Ethereum?
```

The agent should:

- call `get_top_holders` for `ARB` on `mainnet-remote`
- identify the L1 bridged ARB token on Ethereum mainnet
- show balances scaled by token decimals, not raw uint256 values
- preserve any sync status returned by the tool
- include the holder `event_query` block
- avoid inferring total supply, percentages, or concentration unless it separately calls the relevant concentration or metadata tool

This beat demonstrates that the event-query substrate is not only a scripted governance incident surface. It can reconstruct ERC-20 holder state from historical `Transfer` deltas, which contract storage cannot enumerate directly.

## Required implementation

Build a small prescriptive demo surface over reusable services:

```text
summarize_governance_incident
verify_governance_control_activity
check_governance_proposal_status
monitor_governance_proposal
```

Keep `analyze_arbitrum_governance_incident` as the general compatibility surface, but prefer the narrower capability-shaped tools in NanoClaw instructions and the recorded path.

The governance tools can be specific to this demo, but their internals should use reusable event-view builders and typed runtime services. Do not ask the model to author raw event-query payloads during the recorded path.

Inputs:

- optional `focus`: `brief | verify-freeze | proposal-status | monitor`
- optional `limit`

Outputs:

- concise incident brief
- live onchain evidence
- evidence boundaries
- next event to watch
- monitor setup result or monitor plan

The fourth beat should use the generic holder capability:

```text
get_top_holders
```

That answer should be generated from the holder view formatter, including token symbol, decimals, scaled balances, sync status when relevant, and the holder `event_query` block.

## Required event views

### Governor proposal lifecycle

Contract families:

- `L2ArbitrumGovernor`

Events:

- `ProposalCreated(uint256,address,address[],uint256[],string[],bytes[],uint256,uint256,string)`
- `ProposalQueued(uint256,uint256)`
- `ProposalExecuted(uint256)`
- `ProposalCanceled(uint256)`
- `VoteCast(address,uint256,uint8,uint256,string)`
- `VoteCastWithParams(address,uint256,uint8,uint256,string,bytes)`

Derived outputs:

- recent proposals
- proposal descriptions
- proposal lifecycle state from events
- proposal IDs matching incident keywords
- recent vote activity by proposal

### Timelock operation lifecycle

Contract families:

- `ArbitrumTimelock`
- `L1ArbitrumTimelock`

Events:

- `CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)`
- `CallExecuted(bytes32,uint256,address,uint256,bytes)`
- `Cancelled(bytes32)`

Derived outputs:

- operation ID
- scheduled target
- executed target
- delay
- schedule-to-execute examples
- known vs unknown targets

### Upgrade executor activity

Contract families:

- `UpgradeExecutor`

Events:

- `UpgradeExecuted(address,uint256,bytes)`
- `TargetCallExecuted(address,uint256,bytes)`

Derived outputs:

- recent protocol-control executions
- target addresses
- value
- calldata selector where possible
- transaction hashes

### Treasury/control surface

Contract families:

- `FixedDelegateErc20Wallet`
- treasury governor / timelock path

Events:

- `OwnershipTransferred(address,address)`
- governor and timelock events when available

Derived outputs:

- whether treasury control is structurally in scope
- whether the incident proposal appears to touch treasury contracts

## Type conversion requirements

Use MultiBaas type conversion where available. Inspect `~/git/curvegrid/multibaas` before locking query payloads if SDK behavior is ambiguous.

Priority conversions:

- `bytes32` operation IDs and roles -> hex strings
- `bytes` calldata -> compact hex and function selector
- `uint256` ETH values -> human-readable ETH
- `address` -> known label where in the Arbitrum DAO target map
- ERC-20 balances -> decimals-adjusted token units only if token-flow analysis enters the demo

## Known address map

Use this map for readable output:

```text
0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9 -> Core Governor
0x789fC99093B09aD01C34DC7251D0C89ce743e5a4 -> Treasury Governor
0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0 -> L2 Core Timelock
0xbFc1FECa8B09A5c5D3EFfE7429eBE24b9c09EF58 -> L2 Treasury Timelock
0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827 -> L2 Upgrade Executor
0xF3FC178157fb3c87548bAA86F9d24BA38E649B58 -> DAO Treasury
0xE6841D92B0C345144506576eC13ECf5103aC7f49 -> L1 Timelock
0x3ffFbAdAF827559da092217e474760E2b2c3CeDd -> L1 Upgrade Executor
0x0000000000000000000000000000000000000DA0 -> Frozen ETH address
```

## Optional historical precedent beat

Use only if the output is already polished and the video has time.

Prompt:

```text
Have these governance contracts handled high-risk actions before?
```

Expected answer:

- recent L2 timelock schedule/execute pairs
- observed 8-day delay examples where present
- recent L1 upgrade executor events
- no claim that these are causally related to Kelp unless event data proves it

This beat is optional because it can become a data dump. The stronger recorded governance flow is incident brief -> verification -> next onchain signal plus webhook monitor.

## Webhook posture

The demo should show the transition from one-shot research to persistent monitoring.

The webhook path is active for the recording. MultiBaas delivers `event.emitted` callbacks to the runtime; the runtime keeps a Core Governor `ProposalCreated` monitor and applies agent-side filtering to description, targets, calldata, and known incident markers before notifying the agent.

Do not claim the webhook itself is directly filtered by description unless that is actually implemented.

## Acceptance checks

Before recording:

- `npm test` passes
- run the concrete script in [`docs/phase-03-demo-script.md`](phase-03-demo-script.md)
- `nanoclaw configure` has been rerun for the recording group
- `nanoclaw reset-group` has been run for the recording group
- `nanoclaw preflight` shows only remote profiles
- live prompt 1 returns incident brief without backend-health framing
- live prompt 2 surfaces live `UpgradeExecuted` evidence or a clear onchain evidence boundary
- live prompt 3 distinguishes public proposal from onchain `ProposalCreated`, then creates the MultiBaas webhook-backed monitor, includes the `monitor_activation` proof block, and describes the follow-up analysis
- live prompt 4 returns the ARB holder table with decimals-scaled balances and the holder `event_query` block

## Video close

Suggested close:

> This is the product direction: a persistent blockchain research agent. It investigates what is true now, identifies the next onchain event that matters, and subscribes itself to wake up when that event happens.

Core product pattern:

```text
raw logs
-> decoded events
-> event-sourced views
-> agent reasoning
-> actionable insight
-> webhook-driven follow-up
```
