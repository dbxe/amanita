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

## Working with MultiBaas

- Use the repo's config resolution path rather than hardcoding a base URL or credentials. Prefer existing config/env surfaces and the local `hardhat/` deployment config fallback.
- Prefer the wrapper layer in `src/multibaas.ts` and higher-level services over scattering raw REST calls throughout the codebase.
- Before assuming a query should work, confirm the prerequisites conceptually: contract definition known, contract linked, indexing/sync sufficiently complete, and query/view ready to execute.
- Treat contract onboarding and indexing as long-running states, not immediate failures. If a task depends on linking or sync progress, model it explicitly as waiting or blocked.
- For testing, validate the smallest loop first: query or view execution -> watch creation -> webhook registration/receiver -> trigger an on-chain change -> confirm alert behavior.
- Use local fixtures and short-history contracts for development. Avoid relying on large historical contracts for routine testing because indexing lag can dominate the workflow.
- Prefer reusable, typed view patterns over bespoke one-off query JSON when adding new protocol support. If a raw event query is needed for diagnostics, keep it close to the view or service it belongs to.
- If the SDK path is unreliable for a specific endpoint, isolate any direct HTTP fallback in the MultiBaas integration layer and document why instead of leaking that workaround across the repo.

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
