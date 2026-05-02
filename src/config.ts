import fs from "node:fs";
import path from "node:path";

export interface RuntimeConfig {
  apiKey?: string;
  baseUrl: string;
  hardhatNetwork: string;
  profileName: string;
  scanLimit: number;
  stateDir: string;
}

interface BackendProfile {
  apiKey?: string;
  baseUrl?: string;
  chainId?: number;
  chainName?: string;
  hardhatNetwork?: string;
  stateDir?: string;
}

export interface BackendProfileConfig {
  defaultProfile?: string;
  profiles?: Record<string, BackendProfile>;
}

export interface ConfiguredBackendSummary {
  baseUrl?: string;
  chainId?: number;
  chainName?: string;
  hardhatNetwork: string;
  hasApiKey: boolean;
  profileName: string;
  stateDir: string;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseHardhatDeploymentConfig(networkName: string): Partial<Pick<RuntimeConfig, "apiKey" | "baseUrl">> {
  const configPath = path.resolve(
    process.cwd(),
    "hardhat",
    `deployment-config.${networkName}.ts`,
  );

  if (!fs.existsSync(configPath)) {
    return {};
  }

  const source = fs.readFileSync(configPath, "utf8");
  const endpointMatch = source.match(/deploymentEndpoint:\s*['"`]([^'"`]+)['"`]/);
  const apiKeyMatch = source.match(/adminApiKey:\s*['"`]([^'"`]+)['"`]/);

  return {
    apiKey: apiKeyMatch?.[1],
    baseUrl: endpointMatch?.[1],
  };
}

function readBackendProfileConfig(): BackendProfileConfig {
  const envJson = process.env.MULTIBAAS_BACKENDS_JSON?.trim();
  if (envJson) {
    return JSON.parse(envJson) as BackendProfileConfig;
  }

  const configPath = path.resolve(process.cwd(), ".multibaas", "backends.local.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(configPath, "utf8")) as BackendProfileConfig;
}

export function readConfiguredBackendProfiles(): BackendProfileConfig {
  return readBackendProfileConfig();
}

function selectedProfileName(backendProfiles: BackendProfileConfig): string {
  return process.env.MULTIBAAS_PROFILE
    ?? backendProfiles.defaultProfile
    ?? process.env.MULTIBAAS_NETWORK
    ?? process.env.HARDHAT_NETWORK
    ?? "development";
}

function resolveProfileConfig(
  backendProfiles: BackendProfileConfig,
  profileName: string,
  options?: { allowEnvOverrides?: boolean },
): RuntimeConfig {
  const selectedProfile = backendProfiles.profiles?.[profileName];
  const hardhatNetwork =
    process.env.MULTIBAAS_NETWORK
    ?? (options?.allowEnvOverrides !== false ? process.env.HARDHAT_NETWORK : undefined)
    ?? selectedProfile?.hardhatNetwork
    ?? profileName;
  const fallback = parseHardhatDeploymentConfig(hardhatNetwork);

  const baseUrl =
    (options?.allowEnvOverrides !== false ? process.env.MULTIBAAS_BASE_URL : undefined)
    ?? selectedProfile?.baseUrl
    ?? fallback.baseUrl;
  const apiKey =
    (options?.allowEnvOverrides !== false ? process.env.MULTIBAAS_API_KEY : undefined)
    ?? selectedProfile?.apiKey
    ?? fallback.apiKey;

  if (!baseUrl) {
    throw new Error(
      `Missing MultiBaas base URL for profile ${profileName}. Set MULTIBAAS_BASE_URL, choose a configured MULTIBAAS_PROFILE, or provide hardhat/deployment-config.<network>.ts.`,
    );
  }

  return {
    apiKey,
    baseUrl,
    hardhatNetwork,
    profileName,
    scanLimit: parsePositiveInteger(process.env.MULTIBAAS_QUERY_SCAN_LIMIT, 1000),
    stateDir: path.resolve(process.cwd(), process.env.MULTIBAAS_AGENT_STATE_DIR ?? selectedProfile?.stateDir ?? ".agent-state"),
  };
}

export function resolveConfig(): RuntimeConfig {
  const backendProfiles = readBackendProfileConfig();
  return resolveProfileConfig(backendProfiles, selectedProfileName(backendProfiles), { allowEnvOverrides: true });
}

export function resolveConfigForProfile(profileName: string): RuntimeConfig {
  return resolveProfileConfig(readBackendProfileConfig(), profileName, { allowEnvOverrides: false });
}

export function listConfiguredBackends(): ConfiguredBackendSummary[] {
  const backendProfiles = readBackendProfileConfig();
  const profileEntries = Object.keys(backendProfiles.profiles ?? {}).sort((left, right) => left.localeCompare(right));

  return profileEntries.map((profileName) => {
    const profile = backendProfiles.profiles?.[profileName];
    const hardhatNetwork = profile?.hardhatNetwork ?? profileName;
    const fallback = parseHardhatDeploymentConfig(hardhatNetwork);
    const stateDir = path.resolve(process.cwd(), profile?.stateDir ?? ".agent-state");

    return {
      baseUrl: profile?.baseUrl ?? fallback.baseUrl,
      chainId: profile?.chainId,
      chainName: profile?.chainName,
      hardhatNetwork,
      hasApiKey: Boolean(profile?.apiKey ?? fallback.apiKey),
      profileName,
      stateDir,
    };
  });
}
