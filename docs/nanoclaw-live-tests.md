# NanoClaw live integration tests

This runbook is the reusable registry for **live NanoClaw + amanita + MultiBaas** tests. Keep it concrete and executable: each test should say what to prepare, what prompt to send, what to verify, and what host-side capabilities the coding agent needs.

Run these tests **sequentially**. Do not overlap live NanoClaw chat requests.

If you overlap CLI probes, NanoClaw can supersede the earlier client and the result is not trustworthy.

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
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
  --group-folder cli-with-<name> \
  --write-allowlist
npm run dev -- nanoclaw configure \
  --nanoclaw-dir ~/git/dbxe/nanoclaw \
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

If the next message still resumes stale state, clear the exact session as well:

```bash
sqlite3 ~/git/dbxe/nanoclaw/data/v2.db \
  "delete from pending_questions where session_id = '<session-id>';
   delete from sessions where id = '<session-id>';"

mv ~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id> \
   ~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>.bak-$(date +%Y%m%dT%H%M%S)
```

Use exact session cleanup when a restarted NanoClaw host still routes the next probe into preserved continuation or pending-question state.

CLI success does **not** prove Discord or DM success. Those channels may resume an older session with preserved continuation or pending-question state, so rerun the exact affected channel before calling a live issue fixed.

## How to judge a live pass

Judge a live NanoClaw run by capability correctness, not exact wording.

Prompts should be phrased like normal user requests. Do not bake internal tool names or implementation steps into the live prompt unless you are explicitly testing whether the agent can explain or expose those internals.

A pass means:

- the model used the mounted tool surface successfully
- the answer is grounded in the right target and the right numbers
- missing-target cases ask for the missing token target instead of guessing
- onboarding/waiting cases surface an explicit waiting state instead of inventing success

Do not fail a run just because the phrasing changed. Do fail it if the answer:

- invents values
- cites external sources instead of the tool path
- asks for a saved query name on an explicit contract-targeted request
- only succeeds because the prompt told it exactly which internal tool to call
- resumes stale session state and answers from the wrong context

## After CLI passes, how to reconfirm on Discord or DM

Use CLI as the development lane, then do this before asking the user to recheck the same behavior in Discord or DM:

1. if mounted harness code changed, run `npm test` so `dist/` is current
2. if `src/nanoclaw.ts` or generated `container.json` behavior changed, rerun `nanoclaw configure` for the target group
3. stop the exact target-channel container so the next inbound message gets a fresh container and fresh MCP/session state
4. resend the same prompt in the target channel

Concrete reset:

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}'
docker stop <exact-container-name>
```

For this repo's normal developer flow, CLI validation can happen first, but Discord reconfirm should usually include an exact-container reset for `dm-with-<name>` so a stale long-lived session does not mask the new behavior.

## Handoff checklist

Do not hand off a NanoClaw change as "working" without writing down:

1. the exact group folder and channel that were rerun
2. the exact prompt or prompts used
3. whether the test used a full NanoClaw restart or an exact-container reset
4. which live channels were **not** rerun yet
5. whether exact-session cleanup was required to get a fresh result

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
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Who are the 7 biggest holders of 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59?"
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
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Who are the 7 biggest holders of helloworld?"
```

**Expected live behavior**

- resolves `helloworld` to `0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59`
- returns the same holder set as test 1

### 3. Linked ERC-20 by contract name

**Goal:** the model can resolve a token by linked contract name, not only alias.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Who are the 7 biggest holders of Hello World Token?"
```

**Expected live behavior**

- resolves to the same `helloworld` contract
- returns the same holder set as test 1

### 4. Unknown token name asks for address

**Goal:** unresolved names should prompt for a contract address instead of guessing.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Who owns most of mysterytoken?"
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
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Who are the 10 biggest holders of <unlinked-contract-address>?"
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

### 6. Investigation by explicit token address

**Goal:** the model can perform a broader, grounded token investigation through the typed MCP capability surface instead of falling back to free-form summary text.

**Preconditions**

- `helloworld` is linked in MultiBaas at `0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59`
- run the standard preflight above
- clear the active CLI session first if you already used the same group for earlier prompts

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Give me a quick investigation of 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59. What stands out?"
```

**Expected live behavior**

- returns token metadata grounded in tool results
- returns readiness state
- returns top-holder concentration and top holders
- does not cite external sources
- does not invent values that are not derivable from metadata plus analytical reads

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
npm run dev -- query investigate --contract 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 --limit 5
```

**Notes / known failure modes**

- if the prompt lands in a stale CLI session, the reply may blend earlier context instead of running a fresh tool sequence
- for clean regression checks, clear the CLI session and rerun this probe from a fresh session

You should see an alias and an `erc20interface` link after onboarding.

You can also inspect persisted holder-query task state:

```bash
cd ~/git/dbxe/amanita
npm run dev -- task list
```

## Phase 02 live coverage

These cases have now been rerun successfully on the CLI path and should remain in the maintained regression set. They reflect the current product direction toward typed capability composition.

### A. Explicit-token metadata read

**Goal:** the model answers ERC-20 metadata questions through typed tool use rather than inference.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "How many decimals does 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 use?"
```

**Expected live behavior**

- returns a concrete decimals value from a tool-backed metadata read
- does not answer by inference from holder balances

**Validation note**

- confirmed on CLI with a fresh NanoClaw session

### B. Explicit-token balance lookup

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "How much of 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 does 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 hold?"
```

**Expected live behavior**

- returns the balance for that address and token
- does not ask for a saved query name
- does not guess a different token target

**Validation note**

- confirmed on CLI with a fresh NanoClaw session

### C. Explicit-token concentration lookup

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "How concentrated is ownership of 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 among the top 5 holders?"
```

**Expected live behavior**

- returns concentration for the explicit token target
- does not infer a default token

**Validation note**

- confirmed on CLI with a fresh NanoClaw session
- evaluate the numeric result, not only the prose summary; the underlying runtime output for this fixture is `15.60% (1560 bps)`

### D. Explicit-token watch creation

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Let me know if 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172's balance of 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 changes."
```

**Expected live behavior**

- creates or resumes a watch for that explicit token target
- `List watches` shows the watch afterward

**Validation note**

- confirmed on CLI with a fresh NanoClaw session

### E. No implicit token guessing for balance

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "How much does 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 hold?"
```

**Expected live behavior**

- asks for the token contract address
- does not infer `helloworld`
- does not ask for a saved query name

**Validation note**

- confirmed on CLI with a fresh NanoClaw session

### F. No implicit token guessing for watch creation

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Let me know if 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172's balance changes."
```

**Expected live behavior**

- asks for the token contract address
- does not create a watch on an implicit token source

**Validation note**

- confirmed on CLI with a fresh NanoClaw session

### G. Event-surface inspection on a linked local ERC-20

**Goal:** the model can inspect a contract's ABI/event surface and identify the supported bounded investigation leads without the user naming tools.

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Give me a quick investigation of 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59. What stands out about holder distribution?"
```

**Expected live behavior**

- identifies the contract as Hello World Token
- returns grounded holder-distribution analysis
- does not cite external sources
- does not ask for a saved query name

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
MULTIBAAS_PROFILE=development npm run dev -- query investigate --contract 0x65a4C093c7652AB882FbA1aed0F0E461cb50dF59 --limit 20
```

**Validation note**

- confirmed on CLI with a fresh NanoClaw session

**Known failure mode**

- a broader prompt like "What kinds of investigations are possible?" is still prone to overgeneralize unsupported leads in NanoClaw prose even though the host-side `query event-capabilities` output is correct. Treat that as an open instruction/response-shaping issue, not a closed regression.

### H. Mainnet JPYC issuer and control-history investigation

**Goal:** the model can use contract lookup, linked ABI surface, and event-backed investigations to answer a real mainnet stablecoin question.

**Preconditions**

- NanoClaw group configured against `MULTIBAAS_PROFILE=mainnet-remote`
- JPYC proxy `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` linked to `fiattokenv1`

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "What can you tell me about 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29? I care most about issuer activity and any meaningful control or upgrade history."
```

**Expected live behavior**

- identifies the contract as JPYC / FiatTokenV1 behind a proxy
- returns recent mint/burn activity with concrete actors and amounts
- returns meaningful control / upgrade events
- does not rely on Etherscan prose instead of the tool path

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query event-capabilities --contract 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query event-investigation --contract 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29 --lead stablecoin_issuer_activity --limit 10
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query event-investigation --contract 0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29 --lead token_control_timeline --limit 10
```

**Validation note**

- confirmed on CLI with a fresh NanoClaw session

### I. Mainnet Uniswap v3 waiting-state and lead discovery

**Goal:** the model chooses the event-capability path for a live protocol pool and reports a correct syncing state instead of inventing recent activity.

**Preconditions**

- NanoClaw group configured against `MULTIBAAS_PROFILE=mainnet-remote`
- Uniswap V3 USDC/WETH 0.05% pool `0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640` linked from a bounded recent starting block

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "What stands out about the recent event activity of 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640? If it's still syncing, tell me what analysis you'll be able to do once it's ready."
```

**Expected live behavior**

- identifies the address as the Uniswap V3 USDC/WETH pool
- reports `syncing` instead of inventing recent activity
- names the bounded investigations that will be available once ready, such as recent activity and net liquidity

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query event-capabilities --contract 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query event-investigation --contract 0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640 --lead uniswap_v3_recent_activity --limit 5
```

**Validation note**

- confirmed on CLI with a fresh NanoClaw session for the syncing/waiting-state path
- full recent-activity investigation remains pending until the bounded mainnet sync completes

### J. Mainnet Aave v3 waiting-state and lead discovery

**Goal:** the model chooses the event-capability path for a live lending pool and reports the correct waiting state plus supported investigations.

**Preconditions**

- NanoClaw group configured against `MULTIBAAS_PROFILE=mainnet-remote`
- Aave V3 Pool `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` linked from a bounded recent starting block

**Prompt**

```bash
cd ~/git/dbxe/nanoclaw
pnpm run chat -- "Take a look at 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2. I'm interested in borrower flow and liquidator behavior. If it's still syncing, tell me what you'll be able to analyze once it's ready."
```

**Expected live behavior**

- identifies the address as the Aave V3 Pool
- reports `syncing` instead of inventing borrower/liquidation results
- names the supported bounded investigations: net borrowers, top liquidators, recent activity

**Host-side verification**

```bash
cd ~/git/dbxe/amanita
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query event-capabilities --contract 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2
MULTIBAAS_PROFILE=mainnet-remote npm run dev -- query event-investigation --contract 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2 --lead aave_v3_recent_activity --limit 5
```

**Validation note**

- confirmed on CLI with a fresh NanoClaw session for the syncing/waiting-state path
- full borrower/liquidator investigation remains pending until the bounded mainnet sync completes

## Useful troubleshooting checks

If a live NanoClaw result looks wrong:

1. inspect the live group config:

```bash
cat ~/git/dbxe/nanoclaw/groups/cli-with-<name>/container.json
```

2. inspect live NanoClaw logs:

```bash
tail -n 120 ~/git/dbxe/nanoclaw/logs/nanoclaw.log
tail -n 120 ~/git/dbxe/nanoclaw/logs/nanoclaw.error.log
```

3. inspect session DB state for pending inbound rows or stale continuations:

```bash
~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/inbound.db
~/git/dbxe/nanoclaw/data/v2-sessions/<agent-group-id>/<session-id>/outbound.db
```

4. confirm MultiBaas state from the host with the repo-local CLI or `dist/multibaas.js` helpers

5. if CLI works but Discord or DM repeats an older question or tool prompt, treat that as a stale-session/channel-specific failure. Inspect the target session's `messages_out` and `session_state`, then stop the exact container for that channel before rerunning the same prompt there.
