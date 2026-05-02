# Phase 03 Demo Script

Goal: pass a live NanoClaw demo where the agent uses the prescriptive Arbitrum governance incident tool, returns live event evidence, and presents a crisp incident brief.

## What Needs To Happen

1. The agent must use the Arbitrum governance incident MCP surface for the KelpDAO / rsETH frozen-ETH story: either `analyze_arbitrum_governance_incident` or a dedicated alias backed by the same service.
2. Each demo prompt must map to the correct `focus` value:
   - incident brief -> `brief`
   - emergency response verification -> `verify-freeze`
   - release proposal status -> `proposal-status`
   - persistent monitor request -> `monitor`
3. The answer must separate public context from MultiBaas-returned event evidence.
4. The answer must lead with the current verdict, then show decoded events and the next onchain signal.
5. The monitor answer must describe the exact event stream, agent-side filters, and follow-up analysis.

## Host-Side Verification

Run these before the NanoClaw recording pass:

```bash
cd ~/git/dbxe/amanita
npm test
npm run dev -- backend list
npm run dev -- query arbitrum-governance-incident --focus brief --limit 3
npm run dev -- query arbitrum-governance-incident --focus verify-freeze --limit 2
npm run dev -- query arbitrum-governance-incident --focus proposal-status --limit 3
npm run dev -- query arbitrum-governance-incident --focus monitor --limit 3
```

Expected host-side state:

- `arbitrum-one-remote` and `mainnet-remote` are configured.
- `proposal-status` checks Core Governor `ProposalCreated` events on Arbitrum One.
- If no Kelp / rsETH / frozen-ETH match exists, the answer says the next binding signal is `ProposalCreated`.
- `verify-freeze` shows decoded L1 Upgrade Executor evidence and timelock/executor context without claiming exploit reconstruction.

## NanoClaw Setup

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
npm run dev -- nanoclaw reset-group \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name>
npm run dev -- nanoclaw preflight \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name>
```

Run prompts sequentially. Do not overlap turns.

## Live Demo Prompts

### Beat 1: Incident Brief

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Arbitrum froze funds from the KelpDAO exploit. Give me the onchain governance brief: what happened, what contracts should I inspect, and what can happen next?"
```

Expected behavior:

- calls `analyze_arbitrum_governance_incident` with `focus=brief`, or `get_arbitrum_frozen_eth_governance_brief`
- gives public context, control path, and next binding signal
- avoids backend-health framing unless something blocks the answer

### Beat 2: Onchain Verification

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Can you verify the emergency governance response from live event data?"
```

Expected behavior:

- calls `analyze_arbitrum_governance_incident` with `focus=verify-freeze`
- surfaces decoded `UpgradeExecuted(address,uint256,bytes)` evidence from `mainnet-remote`
- states that this verifies control-plane activity, not the full exploit

### Beat 3: Next Onchain Transition

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Has the frozen-ETH release proposal reached onchain governance yet?"
```

Expected behavior:

- calls `analyze_arbitrum_governance_incident` with `focus=proposal-status`
- checks Arbitrum One Core Governor `ProposalCreated`
- distinguishes public/forum proposal context from onchain `ProposalCreated`
- names `ProposalCreated` as the next binding signal if no match exists

### Beat 4: Persistent Monitor Payoff

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Let me know when this release proposal actually reaches onchain governance."
```

Expected behavior:

- calls `analyze_arbitrum_governance_incident` with `focus=monitor` or `get_arbitrum_frozen_eth_monitor_plan`
- describes the `ProposalCreated` monitor target on the Core Governor
- uses agent-side filters for Kelp / rsETH / frozen ETH / `30,765` / `0x0000000000000000000000000000000000000DA0`
- lists the follow-up analysis to run after trigger

## Pass Criteria

A live pass means:

- the agent calls the intended MCP tool for all four beats
- the output is event-backed and concise
- public incident context and live event evidence stay separate
- the current onchain status is stated as a verdict, not buried
- the monitor beat clearly describes what is watched and what the agent will inspect next

Fail the run if the agent:

- invents a matching onchain release proposal
- cites external sources instead of using the MCP tool
- treats a public proposal as binding onchain evidence
- claims exploit reconstruction from executor or timelock events
- gives a generic DAO-readiness answer instead of the incident brief
