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

The strongest form of that target is an agent that can be pointed at a live contract or contract suite, ensure the relevant interface is available, ensure the contract is onboarded and indexed in MultiBaas, and then synthesize the right event-sourced view or contract read to answer the user's question.

Autonomous ABI discovery and upload is part of the longer-term direction, but it is not required to make Phase 02 real. For the hackathon path, a practical and acceptable strategy is to preload MultiBaas with a wide but finite set of useful interfaces and let the runtime match live contracts against that library before attempting more open-ended ABI acquisition flows.

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
- event-query synthesis for non-enumerable onchain state
- operational awareness of MultiBaas prerequisites
- durable task state for long-running work
- trustworthy answers tied to concrete execution

For multichain work, "chain selection" should be understood as a backend-registry concern, not a URL-path concern. MultiBaas chooses the indexed chain at deployment initialization time. For EVM deployments, the runtime should expect the API path to remain `/api/v0/chains/ethereum/...` even when the backend is indexing Arbitrum or another EVM chain.

This matters because many of the highest-value protocol questions cannot be answered from current contract state alone. They require reconstructing state from emitted events: holder sets hidden behind mappings, blacklist history, LP concentration by range, liquidation flows, bridge backlogs, governance/control-surface changes, and similar event-ledger problems.

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

In the longer Phase 02 direction, "execute typed event-sourced analytical views" should grow into "synthesize typed event-query views from first principles," with the runtime owning the safety rails and compilation boundary.

The model should compose these capabilities as needed.

## Architectural direction

Phase 02 should establish four layers.

### 1. Typed domain capability layer

This layer is the real product surface.

It should expose reusable operations such as:

- resolve token / contract target
- inspect address registration, contract definition, and indexing readiness
- ensure contract onboarding where policy allows it
- acquire, validate, or select ABI/interface sources for live contracts where policy allows it
- call read-only ERC-20 metadata methods
- call read-only typed contract methods for supported interfaces
- execute typed analytical views over event history
- synthesize bounded event-query specs for reconstructable state
- create and evaluate monitors against typed view specs

These operations should live in the harness, not in prompt text.

### 2. Tool-facing execution layer

This layer adapts the capability layer into MCP and CLI tools with:

- explicit input schemas
- explicit output schemas
- explicit waiting and failure states
- no hidden token, query, or alias fallbacks

Phase 02 also needs runtime-surface health checks, not just more tools. A capability is not real if the mounted MCP server can fail during startup and silently disappear from the agent's toolset. Keep process-level smoke coverage for MCP startup as part of this layer.

The model should be able to call these tools directly and combine them.

For event-query work, the model should not emit unconstrained backend payloads as its primary interface. The safer boundary is:

- the model reasons over a typed event-query intent or view-spec vocabulary
- the runtime validates and compiles that spec into MultiBaas query syntax
- the runtime owns network, ABI, onboarding, sync, and execution-state handling

This layer also needs explicit multibackend addressing. A multichain investigation should be able to name more than one configured backend in one request and receive profile-scoped readiness and execution results back, instead of relying on global profile switching.

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

The next concrete milestone after metadata is a grounded investigation slice: a tool that can combine target resolution, readiness, metadata, concentration, and top-holder context into a bounded token analysis without inventing unsupported claims.

That investigation slice should now be understood more broadly than token metadata plus holder concentration. The current Phase 02 runtime should expose:

- event-surface inspection over linked or looked-up ABI definitions
- supported bounded investigation leads derived from that detected event surface
- bounded event-backed execution for those leads once MultiBaas readiness is `ready`

This is the bridge between fixed workflow tools and the longer-term north star of compiling typed event-query intent from first principles.

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

The north-star extension of this family is event-query synthesis over live contracts:

- infer which event streams are relevant to the user's question
- understand when storage is non-enumerable and event reconstruction is the right path
- build a bounded analytical view spec
- compile it to MultiBaas event-query syntax
- execute it against a live indexed network
- explain the answer in terms of the underlying event-derived evidence

The canonical example is ERC-20 holder reconstruction from `Transfer(from,to,value)`, but the intended product surface extends to protocol suites where the important state is distributed across event-ledger transitions rather than enumerable storage reads.

For protocol-suite demos, prefer the newer canonical versions where practical. For Uniswap and Aave, that means biasing toward v4 targets if the interface and indexing path are ready in time, while treating v3 as an acceptable shipping fallback when it is materially easier to demonstrate.

### E. Live-network onboarding and indexing

The current local fixture is still useful for deterministic development, but Phase 02 must also support a live-network demo path.

That means the runtime needs explicit capabilities for:

- switching to a MultiBaas instance connected to a real network
- resolving live contracts and contract suites
- selecting from preloaded interfaces and, where needed, finding or accepting ABIs
- uploading definitions and linking contracts where policy allows it
- waiting for indexing / sync progress before analytical execution

Hackathon demo readiness depends on this path, not only on the local fixture.

The near-term implementation posture is:

- preload a finite interface library into MultiBaas
- inspect and link live contracts against those definitions
- use bounded event-view compilation for event-sourced analytics

before attempting fully autonomous ABI discovery across arbitrary live contracts.

## Relationship to MultiBaas

The system should rely on MultiBaas as the execution substrate, but the model should not need to understand raw API shapes to use it effectively.

The harness should continue to own:

- typed SDK calls where possible
- isolated HTTP fallbacks where necessary
- readiness and waiting-state interpretation
- reusable event-query generation
- bounded event-query compilation from typed intermediate specs
- typed contract method access
- live-contract onboarding and interface / ABI management policy

Explicit contract-targeted analytical views must derive their own source from that target. Do not route explicit contract views back through `defaultQueryName` or any saved-query fallback.

The model should consume this through tool descriptions and structured outputs, not by inventing backend requests.

In practical terms, the runtime should gradually learn more of the underlying MultiBaas surface: SDK, OpenAPI-described endpoints, and docs-backed semantics. But that exposure should be mediated through runtime-owned tools and compilers, not by making the LLM hand-author raw backend payloads as the default interaction model.

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

The next stage after that should include event-query-oriented tools such as:

- `find_contract_abi`
- `register_contract_definition`
- `link_contract_instance`
- `inspect_indexing_status`
- `build_event_view_spec`
- `execute_event_view`
- `investigate_protocol_surface`

`get_token_metadata` can start with:

- address
- name
- symbol
- decimals
- totalSupply

That is already enough to answer a class of questions that the current workflow model cannot handle well.

The eventual goal is not to expose the entire backend raw. The goal is to expose enough of the underlying capability surface that the model can investigate from first principles while the runtime preserves validation, boundedness, and execution trustworthiness.

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
