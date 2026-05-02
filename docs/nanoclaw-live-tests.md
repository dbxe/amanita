# NanoClaw live integration tests

This runbook tracks **live NanoClaw + amanita + MultiBaas** validation for the current DAO pivot.

The tests are split into two categories on purpose:

1. **Operator / health checks**
2. **DAO intelligence probes**

That distinction matters. Operator prompts are build-stage tools for stabilizing the live path. They are not the finished product story. DAO intelligence probes are the emerging story and should be treated as exploratory while sync coverage and backend reliability are still evolving.

Run live tests **sequentially**. Do not overlap NanoClaw chat requests.

## Required host-side abilities

For these tests to be meaningful, the coding agent needs host-side access to:

1. rebuild this repo and rerun `nanoclaw configure`
2. run `nanoclaw preflight`
3. run `nanoclaw reset-group` or stop the exact affected session container
4. inspect MultiBaas state from the host with this repo's config surfaces
5. inspect NanoClaw logs and session DB state when a run stalls or loops

Those abilities do not imply moving MultiBaas secrets into the container. Keep OneCLI as the NanoClaw auth path.

## Standard operator preflight

Before any live retest:

```bash
cd ~/git/dbxe/amanita
npm test
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder dm-with-<name> \
  --write-allowlist
npm run dev -- nanoclaw preflight \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name>
```

If the group is stale or poisoned:

```bash
cd ~/git/dbxe/amanita
npm run dev -- nanoclaw reset-group \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name>
```

If you only need to clear a single active live session:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker stop <exact-container-name>
```

CLI success does **not** prove Discord or DM success. Those channels may resume older session state, so rerun the exact affected channel before calling a live issue fixed.

## How to judge a live pass

Judge the run by capability correctness, not exact wording.

A pass means:

- the mounted tool surface was used successfully
- the answer is grounded in the intended target and backend context
- uncertainty from `needs-link` or `syncing` is preserved clearly
- operator-health state is not confused with DAO-level conclusions

Fail the run if the answer:

- invents values or identities
- treats missing auth as a product conclusion
- reports a whole contract set as unlinked when the issue is only one backend or one still-syncing target
- uses stale session context

## Category 1: Operator / health checks

These should be the first live tests run after preflight.

### 1. Liveness

**Goal:** confirm the target group is alive and responding after preflight.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "hello"
```

**Expected live behavior**

- responds normally
- does not show missing MCP-tool behavior

### 2. Backend registry and secret coverage awareness

**Goal:** confirm the runtime can speak concretely about the currently configured backend set.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "What backend profiles are available for the current Arbitrum DAO setup, and do any of them still look misconfigured?"
```

**Expected live behavior**

- distinguishes configured backends rather than collapsing them into one
- keeps any auth or coverage caveats operational
- does not confuse secret coverage problems with DAO conclusions

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
npm run dev -- backend list
npm run dev -- nanoclaw preflight \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name>
```

### 3. Linked vs syncing vs needs-link split

**Goal:** confirm narrow readiness questions return the correct per-target state.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "For the current Arbitrum DAO contract set, which targets are ready, which are still syncing, and which still need linking?"
```

**Expected live behavior**

- reports a backend-aware split instead of one blanket status
- preserves uncertainty if some targets are still syncing
- does not report a false `completely unlinked` state

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
npm run dev -- query multichain-inspect --targets l1@mainnet-remote:0xE6841D92B0C345144506576eC13ECf5103aC7f49,l1exec@mainnet-remote:0x3ffFbAdAF827559da092217e474760E2b2c3CeDd,coregov@arbitrum-one-remote:0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9,treasurygov@arbitrum-one-remote:0x789fC99093B09aD01C34DC7251D0C89ce743e5a4,coretimelock@arbitrum-one-remote:0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0,treasurytimelock@arbitrum-one-remote:0xbFc1FECa8B09A5c5D3EFfE7429eBE24b9c09EF58,upgradeexec@arbitrum-one-remote:0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827,treasury@arbitrum-one-remote:0xF3FC178157fb3c87548bAA86F9d24BA38E649B58
```

### 4. Narrow role identification

**Goal:** confirm the agent can identify a specific contract role without drifting into broader conclusions.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "What is 0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0 in the Arbitrum DAO setup, and how sure are you given current sync state?"
```

**Expected live behavior**

- identifies the target as the L2 core timelock if the linked surface supports that conclusion
- preserves any sync caveat clearly
- stays narrow instead of pretending to summarize governance health

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
MULTIBAAS_PROFILE=arbitrum-one-remote npm run dev -- contract inspect --contract 0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0
```

## Category 2: DAO intelligence probes

These are exploratory. A good answer is grounded and honest about sync limits. A bad answer sounds finished when the underlying system is still stabilizing.

### 5. Governance-health probe

**Goal:** test the current broad DAO framing without overselling maturity.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Give me a governance health read on Arbitrum DAO across Ethereum and Arbitrum. Keep sync gaps explicit."
```

**Expected live behavior**

- grounds the answer in actual contract and backend state
- separates established facts from still-syncing areas
- does not convert operator-health facts into final product claims

### 6. Treasury / timelock / executor probe

**Goal:** test whether the agent can relate treasury, timelock, and executor roles without hiding uncertainty.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Walk me through the treasury, timelock, and upgrade-executor parts of Arbitrum DAO. Which pieces are already grounded and which still need sync to answer well?"
```

**Expected live behavior**

- identifies the major role surfaces
- flags where the answer is still partial because a target or backend is syncing
- does not claim finished treasury-consequence intelligence if that path is not ready

### 7. Proposal and consequence probe

**Goal:** test whether the story stays exploratory when asked about proposal outcomes.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Which Arbitrum DAO proposals look most consequential so far, especially anything tied to treasury movement or execution authority?"
```

**Expected live behavior**

- answers only from grounded current evidence
- says when the story is still incomplete because history is still syncing
- avoids inventing fully analyzed proposal consequences

### 8. Cross-chain DAO-context probe

**Goal:** confirm the agent keeps Ethereum and Arbitrum roles distinct.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "How does governance authority split between Ethereum mainnet and Arbitrum One in the current Arbitrum DAO setup?"
```

**Expected live behavior**

- keeps the cross-backend split explicit
- distinguishes L1 and L2 control surfaces
- preserves any readiness gaps rather than flattening them

## Pass criteria

### Operator health

A pass means:

- no false missing-credentials behavior
- no false `completely unlinked` answer
- correct backend/profile split
- `preflight` plus `reset-group` is enough to recover common stale-state failures

### DAO intelligence probes

A pass means:

- the answer is grounded
- syncing uncertainty is preserved clearly
- operator-health state is not confused with product conclusions
- failures are described as part of an evolving story, not silently treated as done

## Handoff checklist

Do not hand off a live NanoClaw result as "working" without recording:

1. the exact group folder and channel rerun
2. the exact prompt or prompts used
3. whether the retest used plain preflight, exact-container stop, or `reset-group`
4. which channels were not rerun yet
5. whether the result was an operator-health pass or an exploratory DAO probe

## Troubleshooting checks

If a live result looks wrong:

1. inspect the target group config:

```bash
cat ~/git/dbxe/nanoclaw/groups/cli-with-<name>/container.json
```

2. inspect NanoClaw logs:

```bash
tail -n 120 ~/git/dbxe/nanoclaw/logs/nanoclaw.log
tail -n 120 ~/git/dbxe/nanoclaw/logs/nanoclaw.error.log
```

3. inspect session DB state:

```text
~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/inbound.db
~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/outbound.db
```

4. confirm MultiBaas state from the host with repo-local CLI commands
5. if the same stale context persists, use `nanoclaw reset-group`
