# Architecture

This repo is evolving from a thin MultiBaas/NanoClaw harness into a **protocol intelligence runtime** with a typed, composable tool surface.

The architectural north star is:

- reusable MultiBaas-backed domain capabilities
- event-query-driven reconstruction of non-enumerable protocol state
- explicit readiness, waiting, and execution state
- LLM tool composition over those capabilities
- less reliance over time on workflow-specific natural-language routing

The repo still contains MVP-era operational surfaces, but the old natural-language compatibility router and the planning shell are no longer part of the runtime architecture.

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
- `runtime-types.ts` owns neutral runtime state and execution-plan types.
- `readiness.ts` owns reusable readiness classification and balance-monitor readiness evaluation.
- `state.ts` owns local persistence for watches, webhook metadata, and alerts.
- `holder-query-service.ts` owns holder-query orchestration and readiness/onboarding transitions.
- `watch-service.ts` owns watch lifecycle orchestration and alert evaluation.
- `webhook-service.ts` owns webhook registration and the local ingress server.
- `task-formatting.ts` owns human-readable rendering for task, watch, alert, and webhook output.
- `agent-tools.ts` is now a compatibility barrel over the runtime services above.
- `mcp.ts` exposes the harness operations to NanoClaw through stdio MCP.
- `nanoclaw.ts` writes NanoClaw group config needed to mount the repo and register the MCP server.
- `index.ts` is the local CLI entrypoint.

## Structure assessment

The current shape is serviceable as a transition state, but it still carries strong MVP assumptions:

- low-level integration code is separated from adapters
- the CLI and MCP entrypoints are already thin
- local persistence is isolated

The remaining pressure point is capability breadth, not a workflow router:

- the current capability surface is still ERC-20-centric
- multi-step investigation flows are still thin
- event-query construction is still mostly runtime-authored rather than model-composed
- Discord/DM validation still trails CLI validation

The runtime now has the first pieces of the next layer:

- a finite preloaded interface inventory
- contract-interface inspection and linking surfaces
- a bounded event-view intermediate spec
- compilation of that spec into MultiBaas event queries

That is enough to start moving beyond hand-authored holder templates without falling back to raw model-generated backend payloads.

Those are now the main architectural drag on the Phase 02 direction.

## Next structural move

Do not do a broad refactor with vague abstractions. The next useful moves are narrow and directional:

1. expand typed capability families beyond current ERC-20 reads
2. add live-contract onboarding and ABI acquisition flows
3. add investigation-oriented multi-tool flows
4. add bounded event-query synthesis and compilation
5. keep MCP and CLI entrypoints thin and schema-driven
6. extend live validation from CLI into Discord/DM on the new capability paths

That keeps the runtime oriented around capabilities rather than sliding back into prompt-matched workflow growth.

Near-term, "ABI acquisition" should be read pragmatically. The hackathon-friendly version is a strong preloaded interface library plus runtime matching and linking on live contracts. Fully autonomous ABI discovery and upload can remain a later extension once the bounded event-query and live-network demo paths are solid.

For protocol-family prioritization, prefer newer canonical deployments where practical. In particular, Uniswap and Aave should bias toward v4 targets for final demos if the interface and data path are ready in time. The current repo-local starter inventory can still include v3 surfaces where they are materially easier to ship first.

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
