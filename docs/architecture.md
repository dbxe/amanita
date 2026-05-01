# Architecture

This repo is evolving from a thin MultiBaas/NanoClaw harness into a **protocol intelligence runtime** with a typed, composable tool surface.

The architectural north star is:

- reusable MultiBaas-backed domain capabilities
- explicit readiness, waiting, and execution state
- LLM tool composition over those capabilities
- less reliance over time on workflow-specific natural-language routing

The repo still contains MVP-era compatibility layers. Those are useful for current validation, but they should not be treated as the long-term product architecture.

## What lives where

- `src/` — harness runtime code
- `hardhat/` — local ERC-20 fixture, deployment, minting, and query bootstrap
- `.agent-state/` — local watch and alert state for repo-local runs

Treat `hardhat/` as fixture infrastructure, not as the home of the runtime.

## Current module boundaries

- `config.ts` resolves runtime config from environment or local Hardhat deployment config.
- `multibaas.ts` owns the MultiBaas SDK client and low-level helpers like balance normalization and webhook signatures.
- `token-target-service.ts` resolves token names and contract addresses into explicit runtime targets.
- `query-service.ts` owns typed balance and concentration execution over explicit token targets.
- `planning.ts` is now mostly a narrow helper for watch/readiness planning and legacy plan tests rather than the center of the runtime.
- `state.ts` owns local persistence for watches, webhook metadata, and alerts.
- `holder-query-service.ts` owns holder-query orchestration and readiness/onboarding transitions.
- `watch-service.ts` owns watch lifecycle orchestration and alert evaluation.
- `webhook-service.ts` owns webhook registration and the local ingress server.
- `task-formatting.ts` owns human-readable rendering for task, watch, alert, and webhook output.
- `agent-tools.ts` is now a compatibility barrel over the runtime services above.
- `intent.ts` is a legacy compatibility adapter for a narrow natural-language surface.
- `mcp.ts` exposes the harness operations to NanoClaw through stdio MCP.
- `nanoclaw.ts` writes NanoClaw group config needed to mount the repo and register the MCP server.
- `index.ts` is the local CLI entrypoint.

## Structure assessment

The current shape is serviceable as a transition state, but it still carries strong MVP assumptions:

- low-level integration code is separated from adapters
- the CLI and MCP entrypoints are already thin
- local persistence is isolated

The remaining pressure point is the workflow-first model surface:

- `src/intent.ts` encodes English-pattern routing
- `src/mcp.ts` still privileges a high-level workflow tool
- the task model and `src/planning.ts` still carry workflow-shaped types even though the runtime no longer depends on them as broadly as before

Those surfaces are the main architectural drag on the Phase 02 direction.

## Next structural move

Do not do a broad refactor with vague abstractions. The next useful moves are narrow and directional:

1. move watch-oriented orchestration into a watch service
2. move webhook registration and receiver logic into a webhook service
3. move human-readable renderers into a formatter module
4. expose typed capability-oriented MCP tools that do not depend on the high-level intent router
5. reduce `src/intent.ts` to compatibility glue rather than growing it into the product architecture

Steps 1 through 3 are now in place. The next material pressure reduction is step 4 and then shrinking the compatibility router further.

That keeps the entrypoints thin while shifting the runtime toward the Phase 02 model.

## Local reference repos

These repos are the main adjacent references for this workspace:

| Purpose | Path |
| --- | --- |
| NanoClaw runtime | `~/git/qwibitai/nanoclaw` |
| MultiBaas docs | `~/git/curvegrid/docs` |
| Generated TypeScript SDK | `~/git/curvegrid/multibaas-sdk-typescript` |
| Older MCP proof of concept | `~/git/curvegrid/multibaas-mcp-poc` |

Use them with this priority:

- primary client surface: generated TypeScript SDK
- API behavior and semantics: MultiBaas docs
- MCP boilerplate reference only: older MCP proof of concept
- local agent runtime: NanoClaw

## Design preferences

Prefer:

- typed SDK calls over ad hoc curl
- a harness-owned tool layer over free-form LLM-generated event-query JSON
- one reusable webhook ingress plus many local watches
- NanoClaw MCP integration over arbitrary shell execution
- naming-neutral runtime surfaces
