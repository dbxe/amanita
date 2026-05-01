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

  assert.match(instructions, /resolve_contract_target/i);
  assert.match(instructions, /get_token_metadata/i);
  assert.match(instructions, /investigate_token/i);
  assert.match(instructions, /do not ask the user for a saved query name/i);
  assert.match(instructions, /if the user asks for decimals.*get_token_metadata/i);
  assert.match(instructions, /do not classify an address as an EOA/i);
  assert.match(instructions, /if a user asks about holders, concentration, or metadata for a raw address/i);
  assert.match(instructions, /get_top_holders.*contractAddress.*tokenName/i);
  assert.match(instructions, /do not infer total supply, concentration, or percentages unless you separately call `get_holder_concentration` or `get_token_metadata`/i);
  assert.match(instructions, /get_address_balance.*contractAddress.*tokenName/i);
  assert.match(instructions, /get_holder_concentration.*contractAddress.*tokenName/i);
  assert.match(instructions, /create_balance_watch.*contractAddress.*tokenName/i);
  assert.match(instructions, /broader token investigation requests.*investigate_token/i);
  assert.match(instructions, /evaluate_tasks/i);
  assert.match(instructions, /do not reply with narration like .*calling the tool now/i);
  assert.match(instructions, /do not cite Etherscan or other external sources/i);
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
  process.env.MULTIBAAS_BASE_URL = "http://localhost:8080";
  process.env.MULTIBAAS_API_KEY = "test-api-key";

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
    assert.equal(
      containerConfig.mcpServers["multibaas-runtime"].env?.MULTIBAAS_BASE_URL,
      "http://host.docker.internal:8080",
    );
    assert.equal(
      containerConfig.mcpServers["multibaas-runtime"].env?.MULTIBAAS_AGENT_STATE_DIR,
      "/workspace/agent/.agent-state",
    );
    assert.match(containerConfig.mcpServers["multibaas-runtime"].instructions ?? "", /do not ask the user for a saved query name/i);
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

  process.env.MULTIBAAS_BASE_URL = "http://localhost:8080";
  process.env.MULTIBAAS_API_KEY = "test-api-key";

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
