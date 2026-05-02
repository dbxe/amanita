import fs from "node:fs";
import path from "node:path";

import { listConfiguredBackends, type ConfiguredBackendSummary } from "./config.js";

export interface RuntimeStatus {
  baseUrl?: string;
  backends: ConfiguredBackendSummary[];
  commit: string;
  deployedAt?: string;
  nodeVersion: string;
  packageVersion: string;
  stateDir?: string;
}

function packageVersion(): string {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return "unknown";
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string };
  return packageJson.version ?? "unknown";
}

function fileCommit(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), ".deploy-commit"),
    path.resolve(process.cwd(), "dist", ".deploy-commit"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const value = fs.readFileSync(candidate, "utf8").trim();
      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

export function getRuntimeStatus(): RuntimeStatus {
  return {
    baseUrl: process.env.MULTIBAAS_BASE_URL,
    backends: listConfiguredBackends(),
    commit: process.env.MULTIBAAS_RUNTIME_COMMIT ?? fileCommit() ?? "unknown",
    deployedAt: process.env.MULTIBAAS_RUNTIME_DEPLOYED_AT,
    nodeVersion: process.version,
    packageVersion: packageVersion(),
    stateDir: process.env.MULTIBAAS_AGENT_STATE_DIR,
  };
}
