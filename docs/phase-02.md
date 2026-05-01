# Phase 02

## Status note

Phase 01 is intentionally **paused** for now.

It is not complete according to the original Phase 01 plan, but the repo uncovered a more urgent and more differentiated direction while implementing it: the interesting product is not a larger library of regex-routed workflow handlers. The interesting product is an agentic MultiBaas tool surface that lets the model decompose user questions into concrete, trustworthy tool use.

For now, treat unfinished Phase 01 items as **out of scope** unless they directly unblock this Phase 02 direction.

## Goal

Turn the current harness from a small set of workflow-specific operations into an **agentic protocol intelligence runtime**:

- the model receives a user question
- identifies the relevant entities and ambiguity
- decomposes the request into typed domain operations
- executes those operations through MultiBaas-backed tools
- returns an answer grounded in tool results rather than guesswork

The target is not "support more canned prompts." The target is a reusable tool substrate that can answer a wider domain of protocol questions without hardcoding each path.

## Why the direction changed

The current MVP proved two things:

1. typed MultiBaas-backed operations can answer protocol questions reliably when the operation already exists
2. a workflow-specific intent layer becomes a ceiling very quickly

The decimals example is the clearest signal:

- the user asked a legitimate ERC-20 question
- the answer was derivable through MultiBaas contract-method access
- the model did not have a suitable tool, so it improvised from context

That is the architectural problem to solve in Phase 02.

## Product thesis

The differentiated system should behave like a domain agent, not a scripted command router.

That means:

- the model should not need a dedicated workflow for every valid question
- the runtime should expose a small, typed, composable capability set
- the model should use those capabilities to build answers
- the answer should be constrained by tool results, readiness state, and explicit uncertainty

The product value is in this combination:

- domain-aware tool composition
- operational awareness of MultiBaas prerequisites
- durable task state for long-running work
- trustworthy answers tied to concrete execution

## Core principle

Prefer a **capability vocabulary** over a **workflow vocabulary**.

Bad direction:

- "top holders" flow
- "watch balance" flow
- "token decimals" flow
- "token symbol" flow
- "blacklist status" flow

Better direction:

- resolve target entity
- inspect readiness and onboarding state
- read typed contract metadata
- read typed contract state
- execute typed event-sourced analytical views
- create and evaluate typed monitors
- persist and resume blocked work

The model should compose these capabilities as needed.

## Architectural direction

Phase 02 should establish four layers.

### 1. Typed domain capability layer

This layer is the real product surface.

It should expose reusable operations such as:

- resolve token / contract target
- inspect address registration, contract definition, and indexing readiness
- ensure contract onboarding where policy allows it
- call read-only ERC-20 metadata methods
- call read-only typed contract methods for supported interfaces
- execute typed analytical views over event history
- create and evaluate monitors against typed view specs

These operations should live in the harness, not in prompt text.

### 2. Tool-facing execution layer

This layer adapts the capability layer into MCP and CLI tools with:

- explicit input schemas
- explicit output schemas
- explicit waiting and failure states
- no hidden token, query, or alias fallbacks

The model should be able to call these tools directly and combine them.

### 3. Thin planner / interpreter layer

This layer should become thinner, not thicker.

Its job is:

- recognize obvious user structure
- ask clarifying questions when the target is ambiguous
- choose the next capability call
- compose tool results into a user-facing answer

It should not become an ever-growing regex matrix that owns business behavior.

### 4. Persistent task and monitor layer

Long-running and partially ready operations remain important.

Phase 02 should continue using explicit states such as:

- `needs-abi`
- `needs-link`
- `syncing`
- `ready`
- `monitoring`
- `blocked`

But these states should apply to a broader set of capability-driven tasks, not just the current holder and watch flows.

## What Phase 02 should explicitly avoid

Do not:

- expand the intent regex layer into the primary product architecture
- add a new top-level workflow every time a user asks a new kind of protocol question
- let the model generate arbitrary raw REST payloads or arbitrary event-query JSON as the default path
- preserve hidden default token, alias, or saved-query assumptions for convenience
- answer from prior conversational context when a direct tool result is required

The model should be flexible in planning, but the substrate should remain typed and bounded.

## Tool-surface strategy

The MCP surface should shift from "a few finished workflows" toward "a small toolkit of composable domain operations."

The design rule should be:

- if a request matches a high-confidence, common workflow, the model may use a high-level tool
- otherwise, the model should decompose the request across lower-level typed tools

Over time, the center of gravity should move away from high-level workflow tools and toward reusable domain tools.

That transition should be deliberate. Do not remove a high-level tool until the lower-level path is clearly good enough to replace it in live use.

## First capability families

Phase 02 should start with ERC-20 and adjacent contract-intelligence capabilities, because that is where the current harness already has useful footing.

### A. Entity resolution and readiness

Add or formalize tools for:

- resolving token name / alias / contract address
- returning linked contract info
- reporting whether the address is known, linked, indexed, or still syncing
- optionally triggering onboarding when policy allows it

### B. Contract metadata reads

Add typed read helpers and MCP tools for:

- `name()`
- `symbol()`
- `decimals()`
- `totalSupply()`

The decimals example should be solvable entirely through this layer.

### C. Typed state reads

For supported interfaces and protocol families, add typed reads for:

- balances
- allowances
- ownership / admin
- pause state
- blacklist or role membership where relevant

### D. Event-sourced analytical views

Keep and generalize the existing strengths:

- top holders
- concentration
- balance monitoring

But represent them as typed analytical capabilities rather than fixed prompt paths.

## Relationship to MultiBaas

The system should rely on MultiBaas as the execution substrate, but the model should not need to understand raw API shapes to use it effectively.

The harness should continue to own:

- typed SDK calls where possible
- isolated HTTP fallbacks where necessary
- readiness and waiting-state interpretation
- reusable event-query generation
- typed contract method access

The model should consume this through tool descriptions and structured outputs, not by inventing backend requests.

## Proposed MCP evolution

The next MCP generation should include tools shaped more like:

- `resolve_contract_target`
- `inspect_contract_readiness`
- `get_token_metadata`
- `get_token_balance`
- `get_top_holders`
- `get_holder_concentration`
- `create_balance_watch`
- `evaluate_tasks`
- `list_balance_watches`

`get_token_metadata` can start with:

- address
- name
- symbol
- decimals
- totalSupply

That is already enough to answer a class of questions that the current workflow model cannot handle well.

## Interpretation policy

The model should follow a simple decomposition policy:

1. identify whether the user has specified the target clearly enough
2. if not, ask the smallest clarifying question
3. if yes, pick the minimal typed tools needed
4. prefer direct reads over inference
5. if readiness blocks execution, return a typed waiting state
6. if a result is partial or inferred, say so explicitly

This policy matters more than a large prompt.

## Build order

1. **Capability inventory**
   - catalog what reusable operations already exist in `src/multibaas.ts`
   - identify which ones are hidden behind current workflow tools
   - define the first public typed capability set

2. **ERC-20 metadata tools**
   - add typed helpers and MCP tools for `name`, `symbol`, `decimals`, and `totalSupply`
   - ensure responses are grounded in concrete contract-method calls

3. **Entity resolution tools**
   - expose contract resolution and readiness inspection directly through MCP
   - make ambiguity and wait states structured outputs

4. **Watch-path alignment**
   - remove the current asymmetry where holder onboarding is more capable than watch onboarding
   - decide explicitly whether watch creation should support automatic onboarding or remain a policy-gated action

5. **Intent-layer reduction**
   - keep only a small amount of interpretation glue
   - move business behavior into composable tools

6. **Live coverage expansion**
   - add live tests for metadata reads
   - add live tests for explicit-token balance and watch flows
   - add live tests for negative "do not guess the token" behavior

## Phase 02 definition of success

Phase 02 is successful when the agent can answer questions like these through tool composition rather than bespoke workflow code:

- "How many decimals does this token have?"
- "What symbol does this contract use?"
- "Who are the top holders of this token?"
- "What is this address's balance for that token?"
- "Alert me if this address's balance changes for that contract."
- "Is this contract linked and fully indexed yet?"

And when it cannot answer immediately, it should do one of three things cleanly:

- ask for the missing target
- report a typed readiness block
- persist the task and resume later

## Immediate implementation slice

The first concrete Phase 02 slice should be:

1. expose typed ERC-20 metadata reads in the MultiBaas layer
2. expose those reads through MCP
3. document and test the decimals path end to end

This is the smallest slice that proves the architectural shift:

- no new hardcoded workflow
- real question answered dynamically
- result grounded in a tool call
- reusable substrate for many more contract-read questions
