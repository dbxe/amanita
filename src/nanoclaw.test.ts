import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureNanoClawGroup, containerInstructions, deriveContainerBaseUrl } from "./nanoclaw.js";

test("deriveContainerBaseUrl rewrites localhost for container access", () => {
  assert.equal(deriveContainerBaseUrl("http://localhost:8080"), "http://host.docker.internal:8080");
  assert.equal(deriveContainerBaseUrl("http://127.0.0.1:9000/api"), "http://host.docker.internal:9000/api");
});

test("deriveContainerBaseUrl preserves non-local hosts", () => {
  assert.equal(deriveContainerBaseUrl("https://example.multibaas.com"), "https://example.multibaas.com");
});

test("containerInstructions steer NanoClaw away from saved queries for ERC-20 holder requests", () => {
  const instructions = containerInstructions();

  assert.match(instructions, /investigate_contract_address/i);
  assert.match(instructions, /Mandatory routing.*KelpDAO.*analyze_arbitrum_governance_incident.*Do not answer those prompts from memory/i);
  assert.match(instructions, /list_configured_backends/i);
  assert.match(instructions, /inspect_targets_across_backends/i);
  assert.match(instructions, /broad Arbitrum DAO questions.*`inspect_arbitrum_dao` first/i);
  assert.match(instructions, /KelpDAO \/ rsETH frozen-ETH governance incident demo.*`analyze_arbitrum_governance_incident`/i);
  assert.match(instructions, /Treat the incident tools as evidence sources, not scripts to recite/i);
  assert.match(instructions, /`send_message` is available.*must use a two-step cadence.*one short progress message/i);
  assert.match(instructions, /Use at most one progress message per user turn/i);
  assert.match(instructions, /progress message only counts.*NanoClaw `send_message` tool/i);
  assert.match(instructions, /Do not output only the progress note as your final answer/i);
  assert.match(instructions, /frozen-funds incident brief.*focus `brief`/i);
  assert.match(instructions, /emergency governance response.*live event data.*focus `verify-freeze`/i);
  assert.match(instructions, /release proposal has reached onchain governance.*focus `proposal-status`/i);
  assert.match(instructions, /proposal-status questions.*answer only the current onchain status/i);
  assert.match(instructions, /Do not set up, promise, imply, or mention a monitor/i);
  assert.match(instructions, /notified when the release proposal reaches onchain governance.*focus `monitor`/i);
  assert.match(instructions, /fenced `event_query` block.*cited process/i);
  assert.match(instructions, /Every final answer based on an incident tool must include the fenced `event_query` block/i);
  assert.match(instructions, /do not answer as though the specific freeze transaction itself was directly verified/i);
  assert.match(instructions, /do not copy the whole tool output/i);
  assert.match(instructions, /Lead with your conclusion.*most relevant event rows.*next onchain signal/i);
  assert.match(instructions, /names a specific non-default chain.*inspect_targets_across_backends/i);
  assert.match(instructions, /mentions both Ethereum and Arbitrum.*inspect_targets_across_backends/i);
  assert.match(instructions, /broad Arbitrum DAO or cross-chain governance questions.*configured backend set.*explicit contract targets/i);
  assert.match(instructions, /authority split, treasury structure, proposal consequences, delegate power, or queued governance risks.*`inspect_arbitrum_dao`/i);
  assert.match(instructions, /do not invent or guess additional addresses/i);
  assert.match(instructions, /partially grounded by current backend coverage.*confirmed subset.*still syncing or missing/i);
  assert.match(instructions, /repeated address investigation is not converging.*return the partial result with uncertainty/i);
  assert.match(instructions, /resolve_contract_target/i);
  assert.match(instructions, /lookup_contract_candidates/i);
  assert.match(instructions, /import_contract_lookup_candidate/i);
  assert.match(instructions, /inspect_contract_interfaces/i);
  assert.match(instructions, /get_token_metadata/i);
  assert.match(instructions, /inspect_event_capabilities/i);
  assert.match(instructions, /run_event_investigation/i);
  assert.match(instructions, /what kinds of investigations are possible for a contract.*inspect_event_capabilities` only/i);
  assert.match(instructions, /enumerate only the lead ids explicitly returned by `inspect_event_capabilities`/i);
  assert.match(instructions, /get_token_control_events/i);
  assert.match(instructions, /investigate_token/i);
  assert.match(instructions, /do not ask the user for a saved query name/i);
  assert.match(instructions, /raw address whose ABI or contract family is not already established.*investigate_contract_address/i);
  assert.match(instructions, /question itself identifies chain context that differs from your default backend/i);
  assert.match(instructions, /do not assume a raw address is an ERC-20/i);
  assert.match(instructions, /only use ERC-20-specific tools.*after lookup or linked-interface evidence/i);
  assert.match(instructions, /if the user asks for decimals.*already known to be ERC-20-compatible.*get_token_metadata/i);
  assert.match(instructions, /do not classify an address as an EOA/i);
  assert.match(instructions, /if a user asks about holders, concentration, or metadata for a raw address.*identify the contract surface first/i);
  assert.match(instructions, /what a contract does.*event history.*event surface first/i);
  assert.match(instructions, /prefer `inspect_event_capabilities` before `run_event_investigation`/i);
  assert.match(instructions, /get_top_holders.*contractAddress.*tokenName/i);
  assert.match(instructions, /do not infer total supply, concentration, or percentages unless you separately call `get_holder_concentration` or `get_token_metadata`/i);
  assert.match(instructions, /get_address_balance.*contractAddress.*tokenName/i);
  assert.match(instructions, /get_holder_concentration.*contractAddress.*tokenName/i);
  assert.match(instructions, /create_balance_watch.*contractAddress.*tokenName/i);
  assert.match(instructions, /contract-interface coverage questions.*inspect_contract_interfaces/i);
  assert.match(instructions, /use `ensure_contract_interface` only for explicit manual linking requests/i);
  assert.match(instructions, /do not use `ensure_contract_interface` as the default onboarding path/i);
  assert.match(instructions, /live address.*not yet known.*proxy.*investigate_contract_address.*identify candidates.*import the clear best candidate.*report readiness/i);
  assert.match(instructions, /if contract lookup returns a clear best candidate, import it and continue without asking the user to approve/i);
  assert.match(instructions, /if contract lookup does not return a credible candidate, ask the user for clarification/i);
  assert.match(instructions, /blacklist, pause, ownership, role, or upgrade-history questions.*get_token_control_events/i);
  assert.match(instructions, /broader token investigation requests.*investigate_token/i);
  assert.match(instructions, /evaluate_tasks/i);
  assert.match(instructions, /do not reply with narration like .*calling the tool now/i);
  assert.match(instructions, /if a balance question includes only one address.*treat that address as the holder or wallet by default.*ask which token/i);
  assert.match(instructions, /do not cite Etherscan or other external sources/i);
  assert.match(instructions, /Prefer event-query-backed tools when the user's question is about historical control changes/i);
  assert.match(instructions, /Uniswap pools, Aave pools, and stablecoin issuer proxies.*event-surface inspection/i);
  assert.match(instructions, /API path remains `\/chains\/ethereum\/\.\.\.` even for non-mainnet EVM deployments/i);
  assert.doesNotMatch(instructions, /default saved query/i);
});

test("configureNanoClawGroup writes a relative mount and workspace/extra MCP path", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-nanoclaw-"));
  const repoDir = path.join(tempDir, "repo");
  const nanoclawDir = path.join(tempDir, "nanoclaw");
  const groupFolder = "cli-with-test";
  const containerConfigPath = path.join(nanoclawDir, "groups", groupFolder, "container.json");

  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.dirname(containerConfigPath), { recursive: true });

  const previousBaseUrl = process.env.MULTIBAAS_BASE_URL;
  const previousApiKey = process.env.MULTIBAAS_API_KEY;
  const previousBackendsJson = process.env.MULTIBAAS_BACKENDS_JSON;
  const previousProfile = process.env.MULTIBAAS_PROFILE;
  process.env.MULTIBAAS_BACKENDS_JSON = JSON.stringify({
    defaultProfile: "development",
    profiles: {
      development: {
        baseUrl: "http://localhost:8080",
        hardhatNetwork: "development",
        stateDir: ".agent-state/development",
      },
      "mainnet-remote": {
        baseUrl: "https://mainnet.example.multibaas.com",
        chainId: 1,
        chainName: "Ethereum Mainnet",
        hardhatNetwork: "ethereum-mainnet",
        stateDir: ".agent-state/mainnet-remote",
      },
      "arbitrum-one-remote": {
        baseUrl: "https://arb.example.multibaas.com",
        chainId: 42161,
        chainName: "Arbitrum One",
        hardhatNetwork: "arbitrum-one",
        stateDir: ".agent-state/arbitrum-one-remote",
      },
    },
  });
  delete process.env.MULTIBAAS_BASE_URL;
  delete process.env.MULTIBAAS_API_KEY;
  delete process.env.MULTIBAAS_PROFILE;

  try {
    const result = configureNanoClawGroup({
      groupFolder,
      nanoclawDir,
      repoDir,
      writeAllowlist: false,
    });

    assert.equal(result.mountPath, "/workspace/extra/multibaas-runtime");

    const containerConfig = JSON.parse(fs.readFileSync(containerConfigPath, "utf8")) as {
      additionalMounts: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>;
      mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string>; instructions?: string }>;
    };

    assert.deepEqual(containerConfig.additionalMounts, [
      {
        hostPath: fs.realpathSync(repoDir),
        containerPath: "multibaas-runtime",
        readonly: true,
      },
    ]);

    assert.equal(containerConfig.mcpServers["multibaas-runtime"].command, "node");
    assert.equal(
      containerConfig.mcpServers["multibaas-runtime"].args?.[0],
      "/workspace/extra/multibaas-runtime/dist/mcp.js",
    );
    assert.equal(containerConfig.mcpServers["multibaas-runtime"].env?.MULTIBAAS_PROFILE, "mainnet-remote");
    assert.ok(containerConfig.mcpServers["multibaas-runtime"].env?.MULTIBAAS_BACKENDS_JSON);
    const backendJson = JSON.parse(containerConfig.mcpServers["multibaas-runtime"].env?.MULTIBAAS_BACKENDS_JSON ?? "{}");
    assert.equal(backendJson.defaultProfile, "mainnet-remote");
    assert.equal(backendJson.profiles.development, undefined);
    assert.equal(
      backendJson.profiles["mainnet-remote"].stateDir,
      "/workspace/agent/.agent-state/mainnet-remote",
    );
    assert.match(containerConfig.mcpServers["multibaas-runtime"].instructions ?? "", /do not ask the user for a saved query name/i);
  } finally {
    if (previousBackendsJson === undefined) {
      delete process.env.MULTIBAAS_BACKENDS_JSON;
    } else {
      process.env.MULTIBAAS_BACKENDS_JSON = previousBackendsJson;
    }

    if (previousProfile === undefined) {
      delete process.env.MULTIBAAS_PROFILE;
    } else {
      process.env.MULTIBAAS_PROFILE = previousProfile;
    }

    if (previousBaseUrl === undefined) {
      delete process.env.MULTIBAAS_BASE_URL;
    } else {
      process.env.MULTIBAAS_BASE_URL = previousBaseUrl;
    }

    if (previousApiKey === undefined) {
      delete process.env.MULTIBAAS_API_KEY;
    } else {
      process.env.MULTIBAAS_API_KEY = previousApiKey;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("configureNanoClawGroup prunes the legacy multibaas-agent server and mount", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-nanoclaw-legacy-"));
  const repoDir = path.join(tempDir, "repo");
  const nanoclawDir = path.join(tempDir, "nanoclaw");
  const groupFolder = "cli-with-test";
  const containerConfigPath = path.join(nanoclawDir, "groups", groupFolder, "container.json");

  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(path.dirname(containerConfigPath), { recursive: true });
  fs.writeFileSync(
    containerConfigPath,
    JSON.stringify(
      {
        additionalMounts: [
          {
            hostPath: fs.realpathSync(repoDir),
            containerPath: "multibaas-agent-harness",
            readonly: true,
          },
        ],
        mcpServers: {
          "multibaas-agent": {
            command: "node",
            args: ["/workspace/extra/multibaas-agent-harness/dist/mcp.js"],
          },
        },
      },
      null,
      2,
    ),
  );

  const previousBaseUrl = process.env.MULTIBAAS_BASE_URL;
  const previousApiKey = process.env.MULTIBAAS_API_KEY;
  const previousBackendsJson = process.env.MULTIBAAS_BACKENDS_JSON;
  const previousProfile = process.env.MULTIBAAS_PROFILE;

  process.env.MULTIBAAS_BACKENDS_JSON = JSON.stringify({
    defaultProfile: "mainnet-remote",
    profiles: {
      "mainnet-remote": {
        baseUrl: "https://mainnet.example.multibaas.com",
        chainId: 1,
        chainName: "Ethereum Mainnet",
        hardhatNetwork: "ethereum-mainnet",
        stateDir: ".agent-state/mainnet-remote",
      },
    },
  });
  delete process.env.MULTIBAAS_BASE_URL;
  delete process.env.MULTIBAAS_API_KEY;
  delete process.env.MULTIBAAS_PROFILE;

  try {
    configureNanoClawGroup({
      groupFolder,
      nanoclawDir,
      repoDir,
      writeAllowlist: false,
    });

    const containerConfig = JSON.parse(fs.readFileSync(containerConfigPath, "utf8")) as {
      additionalMounts: Array<{ containerPath: string }>;
      mcpServers: Record<string, unknown>;
    };

    assert.equal(containerConfig.mcpServers["multibaas-agent"], undefined);
    assert.equal(
      containerConfig.additionalMounts.some((mount) => mount.containerPath === "multibaas-agent-harness"),
      false,
    );
  } finally {
    if (previousBackendsJson === undefined) {
      delete process.env.MULTIBAAS_BACKENDS_JSON;
    } else {
      process.env.MULTIBAAS_BACKENDS_JSON = previousBackendsJson;
    }

    if (previousProfile === undefined) {
      delete process.env.MULTIBAAS_PROFILE;
    } else {
      process.env.MULTIBAAS_PROFILE = previousProfile;
    }

    if (previousBaseUrl === undefined) {
      delete process.env.MULTIBAAS_BASE_URL;
    } else {
      process.env.MULTIBAAS_BASE_URL = previousBaseUrl;
    }

    if (previousApiKey === undefined) {
      delete process.env.MULTIBAAS_API_KEY;
    } else {
      process.env.MULTIBAAS_API_KEY = previousApiKey;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
