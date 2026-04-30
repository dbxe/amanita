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

function containerInstructions(defaultQueryName: string): string {
  return [
    "Use this MCP server for MultiBaas event-query and watch tasks.",
    `The default saved query is \`${defaultQueryName}\`.`,
    "- For top-holder or current-holder requests, call `get_top_holders`.",
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
    command: "bun",
    args: ["run", `${mountPathFor(CONTAINER_MOUNT_NAME)}/src/mcp.ts`],
    env: {
      MULTIBAAS_BASE_URL: containerBaseUrl,
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
