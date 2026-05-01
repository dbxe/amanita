import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { listConfiguredBackends, resolveConfig, resolveConfigForProfile } from "./config.js";

function withEnv<T>(overrides: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("resolveConfig reads a gitignored backend profile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-config-"));
  const previousCwd = process.cwd();

  fs.mkdirSync(path.join(tempDir, ".multibaas"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, ".multibaas", "backends.local.json"),
    JSON.stringify(
      {
        defaultProfile: "mainnet-remote",
        profiles: {
          "mainnet-remote": {
            apiKey: "secret-token",
            baseUrl: "https://mainnet.example.multibaas.com",
            chainId: 1,
            chainName: "Ethereum Mainnet",
            hardhatNetwork: "ethereum-mainnet",
            stateDir: ".agent-state/mainnet-remote",
          },
        },
      },
      null,
      2,
    ),
  );

  process.chdir(tempDir);

  try {
    const config = withEnv(
      {
        HARDHAT_NETWORK: undefined,
        MULTIBAAS_API_KEY: undefined,
        MULTIBAAS_BASE_URL: undefined,
        MULTIBAAS_NETWORK: undefined,
        MULTIBAAS_PROFILE: undefined,
      },
      () => resolveConfig(),
    );

    assert.equal(config.baseUrl, "https://mainnet.example.multibaas.com");
    assert.equal(config.apiKey, "secret-token");
    assert.equal(config.hardhatNetwork, "ethereum-mainnet");
    assert.equal(config.profileName, "mainnet-remote");
    assert.equal(path.basename(config.stateDir), "mainnet-remote");
    assert.equal(path.basename(path.dirname(config.stateDir)), ".agent-state");
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveConfig lets env vars override the selected backend profile", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-config-"));
  const previousCwd = process.cwd();

  fs.mkdirSync(path.join(tempDir, ".multibaas"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, ".multibaas", "backends.local.json"),
    JSON.stringify(
      {
        defaultProfile: "mainnet-remote",
        profiles: {
          "mainnet-remote": {
            apiKey: "secret-token",
            baseUrl: "https://mainnet.example.multibaas.com",
            chainId: 1,
            chainName: "Ethereum Mainnet",
            hardhatNetwork: "ethereum-mainnet",
          },
        },
      },
      null,
      2,
    ),
  );

  process.chdir(tempDir);

  try {
    const config = withEnv(
      {
        HARDHAT_NETWORK: undefined,
        MULTIBAAS_API_KEY: "override-token",
        MULTIBAAS_BASE_URL: "https://override.example.multibaas.com",
        MULTIBAAS_NETWORK: undefined,
        MULTIBAAS_PROFILE: undefined,
      },
      () => resolveConfig(),
    );

    assert.equal(config.baseUrl, "https://override.example.multibaas.com");
    assert.equal(config.apiKey, "override-token");
    assert.equal(config.hardhatNetwork, "ethereum-mainnet");
    assert.equal(config.profileName, "mainnet-remote");
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveConfigForProfile and listConfiguredBackends expose multiple configured backends without env overrides", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-config-"));
  const previousCwd = process.cwd();

  fs.mkdirSync(path.join(tempDir, ".multibaas"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, ".multibaas", "backends.local.json"),
    JSON.stringify(
      {
        defaultProfile: "mainnet-remote",
        profiles: {
          "arbitrum-one-remote": {
            apiKey: "arb-secret",
            baseUrl: "https://arb.example.multibaas.com",
            chainId: 42161,
            chainName: "Arbitrum One",
            hardhatNetwork: "arbitrum-one",
            stateDir: ".agent-state/arbitrum-one-remote",
          },
          "mainnet-remote": {
            apiKey: "mainnet-secret",
            baseUrl: "https://mainnet.example.multibaas.com",
            chainId: 1,
            chainName: "Ethereum Mainnet",
            hardhatNetwork: "ethereum-mainnet",
            stateDir: ".agent-state/mainnet-remote",
          },
        },
      },
      null,
      2,
    ),
  );

  process.chdir(tempDir);

  try {
    const config = withEnv(
      {
        MULTIBAAS_API_KEY: "override-token",
        MULTIBAAS_BASE_URL: "https://override.example.multibaas.com",
        MULTIBAAS_PROFILE: "mainnet-remote",
      },
      () => resolveConfigForProfile("arbitrum-one-remote"),
    );

    assert.equal(config.baseUrl, "https://arb.example.multibaas.com");
    assert.equal(config.apiKey, "arb-secret");
    assert.equal(config.hardhatNetwork, "arbitrum-one");
    assert.equal(config.profileName, "arbitrum-one-remote");

    const backends = listConfiguredBackends();
    assert.deepEqual(
      backends.map((backend) => ({
        baseUrl: backend.baseUrl,
        chainId: backend.chainId,
        chainName: backend.chainName,
        hardhatNetwork: backend.hardhatNetwork,
        hasApiKey: backend.hasApiKey,
        profileName: backend.profileName,
      })),
      [
        {
          baseUrl: "https://arb.example.multibaas.com",
          chainId: 42161,
          chainName: "Arbitrum One",
          hardhatNetwork: "arbitrum-one",
          hasApiKey: true,
          profileName: "arbitrum-one-remote",
        },
        {
          baseUrl: "https://mainnet.example.multibaas.com",
          chainId: 1,
          chainName: "Ethereum Mainnet",
          hardhatNetwork: "ethereum-mainnet",
          hasApiKey: true,
          profileName: "mainnet-remote",
        },
      ],
    );
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
