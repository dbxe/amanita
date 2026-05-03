# Supplementary demo examples

These are optional prompts that passed live NanoClaw or direct CLI checks during the final audit. They are not meant to replace the four-beat golden path in [`phase-03-demo-script.md`](phase-03-demo-script.md). Use them as judge-facing follow-ups if there is extra time or if someone asks what else the runtime can do.

Tested on May 3, 2026 with the `cli-with-dan` NanoClaw group unless noted.

## Good Follow-Ups

### Event Capability Discovery

Prompt:

```text
What event-backed investigations are available for the ARB token on Ethereum?
```

Expected shape:

```text
The available event-backed investigation for the ARB token on Ethereum is:

- `holder_distribution`: Reconstruct top holders from `Transfer` event deltas.
```

Why it is useful:

- Shows that Logrunner can inspect a contract surface before choosing an analysis.
- Reinforces that holder reconstruction comes from event logs, not a hardcoded token demo.
- Low risk: read-only capability inspection.

### Multichain Readiness Check

Prompt:

```text
Compare the Arbitrum DAO timelocks on Ethereum and Arbitrum. Are both linked and ready?
```

Expected shape:

```text
Both Arbitrum DAO timelocks are linked and ready:

Ethereum mainnet (L1 Timelock):
- Address: `0xe6841d92b0c345144506576ec13ecf5103ac7f49`
- Contract: `L1ArbitrumTimelock` via `arbitrumdaol1timelock`

Arbitrum One (L2 Core Timelock):
- Address: `0x34d45e99f7d8c45ed05b5ca72d54bbd1fb3f98f0`
- Contract: `ArbitrumTimelock` via `arbitrumdaol2coretimelock`
```

Why it is useful:

- Shows the backend registry and multichain target fan-out.
- Stays close to the Arbitrum governance story without repeating the frozen ETH script.
- Low risk: read-only readiness/metadata check.

### Negative Control-Surface Answer

Prompt:

```text
Does the Ethereum ARB token show pause, blacklist, ownership, or role-control events?
```

Expected shape:

```text
No, the Ethereum ARB token does not show pause, blacklist, ownership, or role-control events. The only detected events are `Approval`, `Initialized`, and `Transfer`.
```

Why it is useful:

- Shows the agent can give a bounded negative answer instead of inventing admin activity.
- Demonstrates event-surface inspection and control-event routing.
- Low risk: read-only.

### Verified Contract Lookup

Prompt:

```text
Look up verified contract candidates for the Ethereum ARB token address `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`. Don't import anything.
```

Expected shape:

```text
The verified contract candidates for the Ethereum ARB token address `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1` are:

- `TransparentUpgradeableProxy` at `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`
- `L1ArbitrumToken` at `0xad0c361ef902a7d9851ca7dcc85535da2d3c6fc7` (preferred)
```

Why it is useful:

- Shows lookup can distinguish proxy shell from implementation candidate.
- Read-only as phrased.
- A good bridge into explaining the confirmation gate before any linking/indexing mutation.

### Mutation Confirmation Guard

Prompt:

```text
Please import and link the preferred verified ABI candidate for `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`.
```

Expected shape:

```text
I've found a preferred verified ABI candidate for `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`: `L1ArbitrumToken` at `0xad0c361ef902a7d9851ca7dcc85535da2d3c6fc7`.

Importing this will link the ABI and may start historical indexing. Do you want me to proceed?
```

Why it is useful:

- Shows the judge-facing safety posture: exploration is allowed, but setup mutation needs confirmation.
- Do not follow through during the recorded demo unless there is a deliberate reason.

## Do Not Promote Yet

These paths exist, but did not clear the low-risk polish bar in the final pass:

- `query concentration` and one-address `query balance` direct CLI paths returned a MultiBaas `400 invalid request` for the ARB contract during this pass.
- The raw `holder_distribution` event-investigation path returned correct holders but raw uint256 balances. Use the polished `get_top_holders` path instead.
- One NanoClaw interface-inspection answer for the ARB token had formatting corruption. The direct CLI output was clean, but the chat answer was not reliable enough to promote.
