import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { configureNanoClawGroup, deriveContainerBaseUrl } from "./nanoclaw.js";

test("deriveContainerBaseUrl rewrites localhost for container access", () => {
  assert.equal(deriveContainerBaseUrl("http://localhost:8080"), "http://host.docker.internal:8080");
  assert.equal(deriveContainerBaseUrl("http://127.0.0.1:9000/api"), "http://host.docker.internal:9000/api");
});

test("deriveContainerBaseUrl preserves non-local hosts", () => {
  assert.equal(deriveContainerBaseUrl("https://example.multibaas.com"), "https://example.multibaas.com");
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
  const previousQueryName = process.env.MULTIBAAS_QUERY_NAME;

  process.env.MULTIBAAS_BASE_URL = "http://localhost:8080";
  process.env.MULTIBAAS_API_KEY = "test-api-key";
  process.env.MULTIBAAS_QUERY_NAME = "helloworld_balance";

  try {
    const result = configureNanoClawGroup({
      groupFolder,
      nanoclawDir,
      repoDir,
      writeAllowlist: false,
    });

    assert.equal(result.mountPath, "/workspace/extra/multibaas-agent-harness");

    const containerConfig = JSON.parse(fs.readFileSync(containerConfigPath, "utf8")) as {
      additionalMounts: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>;
      mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
    };

    assert.deepEqual(containerConfig.additionalMounts, [
      {
        hostPath: fs.realpathSync(repoDir),
        containerPath: "multibaas-agent-harness",
        readonly: true,
      },
    ]);

    assert.equal(
      containerConfig.mcpServers["multibaas-agent"].args?.[1],
      "/workspace/extra/multibaas-agent-harness/src/mcp.ts",
    );
    assert.equal(
      containerConfig.mcpServers["multibaas-agent"].env?.MULTIBAAS_BASE_URL,
      "http://host.docker.internal:8080",
    );
  } finally {
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

    if (previousQueryName === undefined) {
      delete process.env.MULTIBAAS_QUERY_NAME;
    } else {
      process.env.MULTIBAAS_QUERY_NAME = previousQueryName;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
