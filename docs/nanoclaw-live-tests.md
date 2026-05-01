# NanoClaw live integration tests

This runbook is the reusable registry for **live NanoClaw + amanita + MultiBaas** tests. Keep it concrete and executable: each test should say what to prepare, what prompt to send, what to verify, and what host-side capabilities the coding agent needs.

Run these tests **sequentially**. Do not overlap live NanoClaw chat requests.

## What a coding agent needs to be able to do

For these tests to be useful, the coding agent needs host-side access to:

1. rebuild this repo and rerun `nanoclaw configure`
2. restart NanoClaw or stop the exact affected session container
3. inspect MultiBaas state from the host using this repo's existing config surfaces
4. inspect NanoClaw logs and session DB state when a live turn stalls or loops
5. run Hardhat fixture scripts such as the unlinked ERC-20 deploy/mint flow

Those capabilities are required for live validation. They do **not** mean moving MultiBaas secrets into the NanoClaw container. For NanoClaw-backed auth, keep secrets in OneCLI as documented in `docs/nanoclaw.md`.

## Standard preflight

Before any live NanoClaw retest:

```bash
cd ~/git/dbxe/amanita
npm test
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/qwibitai/nanoclaw \
  --group-folder dm-with-<name> \
  --write-allowlist
SERVICE_LABEL=$(launchctl list | awk '/com\.nanoclaw-v2-/{print $3; exit}')
launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL"
```

If you need to clear a single stale live session instead of restarting all of NanoClaw:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker stop <exact-container-name>
```

## How to extend this file

Add new tests as one section per scenario with:

- **Goal**
- **Preconditions**
- **Prompt**
- **Expected live behavior**
- **Host-side verification**
- **Notes / known failure modes**

Prefer additive growth:

- keep stable happy-path regressions near the top
- put mutable fixture-driven tests later
- record exact addresses and aliases when they are part of the scenario

## Current live regression set

### 1. Linked ERC-20 by address

**Goal:** the model recognizes an already linked/indexed ERC-20 by address and returns holders without asking for a saved query name.

**Preconditions**

- `helloworld` is linked in MultiBaas at `0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59`
- run the standard preflight above

**Prompt**

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "give me the top 7 holders of 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59"
```

**Expected live behavior**

- returns a holder list for that contract
- does not ask for a saved query name
- does not claim the MCP server is missing

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
npm run dev -- query top-holders --contract 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 --limit 7
```

### 2. Linked ERC-20 by alias

**Goal:** the model resolves a known linked alias directly.

**Prompt**

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "give me the top 7 holders of helloworld"
```

**Expected live behavior**

- resolves `helloworld` to `0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59`
- returns the same holder set as test 1

### 3. Linked ERC-20 by contract name

**Goal:** the model can resolve a token by linked contract name, not only alias.

**Prompt**

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "give me the top 7 holders of Hello World Token"
```

**Expected live behavior**

- resolves to the same `helloworld` contract
- returns the same holder set as test 1

### 4. Unknown token name asks for address

**Goal:** unresolved names should prompt for a contract address instead of guessing.

**Prompt**

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "give me the top 7 holders of mysterytoken"
```

**Expected live behavior**

- asks for the token contract address
- does not invent a result

### 5. Unlinked ERC-20 onboarding by address

**Goal:** when given an ERC-20 address that is not yet linked, the system should alias/link it and then return or persist a syncing result depending on index readiness.

**Fixture preparation**

Deploy and mint a fresh unlinked ERC-20 fixture:

```bash
cd ~/git/dbxe/amanita/hardhat
npm run deploy-unlinked
npm run mint-unlinked
```

Use the emitted address from the deploy/mint scripts in the prompt below.

**Prompt**

```bash
cd ~/git/qwibitai/nanoclaw
pnpm run chat -- "give me the top 10 holders of <unlinked-contract-address>"
```

**Expected live behavior**

- if indexing is still catching up, returns a syncing/waiting response
- once indexing is ready, returns the holder list
- does not ask for a saved query name

**Host-side verification**

Inspect the address registration from the host:

```bash
cd ~/git/dbxe/amanita
node --input-type=module - <<'EOF'
import { resolveConfig } from './dist/config.js';
import { getAddressRegistration } from './dist/multibaas.js';
const config = resolveConfig();
const result = await getAddressRegistration(config, '<unlinked-contract-address>');
console.log(JSON.stringify(result, null, 2));
EOF
```

You should see an alias and an `erc20interface` link after onboarding.

You can also inspect persisted holder-query task state:

```bash
cd ~/git/dbxe/amanita
npm run dev -- task list
```

## Useful troubleshooting checks

If a live NanoClaw result looks wrong:

1. inspect the live group config:

```bash
cat ~/git/qwibitai/nanoclaw/groups/cli-with-<name>/container.json
```

2. inspect live NanoClaw logs:

```bash
tail -n 120 ~/git/qwibitai/nanoclaw/logs/nanoclaw.log
tail -n 120 ~/git/qwibitai/nanoclaw/logs/nanoclaw.error.log
```

3. inspect session DB state for pending inbound rows or stale continuations:

```bash
~/git/qwibitai/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/inbound.db
~/git/qwibitai/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/outbound.db
```

4. confirm MultiBaas state from the host with the repo-local CLI or `dist/multibaas.js` helpers
