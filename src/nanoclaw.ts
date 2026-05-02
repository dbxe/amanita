import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { listConfiguredBackends, readConfiguredBackendProfiles, resolveConfig } from "./config.js";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  instructions?: string;
}

interface AdditionalMountConfig {
  hostPath: string;
  containerPath: string;
  readonly?: boolean;
}

interface ContainerConfig {
  mcpServers?: Record<string, McpServerConfig>;
  packages?: {
    apt?: string[];
    npm?: string[];
  };
  additionalMounts?: AdditionalMountConfig[];
  skills?: string[] | "all";
  provider?: string;
  groupName?: string;
  assistantName?: string;
  agentGroupId?: string;
  maxMessagesPerPrompt?: number;
}

interface AllowedRoot {
  path: string;
  allowReadWrite: boolean;
  description?: string;
}

interface MountAllowlist {
  allowedRoots: AllowedRoot[];
  blockedPatterns: string[];
}

export interface ConfigureNanoClawOptions {
  groupFolder: string;
  nanoclawDir: string;
  repoDir?: string;
  writeAllowlist?: boolean;
}

export interface ConfigureNanoClawResult {
  allowlistPath?: string;
  containerBaseUrl: string;
  containerConfigPath: string;
  mountPath: string;
  serverName: string;
}

const SERVER_NAME = "multibaas-runtime";
const CONTAINER_MOUNT_NAME = "multibaas-runtime";
const LEGACY_SERVER_NAME = "multibaas-agent";
const LEGACY_CONTAINER_MOUNT_NAME = "multibaas-agent-harness";
const EXTRA_MOUNTS_BASE = "/workspace/extra";

function mountPathFor(containerPath: string): string {
  return `${EXTRA_MOUNTS_BASE}/${containerPath}`;
}

export function containerInstructions(): string {
  return [
    "Use this MCP server for MultiBaas event-query and watch tasks.",
    "- Prefer typed capability tools over any workflow-specific or prompt-matched fallback behavior.",
    "- Use `list_configured_backends` when you need to understand which MultiBaas deployments are available to you.",
    "- Use `inspect_targets_across_backends` when the user asks for multichain context, bridge-side comparison, or the status of explicit contracts across more than one configured backend.",
    "- For broad Arbitrum DAO questions, use `inspect_arbitrum_dao` first. It already knows the bounded target set, the current sync posture, and which DAO questions are grounded now versus still premature.",
    "- For the KelpDAO / rsETH frozen-ETH governance incident demo, use `analyze_arbitrum_governance_incident` rather than composing raw event-query JSON yourself.",
    "- If the user names a specific non-default chain, or names a multichain entity like Arbitrum DAO while asking about a raw address, do not default to a single-backend address investigation. Use `inspect_targets_across_backends` against the relevant backend profiles first.",
    "- If the user mentions both Ethereum and Arbitrum, or asks for governance health across those chains, start with `inspect_targets_across_backends` or `list_configured_backends` before any single-backend tool.",
    "- For broad Arbitrum DAO or cross-chain governance questions, start from the configured backend set and the explicit contract targets you can already inspect. Do not invent or guess additional addresses just to make the story feel complete.",
    "- If the user asks about Arbitrum DAO authority split, treasury structure, proposal consequences, delegate power, or queued governance risks, use the matching `inspect_arbitrum_dao` focus before doing any narrower follow-up calls.",
    "- If a broad DAO question is only partially grounded by current backend coverage, answer with the confirmed subset, name what is still syncing or missing, and stop there instead of expanding into exploratory address hunting.",
    "- If repeated address investigation is not converging on a grounded answer, stop and return the partial result with uncertainty instead of continuing the loop.",
    "- Use `investigate_contract_address` for a raw contract address when the user wants to know what it is, whether it is proxied, or whether MultiBaas is linked/syncing yet.",
    "- Use `lookup_contract_candidates` when you need verified ABI candidates for a live contract address before linking or importing it.",
    "- Use `import_contract_lookup_candidate` to import a selected contract-lookup candidate's ABI and link it to the searched address.",
    "- Use `inspect_contract_interfaces` when you need to understand which preloaded interfaces are available or already linked for a contract.",
    "- Use `resolve_contract_target` when you need to turn a token name or contract address into a concrete target plus readiness state.",
    "- Use `get_token_metadata` for ERC-20 metadata questions such as name, symbol, decimals, or total supply.",
    "- Use `inspect_event_capabilities` to inspect a linked or looked-up ABI surface, detect event families, and discover which bounded event-backed investigations are appropriate.",
    "- Use `run_event_investigation` after `inspect_event_capabilities` when the user is asking for protocol activity, issuer activity, LP concentration, recent flow events, liquidator behavior, or other event-ledger intelligence.",
    "- When a user asks what kinds of investigations are possible for a contract, answer from `inspect_event_capabilities` only. Do not infer possible investigations from the preloaded-interface catalog or from missing interface labels.",
    "- When reporting available investigations, enumerate only the lead ids explicitly returned by `inspect_event_capabilities`. Do not add unsupported leads, even as examples or as 'not supported here' commentary.",
    "- Use `get_token_control_events` for blacklist, pause, upgrade, ownership, or role-history questions when the answer depends on emitted events rather than only current contract state.",
    "- Use `investigate_token` when the user asks for a broader token analysis, investigation, or summary.",
    "- For a raw address whose ABI or contract family is not already established, your first action should usually be `investigate_contract_address`; if you need more control, start with `lookup_contract_candidates`.",
    "- The exception is when the question itself identifies chain context that differs from your default backend. In that case, inspect the relevant backend or backends first rather than assuming the current default profile is correct.",
    "- Do not assume a raw address is an ERC-20 just because the user asked a token-like question.",
    "- Only use ERC-20-specific tools such as `get_token_metadata`, `get_top_holders`, `get_holder_concentration`, `get_address_balance`, `create_balance_watch`, or `investigate_token` after lookup or linked-interface evidence shows an ERC-20-compatible surface.",
    "- If the user asks for decimals, symbol, name, or total supply and provides a contract address that is already known to be ERC-20-compatible, use `get_token_metadata` for that exact address.",
    "- Do not classify an address as an EOA or as a non-token without first checking `lookup_contract_candidates`, `inspect_contract_interfaces`, or `resolve_contract_target`.",
    "- If a user asks about holders, concentration, or metadata for a raw address, identify the contract surface first through `lookup_contract_candidates` or linked-interface inspection before answering.",
    "- If a user asks what a contract does, what can be learned from its event history, or asks for non-token protocol intelligence, inspect the event surface first instead of jumping to an ERC-20 tool.",
    "- Prefer `inspect_event_capabilities` before `run_event_investigation`; the point is to choose an event-backed path that fits the discovered ABI surface, not to blindly force a canned lead.",
    "- For ERC-20 top-holder requests, call `get_top_holders` with either `contractAddress` or `tokenName`.",
    "- For explicit balance lookups, call `get_address_balance` with either `contractAddress` or `tokenName`.",
    "- For explicit holder-concentration requests, call `get_holder_concentration` with either `contractAddress` or `tokenName`.",
    "- For explicit balance-watch requests, call `create_balance_watch` with either `contractAddress` or `tokenName`.",
    "- For contract-interface coverage questions, use `inspect_contract_interfaces`.",
    "- Use `ensure_contract_interface` only for explicit manual linking requests when the user or operator has already decided which preloaded interface label to attach.",
    "- Do not use `ensure_contract_interface` as the default onboarding path for a raw live address when contract lookup has a richer verified candidate.",
    "- For a live address that is not yet known to MultiBaas and may be a proxy, prefer `investigate_contract_address`; it should identify candidates, import the clear best candidate, and then report readiness.",
    "- If contract lookup returns a clear best candidate, import it and continue without asking the user to approve the import step.",
    "- If contract lookup does not return a credible candidate, ask the user for clarification instead of forcing an ERC-20 path.",
    "- For blacklist, pause, ownership, role, or upgrade-history questions, use `get_token_control_events`.",
    "- For broader token investigation requests, call `investigate_token` with either `contractAddress` or `tokenName`.",
    "- For a top-holder request that already includes a contract address or a known token name, your first action should be the `get_top_holders` tool call.",
    "- If `get_top_holders` returns only a holder list, do not infer total supply, concentration, or percentages unless you separately call `get_holder_concentration` or `get_token_metadata`.",
    "- Do not ask the user for a saved query name for ERC-20 holder requests.",
    "- Do not assume a default token, contract alias, or saved query when the user asks for a balance, concentration, or watch.",
    "- If a user gives only an address and says 'top balances' or 'top holders', clarify whether that address is an ERC-20 token contract before calling a tool.",
    "- If a token name does not resolve, ask the user for the token contract address.",
    "- If `get_top_holders` reports that onboarding or syncing is still in progress, tell the user you will follow up once it is ready.",
    "- When the user asks to check progress on waiting holder tasks, call `evaluate_tasks`.",
    "- Do not reply with narration like 'I am calling the tool now' or 'Getting holders now'. Call the tool and answer from the result instead.",
    "- For one-address balance requests, use `get_address_balance` when the token contract address is explicit. If the token target is missing, ask for it instead of guessing.",
    "- If a balance question includes only one address and no explicit token target, treat that address as the holder or wallet by default and ask which token the user means.",
    "- For 'alert me if this balance moves' requests, use `create_balance_watch` when the token contract address is explicit. If the token target is missing, ask for it instead of guessing.",
    "- When asked what is currently being tracked, call `list_balance_watches`.",
    "- Never guess balances, holder rankings, contract type, or token metadata without calling a tool.",
    "- Prefer event-query-backed tools when the user's question is about historical control changes, holder reconstruction, or other state that is not enumerable from current storage reads alone.",
    "- For contracts like Uniswap pools, Aave pools, and stablecoin issuer proxies, use event-surface inspection to decide whether recent activity, LP/liquidator concentration, control history, or issuer activity is the right investigation.",
    "- MultiBaas selects the chain at the deployment level. The API path remains `/chains/ethereum/...` even for non-mainnet EVM deployments, so do not treat that path string as proof that the backend is Ethereum mainnet.",
    "- Do not cite Etherscan or other external sources for these questions when the MCP tools can answer them.",
  ].join("\n");
}

function parseJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function deriveContainerBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    url.hostname = "host.docker.internal";
  }
  return url.toString().replace(/\/$/, "");
}

function upsertMount(mounts: AdditionalMountConfig[], mount: AdditionalMountConfig): AdditionalMountConfig[] {
  const existingIndex = mounts.findIndex((candidate) => candidate.containerPath === mount.containerPath);
  if (existingIndex === -1) {
    return [...mounts, mount];
  }

  return mounts.map((candidate, index) => (index === existingIndex ? mount : candidate));
}

function removeMount(mounts: AdditionalMountConfig[], containerPath: string): AdditionalMountConfig[] {
  return mounts.filter((candidate) => candidate.containerPath !== containerPath);
}

function preferredNanoClawProfileName(): string {
  const configured = listConfiguredBackends();
  const current = resolveConfig().profileName;

  if (current !== "development") {
    return current;
  }

  const mainnet = configured.find((backend) => backend.profileName === "mainnet-remote");
  if (mainnet) {
    return mainnet.profileName;
  }

  const firstNonDevelopment = configured.find((backend) => backend.profileName !== "development");
  if (firstNonDevelopment) {
    return firstNonDevelopment.profileName;
  }

  return current;
}

function containerBackendProfilesJson(): string | undefined {
  const configured = readConfiguredBackendProfiles();
  if (!configured.profiles || Object.keys(configured.profiles).length === 0) {
    return undefined;
  }

  const remoteProfiles = Object.entries(configured.profiles).filter(([profileName]) => profileName !== "development");
  if (remoteProfiles.length === 0) {
    return undefined;
  }

  const sanitizedProfiles = Object.fromEntries(
    remoteProfiles.map(([profileName, profile]) => {
      const baseUrl = profile.baseUrl ? deriveContainerBaseUrl(profile.baseUrl) : undefined;
      return [profileName, {
        baseUrl,
        chainId: profile.chainId,
        chainName: profile.chainName,
        hardhatNetwork: profile.hardhatNetwork,
        inactive: profile.inactive,
        note: profile.note,
        stateDir: `/workspace/agent/.agent-state/${profileName}`,
      }];
    }),
  );

  return JSON.stringify({
    defaultProfile: preferredNanoClawProfileName(),
    profiles: sanitizedProfiles,
  });
}

function ensureAllowlist(repoDir: string): string {
  const allowlistPath = path.join(os.homedir(), ".config", "nanoclaw", "mount-allowlist.json");
  const allowlist = parseJsonFile<MountAllowlist>(allowlistPath, {
    allowedRoots: [],
    blockedPatterns: [],
  });

  const realRepoDir = fs.realpathSync(repoDir);
  const alreadyAllowed = allowlist.allowedRoots.some((root) => {
    const realRoot = fs.existsSync(root.path) ? fs.realpathSync(root.path) : path.resolve(root.path.replace(/^~(?=\/|$)/, os.homedir()));
    const relative = path.relative(realRoot, realRepoDir);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  });

  if (!alreadyAllowed) {
    allowlist.allowedRoots.push({
      path: realRepoDir,
      allowReadWrite: false,
      description: "Mounted MultiBaas agent harness repo",
    });
    writeJsonFile(allowlistPath, allowlist);
  }

  return allowlistPath;
}

export function configureNanoClawGroup(options: ConfigureNanoClawOptions): ConfigureNanoClawResult {
  const repoDir = fs.realpathSync(options.repoDir ?? process.cwd());
  const config = resolveConfig();
  const containerBaseUrl = deriveContainerBaseUrl(config.baseUrl);
  const backendProfilesJson = containerBackendProfilesJson();
  const containerConfigPath = path.join(options.nanoclawDir, "groups", options.groupFolder, "container.json");
  const containerConfig = parseJsonFile<ContainerConfig>(containerConfigPath, {
    mcpServers: {},
    packages: { apt: [], npm: [] },
    additionalMounts: [],
    skills: "all",
  });

  containerConfig.mcpServers = containerConfig.mcpServers ?? {};
  containerConfig.additionalMounts = containerConfig.additionalMounts ?? [];
  containerConfig.packages = containerConfig.packages ?? { apt: [], npm: [] };
  delete containerConfig.mcpServers[LEGACY_SERVER_NAME];

  containerConfig.mcpServers[SERVER_NAME] = {
    command: "node",
    args: [`${mountPathFor(CONTAINER_MOUNT_NAME)}/dist/mcp.js`],
    env: {
      ...(backendProfilesJson ? {
        MULTIBAAS_BACKENDS_JSON: backendProfilesJson,
        MULTIBAAS_PROFILE: preferredNanoClawProfileName(),
      } : {
        MULTIBAAS_BASE_URL: containerBaseUrl,
        MULTIBAAS_AGENT_STATE_DIR: "/workspace/agent/.agent-state",
      }),
    },
    instructions: containerInstructions(),
  };

  containerConfig.additionalMounts = upsertMount(containerConfig.additionalMounts, {
    hostPath: repoDir,
    containerPath: CONTAINER_MOUNT_NAME,
    readonly: true,
  });
  containerConfig.additionalMounts = removeMount(containerConfig.additionalMounts, LEGACY_CONTAINER_MOUNT_NAME);

  writeJsonFile(containerConfigPath, containerConfig);

  return {
    allowlistPath: options.writeAllowlist ? ensureAllowlist(repoDir) : undefined,
    containerBaseUrl,
    containerConfigPath,
    mountPath: mountPathFor(CONTAINER_MOUNT_NAME),
    serverName: SERVER_NAME,
  };
}
