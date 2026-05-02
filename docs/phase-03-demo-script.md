# Phase 03 Demo Script

Goal: pass a live NanoClaw demo where the agent uses the prescriptive Arbitrum governance incident tool, returns live event evidence, and presents a crisp incident brief.

## What Needs To Happen

1. The agent must use the Arbitrum governance incident MCP surface for the KelpDAO / rsETH frozen ETH story.
2. Each demo prompt must map to the correct typed tool path:
   - incident brief -> `summarize_governance_incident`
   - emergency response verification -> `verify_governance_control_activity`
   - release proposal status only -> `check_governance_proposal_status`
   - release proposal status plus notify/watch request -> `monitor_governance_proposal`
3. The agent must call the mapped incident tool on every matching turn, even if a previous turn checked related event data.
4. The answer must make the tool-backed query visible as a compact fenced `event_query` block: what event stream was checked, which decoded fields matter, and what filter or marker set was applied.
5. The answer must separate public context from MultiBaas-returned event evidence.
6. The answer must lead with the current verdict, then show decoded events and the next onchain signal.
7. A status-only proposal question must not set up or promise a monitor.
8. The merged status-plus-monitor beat must first report the current onchain status, then create the webhook-backed monitor.
9. The monitor answer must include the `monitor_activation` proof block with webhook status/id/path before saying the monitor is active.
10. For live event-query turns, the agent should synthesize a final answer from the evidence packet rather than copying it wholesale. Do not use model-authored standalone progress acknowledgements in this demo path; visible progress should come from NanoClaw runtime behavior, not from a progress-only assistant reply.

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
- If no Kelp / rsETH / frozen ETH match exists, the answer says the next binding signal is `ProposalCreated`.
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
pnpm run chat -- "What's going on with Arbitrum governance lately? I heard the council froze some ETH. What's the brief?"
```

Expected behavior:

- calls `summarize_governance_incident`
- includes an `event_query` block showing the Core Governor `ProposalCreated` stream and decoded marker fields
- synthesizes public context, control path, and next binding signal from the evidence packet
- avoids backend-health framing unless something blocks the answer

### Beat 2: Onchain Verification

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Does the event data show the transaction freezing the ETH?"
```

Expected behavior:

- calls `verify_governance_control_activity`
- includes an `event_query` block showing the L1/L2 timelock and upgrade-executor event streams
- surfaces decoded `UpgradeExecuted(address,uint256,bytes)` evidence from `mainnet-remote`
- states that this verifies control-plane activity, not the full exploit

### Beat 3: Next Onchain Transition + Monitor

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Has the proposal to release the frozen ETH already landed on chain? If not, let me know when it does."
```

Expected behavior:

- calls `monitor_governance_proposal` before claiming the monitor is active
- uses the tool's built-in `ProposalCreated` status preflight before registering the monitor
- checks Arbitrum One Core Governor `ProposalCreated`
- distinguishes public/forum proposal context from onchain `ProposalCreated`
- names `ProposalCreated` as the next binding signal if no match exists
- describes the `ProposalCreated` monitor target on the Core Governor
- uses agent-side filters for Kelp / rsETH / frozen ETH / `30,765` / `0x0000000000000000000000000000000000000DA0`
- includes the `monitor_activation` block with MultiBaas webhook id/status/path and avoids any NanoClaw recurrence language
- lists the follow-up analysis to run after trigger

## Pass Criteria

A live pass means:

- the agent calls the intended MCP tool for all three beats
- the agent includes a compact fenced `event_query` block for the live query it ran instead of making the answer feel like an ungrounded script
- the output is event-backed and concise
- the final answer is synthesized from the evidence packet, not a wholesale copy of the tool output
- public incident context and live event evidence stay separate
- the current onchain status is stated as a verdict, not buried
- the merged status-plus-monitor beat clearly separates "not onchain yet" from "webhook monitor is now active"
- the merged status-plus-monitor beat includes both the `event_query` status preflight and the `monitor_activation` proof block
- the monitor setup uses the MultiBaas webhook path, then clearly describes what is watched and what the agent will inspect next

Fail the run if the agent:

- invents a matching onchain release proposal
- cites external sources instead of using the MCP tool
- treats a public proposal as binding onchain evidence
- claims exploit reconstruction from executor or timelock events
- gives a generic DAO-readiness answer instead of the incident brief
- says it has set up a monitor before the user asks to be notified or watched
- uses recurring NanoClaw scheduling instead of the MultiBaas webhook-backed monitor path
