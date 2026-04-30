# Phase 01

## Goal

Turn the current MVP harness into the foundation for a **protocol-intelligence agent**: a system that can translate somewhat ambiguous user intent into concrete MultiBaas operations, explain what it is doing, manage long-running tasks, and produce trustworthy answers and alerts from event-sourced views.

This phase is not about making the model "know everything" in one prompt. It is about building the right deterministic substrate so the model can plan reliably and act with expertise.

## Product thesis

The differentiated product is not "query any event."

It is:

- interpret a user's analytical or monitoring goal
- identify the right protocol or contract surface
- decide which event-sourced view is appropriate
- execute the required MultiBaas steps
- wait when prerequisites are not yet satisfied
- resume later with context intact
- explain results with clear confidence and limitations

The strongest targets are protocols where events are close to the source of truth and where on-chain reads do not expose a global registry. That makes event history the practical way to reconstruct current or historical state.

## Core architectural direction

Phase 01 should establish three layers.

### 1. Deterministic MultiBaas control plane

This layer owns the real operational work:

- resolve contract metadata
- upload or resolve ABI / contract definitions
- link contracts
- inspect indexing and sync readiness
- create and execute event queries
- register and evaluate monitors
- register webhooks
- route alerts back through the runtime

This layer must understand prerequisites and waiting states. Example: a contract may be linked but not yet sufficiently indexed for a requested view.

### 2. Typed view library

Do not go from natural language straight to raw event-query JSON.

Instead, build a library of typed, opinionated views such as:

- ERC-20 holder registry and concentration
- stablecoin mint / burn / blacklist / pause / upgrade state
- access-control role membership
- proxy upgrade lineage
- governance delegation and vote concentration
- Aave user activity and liquidation surfaces
- Uniswap V3 LP concentration and fee-harvest behavior
- Lido withdrawal queue state

These views should encode the known event patterns, aggregations, edge cases, and explanation logic for each protocol category.

### 3. LLM planner

The model should choose and sequence tools, but not invent the substrate.

It should translate user requests into a typed intermediate representation such as:

- `Intent`
- `Entities`
- `Goal`
- `ViewSpec`
- `ExecutionPlan`
- `WaitCondition`

That allows the system to ask follow-up questions when needed, select the right view, and explain uncertainty instead of guessing.

## What Phase 01 should avoid

Do not:

- rely on one large prompt to teach the model all of MultiBaas
- generate arbitrary event-query JSON directly from user language as the default path
- try to support every protocol category equally from day one
- blur planning and execution into one unstructured agent action

The system should be expert through structure, not just prompt wording.

## Long-running task model

This project needs first-class handling for tasks that are not immediately executable.

Examples:

- contract not yet linked
- ABI or contract definition missing
- indexing still in progress
- event sync incomplete for the requested historical range
- webhook configured but monitor not yet active
- user clarification required

Phase 01 should introduce a persistent task model with explicit states such as:

- `needs-abi`
- `needs-link`
- `syncing`
- `ready`
- `monitoring`
- `blocked`

The agent should be able to resume from these states later without losing context.

## How local assets become agent knowledge

The local MultiBaas resources should be treated as different inputs to the same system:

- **OpenAPI spec + TypeScript SDK** -> typed executor surface and tool catalog
- **Docs** -> curated playbooks, planner guidance, and protocol semantics
- **MultiBaas source code** -> operational truth about status, edge cases, sync behavior, and lifecycle details
- **This repo** -> protocol-specific view templates, monitor definitions, and explanation logic

The right outcome is not a model that has memorized MultiBaas docs. The right outcome is a system that can use these resources to plan and execute concrete steps reliably.

## Best first product surface

The best first vertical is **stablecoin and control-plane intelligence**.

Why:

- high economic value
- clear event fidelity
- strong monitoring use cases
- good fit for event-sourced views
- more differentiated than a generic ERC-20 holder demo

That initial surface should include:

- holder registry and concentration
- mint / burn ledger
- blacklist and unblacklist state
- pause and unpause state
- role and admin changes
- proxy upgrades
- treasury and large-holder movement alerts

This is a strong first category for research, compliance, treasury operations, due diligence, and risk monitoring.

## Recommended build order

1. **Task state machine**
   - Persist long-running onboarding and monitoring tasks.
   - Make readiness and blocking explicit.

2. **Intent and planning IR**
   - Introduce `ViewSpec`, `ExecutionPlan`, and `WaitCondition`.
   - Keep planning separate from execution.

3. **View template system**
   - Replace the single hardcoded query path with typed view generators.
   - Start with ERC-20 intelligence plus stablecoin control-plane views.

4. **Execution services**
   - Split orchestration out of `src/agent-tools.ts`.
   - Add dedicated services for onboarding, query execution, monitors, and webhooks.

5. **Confidence and explanation layer**
   - Every answer should explain why it is trustworthy.
   - Example: exact for additive ERC-20 transfer math; approximate where enrichment is required.

6. **Monitor model**
   - Watches should target a `ViewSpec`, not just an address.
   - Example: "alert if blacklist set changes" or "alert if top holder concentration exceeds threshold."

## Research-guided protocol prioritization

The current research suggests this ordering.

### First wave

- ERC-20 and stablecoin intelligence
- Aave user-position monitoring
- Uniswap V3 LP concentration and fee-harvest analytics
- Lido withdrawal-queue views
- governance delegation and control maps
- role and upgrade alerting

### Second wave

- GMX-style perps
- ERC-1155 inventory systems
- Seaport execution intelligence
- bridge withdrawal backlog views
- oracle health and configuration analytics

The first wave is the right scope for Phase 01 because it combines high signal, strong economic value, and relatively clean event-query modeling.

## Phase 01 definition of success

Phase 01 is successful when the agent can:

1. accept a protocol-level analytical or monitoring request
2. map it to one or more typed views
3. determine whether prerequisites are satisfied
4. execute the required MultiBaas steps when ready
5. persist long-running work when not ready
6. resume later without losing context
7. explain the result and its limits clearly

The end state is not "generic blockchain chatbot."

The end state is a reliable event-sourced research and monitoring agent built on MultiBaas.
