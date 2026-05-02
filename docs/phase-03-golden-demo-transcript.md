# Phase 03 Golden Demo Transcript

This is the target Discord flow if the phase-03 demo behaves as intended. Use it as a review artifact, not as a rigid word-for-word script.

## Beat 1: Incident Brief

**dblv**

```text
What's going on with Arbitrum governance lately? I heard the council froze some ETH. What's the brief?
```

**OpenAgent**

```text
Brief: Arbitrum's Security Council froze 30,765.667501709008927568 ETH connected to the KelpDAO / rsETH exploit. The frozen funds address is `0x0000000000000000000000000000000000000DA0`.

Releasing those funds requires Arbitrum governance action. A release would need to show up as a ProposalCreated event on the Core Governor; none has appeared yet in the checked stream, so that is the path to watch.

Contracts to inspect:
- Core Governor: `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9`
- L2 Core Timelock: where a successful proposal is queued and executed.
- L2 / L1 Upgrade Executors: relevant if the execution path touches protocol-control contracts.

What can happen next:
- A ProposalCreated event appears on the Core Governor with Kelp / rsETH / frozen ETH markers.
- Delegates vote through VoteCast / VoteCastWithParams.
- If successful, the proposal moves through queueing, timelock scheduling, and execution.

```event_query
query: multibaas.eventQuery
purpose: current onchain status preflight for the frozen ETH release proposal
stream: arbitrum-one-remote (Arbitrum One) | Core Governor `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9` / ProposalCreated
order: newest first
fields: proposal metadata + execution payload + description
match: Kelp | rsETH | frozen ETH | DeFi United | 30765 | 30,765 | `0x0000000000000000000000000000000000000DA0`
scanned: 28 ProposalCreated event(s)
window: blocks 72951811 -> 435258091; times 2023-03-23 21:05:12+00 -> 2026-02-23 21:36:25+00
matches: 0 incident marker match(es)
```
```

## Beat 2: Onchain Verification

**dblv**

```text
Does the event data show the transaction freezing the ETH?
```

**OpenAgent**

```text
Verdict: no. This event slice does not show the specific transaction freezing the ETH. It does show live Arbitrum governance control-plane activity around the contracts that would handle emergency actions or later release execution.

What I checked:
- L1 Upgrade Executor events on Ethereum mainnet.
- L1 Timelock scheduled / executed calls on Ethereum mainnet.
- L2 Core Timelock scheduled / executed calls on Arbitrum One.
- L2 Upgrade Executor activity on Arbitrum One.

What the event data shows:
- Recent L1 Upgrade Executor activity, including decoded UpgradeExecuted events.
- Recent L1 and L2 timelock activity, including CallScheduled and CallExecuted events.
- Recent L2 executor activity, showing that the governance control path is live and processing actions.

Evidence boundary:
This proves the Arbitrum DAO control plane is active through decoded emitted events. It does not, by itself, prove the exact freeze transaction unless a freeze-specific event or transaction is returned.

```event_query
query: multibaas.eventQuery
stream: mainnet-remote (Ethereum mainnet) | L1 Upgrade Executor `0x3ffFbAdAF827559da092217e474760E2b2c3CeDd` / UpgradeExecuted, TargetCallExecuted
stream: mainnet-remote (Ethereum mainnet) | L1 Timelock `0xE6841D92B0C345144506576eC13ECf5103aC7f49` / CallScheduled, CallExecuted, Cancelled
stream: arbitrum-one-remote (Arbitrum One) | L2 Core Timelock `0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0` / CallScheduled, CallExecuted, Cancelled
stream: arbitrum-one-remote (Arbitrum One) | L2 Upgrade Executor `0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827` / UpgradeExecuted, TargetCallExecuted
fields: target + value + calldata + operation id + delay + tx hash + timestamp
```
```

## Beat 3: Status + Monitor

**dblv**

```text
Has the proposal to release the frozen ETH already landed on chain? If not, let me know when it does.
```

**OpenAgent**

```text
Verdict: not onchain yet. I scanned the Core Governor ProposalCreated stream for the frozen ETH release markers and found no matching proposal.

Searched:
- 28 decoded ProposalCreated events on the Arbitrum One Core Governor.
- Window: blocks 72951811 -> 435258091; times 2023-03-23 21:05:12+00 -> 2026-02-23 21:36:25+00.
- Markers: Kelp, rsETH, frozen ETH, DeFi United, 30765, 30,765, and `0x0000000000000000000000000000000000000DA0`.

Watching:
The webhook-backed monitor is now active. It will wake the runtime when MultiBaas delivers a Core Governor ProposalCreated event, then the agent-side filter will check the decoded proposal fields for those incident markers.

After a match, I will inspect the proposal ID, proposer, targets, values, calldata, description, known Arbitrum DAO control contracts, the frozen ETH address, and later queue / execute events.

```event_query
query: multibaas.eventQuery
purpose: current onchain status preflight before webhook monitor registration
stream: arbitrum-one-remote (Arbitrum One) | Core Governor `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9` / ProposalCreated
order: newest first
fields: proposal metadata + execution payload + description
match: Kelp | rsETH | frozen ETH | DeFi United | 30765 | 30,765 | `0x0000000000000000000000000000000000000DA0`
scanned: 28 ProposalCreated event(s)
window: blocks 72951811 -> 435258091; times 2023-03-23 21:05:12+00 -> 2026-02-23 21:36:25+00
matches: 0 incident marker match(es)
```

```monitor_activation
status: active
webhook_status: registered
webhook_id: `123`
webhook_label: runtime-events
webhook_url: https://example.ngrok-free.app/webhooks/multibaas
webhook_path: MultiBaas event.emitted -> local event monitor filter -> NanoClaw notification
watching: arbitrum-one-remote (Arbitrum One) Core Governor `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9` / ProposalCreated
matching: Kelp, rsETH, frozen ETH, DeFi United, 30765, 30,765, `0x0000000000000000000000000000000000000DA0`
current_verdict: no matching release ProposalCreated event in 28 scanned Core Governor event(s)
follow_up_after_trigger: inspect proposal ID, proposer, targets, values, calldata, and description; label known Arbitrum DAO control contracts and the frozen ETH address; watch for later ProposalQueued, ProposalExecuted, CallScheduled, and CallExecuted events; check whether L2 or L1 timelock / upgrade executor activity appears
```
```

## Pass Notes

- The first two beats should not claim a matching release proposal exists.
- The second beat should say control-plane activity is verified, not exploit reconstruction.
- The third beat should include both blocks: `event_query` for current status and `monitor_activation` for monitor proof.
- The third beat should never mention recurring polling or NanoClaw scheduling.
