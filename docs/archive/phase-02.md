# Phase 02

## Status note

Phase 01 remains paused.

The repo's next meaningful step is still a capability-first runtime, not a larger library of regex-routed workflows. The current live packaging is now DAO-first around Arbitrum DAO, but that packaging should be understood as a demo focus layered on top of a generic substrate.

The DAO story is still being discovered through live capability hardening. Operational questions are temporarily important because they help stabilize the system. They are not the intended end-state user experience.

## Goal

Turn the harness into an **agentic Web3 intelligence runtime** where the model:

- identifies the relevant entities and ambiguity
- decomposes the request into typed domain operations
- executes those operations through MultiBaas-backed tools
- returns an answer grounded in tool results and explicit readiness state

The target is not "support more canned prompts." The target is a reusable tool substrate that can answer broader questions without adding one workflow per prompt shape.

## Current packaging

The substrate remains generic, but the repo is choosing to package the current demo effort around Arbitrum DAO because one strong story is better than several fragmented ones.

What that means in practice:

- keep capabilities naming-neutral and reusable
- make the README and live docs DAO-first
- keep operator-health prompts visible as build-stage tools
- do not pretend those operator prompts are the finished DAO demo

## Product thesis

The differentiated system should behave like a domain agent, not a scripted router.

That means:

- the runtime exposes a small, typed, composable capability set
- the model composes those capabilities
- readiness and waiting states remain explicit
- analytical views stay bounded and runtime-owned
- answers stay grounded in execution results

For multichain work, backend identity belongs to runtime config and tool inputs. The deployment selects the indexed chain. For EVM deployments, the API path still remains `/api/v0/chains/ethereum/...` even when the backend is serving Arbitrum or another EVM chain.

## Core principle

Prefer a **capability vocabulary** over a **workflow vocabulary**.

Bad direction:

- a new workflow for every token, DAO, or governance question

Better direction:

- resolve target entity
- inspect readiness and onboarding state
- inspect interface or ABI surface
- read typed metadata and contract state
- execute typed event-backed analytical views
- compare targets across backends
- persist and resume blocked work

The model should compose these capabilities as needed.

## DAO pivot reality

The Arbitrum DAO story is still early because live capability hardening is still in progress.

What is being validated now:

- sync progress across the DAO contract set
- backend/profile correctness
- contract-role identification
- cross-backend consistency
- whether NanoClaw sessions and auth wiring are healthy enough to trust the result

What the story should become:

- governance structure across Ethereum and Arbitrum
- proposal lifecycle and execution flow
- treasury consequences
- power relationships across governors, timelocks, and executors
- richer event-derived governance intelligence

The first category is temporarily important. It is not the intended final user experience.

## Architectural direction

Phase 02 still centers on four layers.

### 1. Typed domain capability layer

Expose reusable operations such as:

- resolve token or contract targets
- inspect readiness, linking, and sync state
- inspect interface and ABI surface
- read typed contract metadata and supported state
- execute bounded analytical views over event history
- inspect targets across multiple configured backends
- create and evaluate monitors

### 2. Tool-facing execution layer

Adapt those capabilities into MCP and CLI tools with:

- explicit input schemas
- explicit output schemas
- explicit waiting and failure states
- no hidden token, query, or alias defaults

This layer also needs strong runtime-health surfaces such as `nanoclaw preflight` because a capability is not real if the mounted MCP server silently disappears in live use.

### 3. Thin interpreter layer

Keep interpretation thin:

- recognize obvious structure
- ask the smallest clarifying question when needed
- choose the next capability call
- compose tool results into a user-facing answer

Do not let this layer become the product.

### 4. Persistent task and monitor layer

Keep long-running work explicit with states such as:

- `needs-abi`
- `needs-link`
- `syncing`
- `ready`
- `monitoring`
- `blocked`

## What Phase 02 should avoid

Do not:

- expand the natural-language routing layer into the primary architecture
- make the codebase DAO-only
- let the model author raw backend payloads by default
- hide backend or readiness assumptions behind convenience defaults
- present today's operator prompts as the finished DAO experience

## Near-term build order

1. keep strengthening the typed capability surface
2. keep multibackend DAO targets explicit and inspectable
3. keep NanoClaw preflight and reset strong enough to trust live runs
4. expand bounded event-backed investigations for governance and control questions
5. let the emerging DAO story be discovered from grounded live capability coverage

## Phase 02 definition of success

Phase 02 is successful when:

- a fresh operator can configure NanoClaw, run preflight, verify secret coverage, recover stale state, and ask narrow readiness questions with grounded answers
- broader DAO prompts remain grounded and explicit about sync gaps
- the repo presentation is DAO-first without making the runtime DAO-only
- the emerging DAO story is discovered through trustworthy live execution instead of being asserted ahead of the system's maturity
