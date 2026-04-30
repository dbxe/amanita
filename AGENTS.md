# Web3 intelligence agent harness

This file is for coding agents and maintainers working inside the repo. Treat it as a short set of repo conventions. Human-facing setup and runbooks live elsewhere:

- `README.md` — quickstart and current MVP commands
- `docs/architecture.md` — repo shape, boundaries, and design direction
- `docs/nanoclaw.md` — NanoClaw setup, auth wiring, restart, and test runbook

## Repo boundaries

- `hardhat/` is the local chain fixture and deployment helper for demos. Keep runtime harness logic outside it.
- The harness runtime lives under `src/`.
- Local state should stay naming-neutral and default to `.agent-state/`.

## Current source map

- `src/config.ts` — environment and local deployment config resolution
- `src/multibaas.ts` — MultiBaas SDK integration and webhook signature helpers
- `src/state.ts` — watch/webhook local persistence
- `src/agent-tools.ts` — orchestration layer for query, watch, and webhook flows
- `src/intent.ts` — lightweight natural-language adapter for the local demo
- `src/mcp.ts` — stdio MCP surface for NanoClaw
- `src/nanoclaw.ts` — NanoClaw `container.json` helper
- `src/index.ts` — local CLI entrypoint

If the runtime grows, do not keep piling unrelated behavior into `src/agent-tools.ts`. The next split should be by responsibility, for example watch logic, webhook logic, and pure formatting helpers.

## Working preferences

Prefer:

- typed SDK calls over ad hoc HTTP calls
- harness-owned query/watch logic over free-form LLM-generated query JSON
- one reusable webhook ingress plus a local watch registry over one webhook per watch
- MCP integration over shelling out from the agent when NanoClaw is involved
- OneCLI path-scoped secret injection over raw API keys in NanoClaw `container.json`

## Testing expectations

- For repo-local work, use the CLI paths in `README.md`.
- For NanoClaw-backed work, use the deterministic CLI path in `docs/nanoclaw.md` before testing Discord or DM flows.
- Validate the smallest working loop first, then extend outward.

## Naming guidance

The current repo directory name may change later, so new code and docs should stay naming-neutral.

Prefer neutral names for:

- package metadata
- env vars
- local state directories
- webhook labels
- CLI text

When adding new surfaces, prefer names tied to the function of the system:

- `MULTIBAAS_*` or other domain-scoped env vars over repo-scoped prefixes
- generic runtime/state paths over repo-name paths
- neutral labels like `balance-watch` over project-branded labels
- user-facing help text that describes the tool, not the repo
