# MultiBaas-backed Web3 intelligence runtime

This repo is a **generic Web3 intelligence system** built on top of MultiBaas. Its long-term direction is a typed, composable runtime where an agent answers protocol questions by combining reusable capabilities instead of relying on a growing shell of prompt-specific workflows.

The **current demo focus is Arbitrum DAO**. That story is still early. Live sync coverage, backend correctness, and contract-role reliability are still being hardened, so the current priority is to make the DAO path reliable enough to learn what the strongest story actually is.

Do not read today's operator prompts and backend-health checks as the finished DAO demo. They are build-stage validation tools that help stabilize the runtime while the DAO intelligence story is still being discovered.

## Documentation map

- `README.md` — quickstart and current repo posture
- `docs/arbitrum-dao-demo.md` — DAO pivot framing: what is being validated now vs what the story should become
- `docs/architecture.md` — repo shape, module boundaries, and design direction
- `docs/nanoclaw.md` — NanoClaw setup, auth wiring, preflight, reset, and stale-session recovery
- `docs/nanoclaw-live-tests.md` — live validation matrix split into operator health checks and exploratory DAO probes
- `docs/phase-01.md` — original Phase 01 plan and partial implementation record
- `docs/phase-02.md` — current capability-first direction with DAO-first packaging
- `AGENTS.md` — repo conventions for coding agents

## Current posture

Two things are true at once:

- the runtime is still **generic**
- the repo is currently being packaged around **Arbitrum DAO**

That packaging choice is deliberate. Token, stablecoin, pool, event-sourced, and multibackend investigations are still part of the substrate, but one strong live story is better than several fragmented ones. Right now the strongest candidate story is DAO intelligence, so the repo is prioritizing the Arbitrum DAO path while keeping the underlying runtime naming-neutral and reusable.

## North star

The product direction is:

- reusable, typed MultiBaas-backed capabilities
- explicit readiness, waiting, and execution state
- model-driven composition of lower-level tools
- less reliance over time on workflow-specific natural-language routing

The repo still contains some compatibility-era surfaces, but the main runtime direction is capability-first. Prefer the framing in [`docs/phase-02.md`](docs/phase-02.md) over adding new workflow-specific routing.

## Repo-health acceptance

Treat repo health in two layers.

### A. Operator health

A fresh operator should be able to:

- configure NanoClaw for a target group
- run `nanoclaw preflight`
- verify mounted runtime build and backend registry presence
- verify OneCLI `/api/v0/*` secret coverage for each configured backend
- recover stale state with `nanoclaw reset-group`
- ask narrow sync, link, backend, and role-identification questions and get grounded answers

### B. Product-intelligence readiness

A fresh operator should also understand that:

- the Arbitrum DAO story is still being shaped
- some contracts may still be syncing
- today's stable result set is narrower than the intended final DAO story
- operator-health prompts are not the intended end-state user experience

## Prerequisites

1. Node 22+
2. A populated `hardhat/deployment-config.<network>.ts`
3. For repo-local fixture work, the sample token deployed and linked from `hardhat/`

If you need the local fixture from scratch:

```bash
cd hardhat
npm install
npm run deploy
npm run mint
```

## Install

```bash
npm install
```

`src/config.ts` resolves MultiBaas settings from either:

- `MULTIBAAS_BASE_URL` and `MULTIBAAS_API_KEY`
- `.multibaas/backends.local.json` selected through `MULTIBAAS_PROFILE` or that file's `defaultProfile`
- `hardhat/deployment-config.<network>.ts`

The local backend-profile file is gitignored. Use `.multibaas/backends.example.json` as the shape reference.

Useful backend commands:

```bash
# show all configured backends
npm run dev -- backend list

# use the gitignored default profile from .multibaas/backends.local.json
npm run dev -- contract list-interfaces

# force the local hardhat/dev backend
MULTIBAAS_PROFILE=development npm run dev -- contract list-interfaces

# force a specific remote profile
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- contract list-interfaces
```

Important MultiBaas convention:

- the deployment selects the chain
- for EVM deployments, the API path still remains `/api/v0/chains/ethereum/...`

Do not treat that URL fragment as proof that a backend is Ethereum mainnet. Chain identity comes from the backend profile and deployment metadata, not from the path segment.

## Generic runtime capabilities

The runtime remains broader than the current DAO packaging. Current typed capability surfaces include:

- contract/interface inspection and bounded onboarding
- token metadata, balance, concentration, and top-holder reads
- event-surface inspection and bounded event-backed investigations
- multibackend target inspection
- local watches, task persistence, and webhook delivery
- the same operations exposed through CLI and stdio MCP

Representative CLI entrypoints:

```bash
npm run dev -- query balance --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --address 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172
npm run dev -- query controls --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --limit 10
npm run dev -- query investigate --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --limit 5
npm run dev -- query multichain-inspect --targets source@mainnet-remote:0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5,destination@arbitrum-one-remote:0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5
npm run dev -- query event-capabilities --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5
npm run dev -- query event-investigation --contract 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5 --lead holder_distribution --limit 10
```

Local watch state stays under `.agent-state/`.

## Current demo focus: Arbitrum DAO

The current live demo packaging is Arbitrum DAO, but the story is still in discovery because:

- sync coverage across the DAO contract set is still being established
- backend/profile correctness is still part of the day-to-day validation loop
- role identification and cross-backend consistency still need repeated live verification

The current build-stage goal is not to pretend the DAO intelligence story is finished. The goal is to stabilize the live DAO path enough to discover which intelligence questions produce the strongest demo.

See [`docs/arbitrum-dao-demo.md`](docs/arbitrum-dao-demo.md) for the DAO-specific framing.

## Question tracks

### Operator / build-stage questions

These are first-class validation tools, but they are not the end-state product story.

- "What backends are configured right now?"
- "Which backend profiles are present and do they have OneCLI `/api/v0/*` secret coverage?"
- "For this DAO contract set, which targets are `ready`, `syncing`, or `needs-link`?"
- "Is this address really the treasury governor, core timelock, or upgrade executor?"
- "How does this contract look across Ethereum mainnet and Arbitrum backends?"

Representative commands and flows:

```bash
npm run dev -- backend list
npm run dev -- query multichain-inspect --targets l1@mainnet-remote:0xE6841D92B0C345144506576eC13ECf5103aC7f49,l2@arbitrum-one-remote:0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0
npm run dev -- contract inspect --contract 0xE6841D92B0C345144506576eC13ECf5103aC7f49
npm run dev -- query controls --contract 0xE6841D92B0C345144506576eC13ECf5103aC7f49 --limit 10
```

### Emerging DAO intelligence questions

These are the questions the repo is trying to earn, not claim prematurely. Treat them as exploratory and still evolving.

- "How is Arbitrum DAO governance structured across Ethereum and Arbitrum?"
- "Which timelock or executor paths matter most right now?"
- "Which proposals had treasury consequences?"
- "Where does upgrade power live in practice?"
- "What governance or treasury risks are visible, and which parts are still blocked on sync?"

The correct live behavior here is:

- stay grounded in current tool results
- preserve syncing uncertainty explicitly
- avoid turning operator-health facts into finished product conclusions

## NanoClaw operator loop

For NanoClaw-backed work, the standard operator loop is:

1. build and configure the mounted runtime
2. run `nanoclaw preflight`
3. verify backend registry presence, active session/container state, and OneCLI secret coverage
4. if a session is stale or poisoned, run `nanoclaw reset-group`
5. run narrow health checks first
6. only then run broader DAO intelligence probes

`nanoclaw preflight` is an **operator health check**, not a product feature.

Its purpose is to verify:

- mounted runtime build presence
- backend registry or selected base URL presence
- active session and container state
- OneCLI `/api/v0/*` secret coverage for each configured backend

`nanoclaw reset-group` is also an operator tool. It is for stale-session recovery and poisoned-state cleanup, not part of the product story.

See [`docs/nanoclaw.md`](docs/nanoclaw.md) for the operational runbook and [`docs/nanoclaw-live-tests.md`](docs/nanoclaw-live-tests.md) for the live validation matrix.

## Webhooks

Run the local webhook receiver:

```bash
npm run dev -- webhook serve --secret <webhook-secret> --port 8787
```

To have webhook-triggered alerts delivered back through a NanoClaw session:

```bash
npm run dev -- webhook serve \
  --secret <webhook-secret> \
  --port 8787 \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder dm-with-<name>
```

Register or update the shared MultiBaas webhook when you have a reachable callback URL:

```bash
npm run dev -- webhook ensure --url https://your-host.example/webhooks/multibaas
```

For local development:

- if MultiBaas is running on the host, use `http://127.0.0.1:8787/webhooks/multibaas`
- if MultiBaas is running in a container that can reach the host via Docker DNS, use `http://host.docker.internal:8787/webhooks/multibaas`

The webhook handler validates `X-MultiBaas-Signature` and `X-MultiBaas-Timestamp`, refreshes tracked watch state, and appends alerts to `.agent-state/alerts.jsonl`.

## MCP server

The same operations are exposed over stdio MCP:

```bash
npm run mcp
```

Representative tools:

- `list_preloaded_interfaces`
- `inspect_contract_interfaces`
- `ensure_contract_interface`
- `resolve_contract_target`
- `inspect_event_capabilities`
- `run_event_investigation`
- `get_token_control_events`
- `investigate_token`
- `get_top_holders`
- `get_holder_concentration`
- `get_address_balance`
- `create_balance_watch`
- `list_balance_watches`
- `evaluate_tasks`
- `ensure_event_webhook`

The preferred direction is still:

- preloaded interface matching
- explicit contract-targeted reads and views
- bounded event-view compilation

not unconstrained model-authored backend payloads.

## NanoClaw bridge

This repo can write the NanoClaw group config needed to mount the runtime repo and register the MCP server:

```bash
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
```

What that does:

- adds a read-only mount for this repo into the NanoClaw container
- registers the `multibaas-runtime` MCP server in the target group's `container.json`
- rewrites a host-local MultiBaas base URL like `localhost` to `host.docker.internal` for container access
- sets a stable in-container state directory for watches
- optionally adds this repo to NanoClaw's mount allowlist

When the runtime runs inside NanoClaw, authenticated MultiBaas calls should use **OneCLI path-scoped secret injection** rather than a raw API key in `container.json`. The runtime sends a placeholder bearer token when no direct key is configured so OneCLI can rewrite it on `/api/v0/*` requests.

For the working NanoClaw install pattern, auth model, preflight/reset flow, and stale-session recovery, use [`docs/nanoclaw.md`](docs/nanoclaw.md).
