import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveConfig } from "./config.js";

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

const SERVER_NAME = "multibaas-agent";
const CONTAINER_MOUNT_NAME = "multibaas-agent-harness";
const EXTRA_MOUNTS_BASE = "/workspace/extra";

function mountPathFor(containerPath: string): string {
  return `${EXTRA_MOUNTS_BASE}/${containerPath}`;
}

export function containerInstructions(_defaultQueryName: string): string {
  return [
    "Use this MCP server for MultiBaas event-query and watch tasks.",
    "- Prefer the high-level `handle_multibaas_request` tool for user requests about balances, holders, concentration, watches, or task progress.",
    "- Pass the user's raw message to `handle_multibaas_request` unless you have a strong reason to call a lower-level tool directly.",
    "- For ERC-20 top-holder requests, call `get_top_holders` with either `contractAddress` or `tokenName`.",
    "- For a top-holder request that already includes a contract address or a known token name, your first action should be the `get_top_holders` tool call.",
    "- Do not ask the user for a saved query name for ERC-20 holder requests.",
    "- If a user gives only an address and says 'top balances' or 'top holders', clarify whether that address is an ERC-20 token contract before calling a tool.",
    "- If a token name does not resolve, ask the user for the token contract address.",
    "- If `get_top_holders` reports that onboarding or syncing is still in progress, tell the user you will follow up once it is ready.",
    "- When the user asks to check progress on waiting holder tasks, call `evaluate_tasks`.",
    "- Do not reply with narration like 'I am calling the tool now' or 'Getting holders now'. Call the tool and answer from the result instead.",
    "- For one-address balance requests, call `get_address_balance`.",
    "- For 'alert me if this balance moves' requests, call `create_balance_watch`.",
    "- When asked what is currently being tracked, call `list_balance_watches`.",
    "- Never guess balances or holder rankings without calling a tool.",
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

  containerConfig.mcpServers[SERVER_NAME] = {
    command: "node",
    args: [`${mountPathFor(CONTAINER_MOUNT_NAME)}/dist/mcp.js`],
    env: {
      MULTIBAAS_BASE_URL: containerBaseUrl,
      MULTIBAAS_QUERY_NAME: config.defaultQueryName,
      MULTIBAAS_AGENT_STATE_DIR: "/workspace/agent/.agent-state",
    },
    instructions: containerInstructions(config.defaultQueryName),
  };

  containerConfig.additionalMounts = upsertMount(containerConfig.additionalMounts, {
    hostPath: repoDir,
    containerPath: CONTAINER_MOUNT_NAME,
    readonly: true,
  });

  writeJsonFile(containerConfigPath, containerConfig);

  return {
    allowlistPath: options.writeAllowlist ? ensureAllowlist(repoDir) : undefined,
    containerBaseUrl,
    containerConfigPath,
    mountPath: mountPathFor(CONTAINER_MOUNT_NAME),
    serverName: SERVER_NAME,
  };
}
