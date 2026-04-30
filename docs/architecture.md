# Architecture

This repo holds the thin harness around MultiBaas and NanoClaw. The goal is not a large bespoke agent framework; it is a small, composable runtime layer that can answer event-sourced questions now and grow into a broader tool surface later.

## What lives where

- `src/` — harness runtime code
- `hardhat/` — local ERC-20 fixture, deployment, minting, and query bootstrap
- `.agent-state/` — local watch and alert state for repo-local runs

Treat `hardhat/` as fixture infrastructure, not as the home of the runtime.

## Current module boundaries

- `config.ts` resolves runtime config from environment or local Hardhat deployment config.
- `multibaas.ts` owns the MultiBaas SDK client and low-level helpers like balance normalization and webhook signatures.
- `state.ts` owns local persistence for watches, webhook metadata, and alerts.
- `agent-tools.ts` is the application layer that combines config, MultiBaas calls, and state updates into top-holder, balance, watch, and webhook operations.
- `intent.ts` is a deliberately thin natural-language adapter for the local MVP.
- `mcp.ts` exposes the harness operations to NanoClaw through stdio MCP.
- `nanoclaw.ts` writes NanoClaw group config needed to mount the repo and register the MCP server.
- `index.ts` is the local CLI entrypoint.

## Structure assessment

The current shape is acceptable for an MVP:

- low-level integration code is separated from adapters
- the CLI and MCP entrypoints are already thin
- local persistence is isolated

The main pressure point is `src/agent-tools.ts`, which currently mixes:

- orchestration
- formatting
- watch persistence flows
- webhook registration
- the local HTTP webhook server

That is still manageable today, but it is the first file that should be split when the harness grows.

## Next structural move

Do not do a broad refactor yet. The next useful split is narrow:

1. move watch-oriented orchestration into a watch service
2. move webhook registration and receiver logic into a webhook service
3. move human-readable renderers into a formatter module

That keeps the entrypoints thin without introducing a heavy architecture too early.

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
