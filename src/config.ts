import fs from "node:fs";
import path from "node:path";

export interface AmanitaConfig {
  apiKey: string;
  baseUrl: string;
  defaultQueryName: string;
  hardhatNetwork: string;
  scanLimit: number;
  stateDir: string;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseHardhatDeploymentConfig(networkName: string): Partial<Pick<AmanitaConfig, "apiKey" | "baseUrl">> {
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

export function resolveConfig(): AmanitaConfig {
  const hardhatNetwork = process.env.AMANITA_NETWORK ?? process.env.HARDHAT_NETWORK ?? "development";
  const fallback = parseHardhatDeploymentConfig(hardhatNetwork);

  const baseUrl = process.env.AMANITA_MULTIBAAS_BASE_URL ?? fallback.baseUrl;
  const apiKey = process.env.AMANITA_MULTIBAAS_API_KEY ?? fallback.apiKey;

  if (!baseUrl || !apiKey) {
    throw new Error(
      "Missing MultiBaas config. Set AMANITA_MULTIBAAS_BASE_URL and AMANITA_MULTIBAAS_API_KEY, or provide hardhat/deployment-config.<network>.ts.",
    );
  }

  return {
    apiKey,
    baseUrl,
    defaultQueryName: process.env.AMANITA_QUERY_NAME ?? "helloworld_balance",
    hardhatNetwork,
    scanLimit: parsePositiveInteger(process.env.AMANITA_QUERY_SCAN_LIMIT, 1000),
    stateDir: path.resolve(process.cwd(), process.env.AMANITA_STATE_DIR ?? ".amanita"),
  };
}
