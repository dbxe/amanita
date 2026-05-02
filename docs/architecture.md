# Architecture

This repo is a **generic MultiBaas-backed Web3 intelligence runtime**. The current packaging is DAO-first, specifically around Arbitrum DAO, but the substrate remains capability-first and reusable across protocol families.

The important posture is:

- keep the runtime generic
- package the current live effort around one strong story
- treat today's operator-health prompts as stabilization tools, not as the intended end-state UX

## Architectural north star

The repo direction is:

- reusable MultiBaas-backed domain capabilities
- explicit readiness, waiting, and execution state
- bounded event-backed analytical views
- LLM tool composition over typed capabilities
- less reliance over time on workflow-specific natural-language routing

The runtime still carries some compatibility-era surfaces, but the old router-first posture is no longer the design center.

## Current packaging reality

The current demo focus is Arbitrum DAO. That does **not** mean the runtime is becoming DAO-only.

What it means:

- the repo is choosing a DAO-first presentation for the current live demo effort
- the live system is still being hardened through backend, sync, and role-identification work
- operational questions are temporarily important because they help stabilize the system
- those operational questions are not the long-term product story

## What lives where

- `src/` — runtime code
- `hardhat/` — local fixture and deployment helper for deterministic development
- `.agent-state/` — local watch and alert state for repo-local runs

Treat `hardhat/` as fixture infrastructure, not as runtime logic.

## Current module boundaries

- `config.ts` resolves runtime config from env, backend registry JSON, or local deployment config.
- `multibaas.ts` owns the MultiBaas SDK client and low-level helpers.
- `token-target-service.ts` resolves token names and contract addresses into explicit runtime targets.
- `query-service.ts` owns typed balance and concentration execution over explicit token targets.
- `preloaded-interfaces.ts` owns the bounded interface inventory and matching helpers.
- `contract-interface-service.ts` owns interface inspection, linking, and preloaded-interface status.
- `event-view.ts` owns the bounded intermediate spec for event-backed analytical views.
- `event-view-service.ts` owns runtime execution and formatting for event-backed views.
- `event-intelligence-service.ts` owns ABI/event-surface inspection and bounded investigation-lead execution.
- `investigation-service.ts` owns grounded investigation synthesis over metadata plus analytical views.
- `multichain-service.ts` owns explicit multibackend target comparison and readiness reporting.
- `runtime-types.ts` owns neutral runtime-state and execution-plan types.
- `readiness.ts` owns reusable readiness classification.
- `state.ts` owns local persistence for watches, webhook metadata, and alerts.
- `holder-query-service.ts` owns holder-query orchestration and readiness transitions.
- `watch-service.ts` owns watch lifecycle orchestration and alert evaluation.
- `webhook-service.ts` owns webhook registration and the local ingress server.
- `task-formatting.ts` owns human-readable formatting for tasks, watches, alerts, and webhook state.
- `agent-tools.ts` remains compatibility glue.
- `mcp.ts` exposes the runtime through stdio MCP.
- `nanoclaw.ts` writes NanoClaw group config for the mounted MCP path.
- `index.ts` is the local CLI entrypoint.

## Structural assessment

The runtime already has the important shape:

- low-level integration is separated from adapters
- CLI and MCP entrypoints are thin
- local state is isolated
- bounded event-view compilation exists
- multibackend addressing is explicit

The main remaining work is not a bigger workflow router. It is deeper capability coverage and more trustworthy live execution.

Near-term architectural pressure points are:

- strengthening live onboarding and sync-state handling
- making multibackend DAO investigations more reliable
- expanding event-backed intelligence without letting the model author raw backend payloads by default
- keeping NanoClaw operator-health surfaces strong enough that live validation remains trustworthy

## Current demo implications

For the Arbitrum DAO pivot, architecture should support two layers explicitly:

### Operator health

Needed now because the live path is still stabilizing:

- backend registry inspection
- OneCLI secret coverage checks
- linked vs syncing vs needs-link state
- cross-backend target inspection
- stale-session recovery

### Product-intelligence readiness

The intended story once the live path is stronger:

- governance structure
- proposal lifecycle
- treasury consequences
- timelock and executor power relationships
- richer event-derived DAO intelligence

The first layer is important today. It should not become the permanent product identity.

## Design preferences

Prefer:

- typed SDK calls over ad hoc HTTP
- runtime-owned query and view logic over free-form LLM-generated backend JSON
- one reusable webhook ingress plus local watch state
- MCP integration over shelling out when NanoClaw is involved
- explicit contract-targeted views that derive their own source
- naming-neutral runtime surfaces
