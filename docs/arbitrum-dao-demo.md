# Arbitrum DAO demo posture

This repo is a generic Web3 intelligence runtime. The current live packaging is **Arbitrum DAO**, but that story is still being discovered rather than declared finished.

The immediate goal is to make the DAO path reliable enough to learn what the strongest story actually is. That means operational and backend-health questions are temporarily important, but they are not the intended end-state user experience.

## What we are validating now

The current build-stage validation loop is focused on whether the live DAO path is trustworthy enough to support stronger intelligence later.

Right now we are validating:

- sync progress across the DAO contract set
- backend/profile correctness
- contract-role identification
- cross-backend consistency between Ethereum mainnet and Arbitrum One
- whether NanoClaw can reliably surface the right readiness state

In practice, that means questions like:

- which DAO targets are `ready`, `syncing`, or `needs-link`
- whether the mounted NanoClaw group can actually see the right backend registry
- whether OneCLI `/api/v0/*` coverage exists for each configured backend
- whether a given address is really the treasury governor, timelock, or upgrade executor

These are valid and important build-stage uses of the runtime. They just are not the final DAO story.

## What we expect the story to become

Once the live path is stable enough, the DAO demo should become a richer intelligence story built on top of the same generic substrate.

The expected direction is:

- governance structure across Ethereum and Arbitrum
- proposal lifecycle and execution flow
- treasury consequences of governance actions
- power relationships among governors, timelocks, executors, and upgrade surfaces
- eventually richer event-derived governance intelligence

Questions in that future story look more like:

- which proposals were most consequential
- which governance actions affected treasury movement
- where execution authority lives in practice
- how L1 and L2 governance responsibilities split
- what risks are currently queued or recently executed

## Why the story is not locked yet

The DAO story is not fully locked because the live system is still being stabilized.

That includes:

- finishing enough sync coverage to answer broader questions honestly
- verifying that backend/profile targeting is correct
- confirming that role identification stays grounded across backends
- hardening the NanoClaw operator loop so stale state does not distort conclusions

Until those pieces are reliable, broader DAO prompts should be treated as exploratory. A good answer is grounded and explicit about uncertainty. A bad answer sounds complete before the system has earned that confidence.

## Strategic frame

The repo should stay generic at the substrate layer and DAO-first at the demo layer.

That means:

- keep typed capabilities naming-neutral and reusable
- keep operator-health checks as first-class build-stage tools
- avoid turning current validation prompts into the permanent product identity
- use the Arbitrum DAO packaging to focus the live demo, not to narrow the runtime itself

For current live validation steps, use [`docs/nanoclaw-live-tests.md`](docs/nanoclaw-live-tests.md). For operator setup and recovery, use [`docs/nanoclaw.md`](docs/nanoclaw.md).
