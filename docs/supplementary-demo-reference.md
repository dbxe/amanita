# Supplementary demo reference

These are optional follow-up prompts and sample answer shapes for showing breadth beyond the main Arbitrum frozen ETH demo.

## 1. Event-Backed Investigation Discovery

**User**

```text
What event-backed investigations are available for the ARB token on Ethereum?
```

**Agent**

```text
The available event-backed investigation for the ARB token on Ethereum is:

- `holder_distribution`: Reconstruct top holders from `Transfer` event deltas.
```

**Why this works**

This shows Logrunner inspecting the contract/event surface before choosing an analysis. It makes the holder demo feel like one discovered capability, not a hardcoded trick.

## 2. Multichain DAO Readiness

**User**

```text
Compare the Arbitrum DAO timelocks on Ethereum and Arbitrum. Are both linked and ready?
```

**Agent**

```text
Both Arbitrum DAO timelocks are linked and ready:

Ethereum mainnet (L1 Timelock):
- Address: `0xe6841d92b0c345144506576ec13ecf5103ac7f49`
- Contract: `L1ArbitrumTimelock` via `arbitrumdaol1timelock`

Arbitrum One (L2 Core Timelock):
- Address: `0x34d45e99f7d8c45ed05b5ca72d54bbd1fb3f98f0`
- Contract: `ArbitrumTimelock` via `arbitrumdaol2coretimelock`
```

**Why this works**

This is a clean way to show that Logrunner is not locked to one chain. It checks configured backend profiles and reports contract readiness on both Ethereum and Arbitrum.

## 3. Bounded Negative Answer

**User**

```text
Does the Ethereum ARB token show pause, blacklist, ownership, or role-control events?
```

**Agent**

```text
No, the Ethereum ARB token does not show pause, blacklist, ownership, or role-control events. The only detected events are `Approval`, `Initialized`, and `Transfer`.
```

**Why this works**

This shows restraint. The agent can inspect the event surface and say "no" instead of inventing a control-plane story.

## 4. Verified Contract Lookup

**User**

```text
Look up verified contract candidates for the Ethereum ARB token address `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`. Don't import anything.
```

**Agent**

```text
The verified contract candidates for the Ethereum ARB token address `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1` are:

- `TransparentUpgradeableProxy` at `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`
- `L1ArbitrumToken` at `0xad0c361ef902a7d9851ca7dcc85535da2d3c6fc7` (preferred)
```

**Why this works**

This demonstrates ABI lookup and proxy/implementation awareness without mutating MultiBaas setup.

## 5. Mutation Confirmation

**User**

```text
Please import and link the preferred verified ABI candidate for `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`.
```

**Agent**

```text
I've found a preferred verified ABI candidate for `0xb50721bcf8d664c30412cfbc6cf7a15145234ad1`: `L1ArbitrumToken` at `0xad0c361ef902a7d9851ca7dcc85535da2d3c6fc7`.

Importing this will link the ABI and may start historical indexing. Do you want me to proceed?
```

**Why this works**

This shows the judge-facing safety posture: exploration is available, but potentially expensive setup mutation requires explicit confirmation.

## Best Extras To Use Live

If there is only time for one or two optional extras, use:

1. Event-backed investigation discovery for ARB.
2. Multichain DAO timelock readiness.

Those are the cleanest and lowest-risk follow-ups. The mutation-confirmation example is useful if a judge asks about safety or asks whether the agent can onboard more contracts.
