import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  formatNanoClawPreflight,
  formatNanoClawReset,
  inspectNanoClawGroup,
  resetNanoClawGroupSessions,
  setNanoClawExecFileSyncForTest,
} from "./nanoclaw-maintenance.js";

function initializeHostDatabase(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE agent_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        folder TEXT NOT NULL UNIQUE,
        agent_provider TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        agent_group_id TEXT NOT NULL,
        messaging_group_id TEXT,
        thread_id TEXT,
        agent_provider TEXT,
        status TEXT DEFAULT 'active',
        container_status TEXT DEFAULT 'stopped',
        last_active TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE pending_questions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

test("inspectNanoClawGroup reports backend registry and session state", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-nanoclaw-maintenance-"));
  const repoDir = path.join(tempDir, "repo");
  const nanoclawDir = path.join(tempDir, "nanoclaw");
  const dbPath = path.join(nanoclawDir, "data", "v2.db");
  const containerConfigPath = path.join(nanoclawDir, "groups", "cli-with-test", "container.json");
  const sessionDir = path.join(nanoclawDir, "data", "v2-sessions", "ag-test", "sess-current");
  const sharedDir = path.join(nanoclawDir, "data", "v2-sessions", "ag-test", ".claude-shared");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.dirname(containerConfigPath), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "dist", "mcp.js"), "export {};\n");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  initializeHostDatabase(dbPath);

  const db = new DatabaseSync(dbPath);
  try {
    db.prepare("INSERT INTO agent_groups (id, name, folder, agent_provider, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("ag-test", "OpenAgents", "cli-with-test", null, "2026-05-02T00:00:00.000Z");
    db.prepare(
      "INSERT INTO sessions (id, agent_group_id, messaging_group_id, thread_id, agent_provider, status, container_status, last_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "sess-current",
      "ag-test",
      null,
      null,
      null,
      "active",
      "running",
      "2026-05-02T01:00:00.000Z",
      "2026-05-02T00:00:00.000Z",
    );
  } finally {
    db.close();
  }

  fs.writeFileSync(
    containerConfigPath,
    JSON.stringify(
      {
        additionalMounts: [{ hostPath: repoDir, containerPath: "multibaas-runtime", readonly: true }],
        mcpServers: {
          "multibaas-runtime": {
            command: "node",
            args: ["/workspace/extra/multibaas-runtime/dist/mcp.js"],
            env: {
              MULTIBAAS_PROFILE: "mainnet-remote",
              MULTIBAAS_BACKENDS_JSON: JSON.stringify({
                defaultProfile: "mainnet-remote",
                profiles: {
                  "arbitrum-one-remote": { baseUrl: "https://arb.example.multibaas.com" },
                  development: { baseUrl: "http://host.docker.internal:8080", inactive: true },
                  "mainnet-remote": { baseUrl: "https://mainnet.example.multibaas.com" },
                },
              }),
            },
          },
        },
      },
      null,
      2,
    ),
  );

  setNanoClawExecFileSyncForTest(((_cmd: string, args: readonly string[]) => {
    if (args[0] === "ps") {
      return "nanoclaw-v2-cli-with-test-abc123\nother-container\n";
    }
    if (args[0] === "secrets") {
      return JSON.stringify({
        data: [
          { hostPattern: "arb.example.multibaas.com", pathPattern: "/api/v0/*" },
        ],
      });
    }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  }) as typeof import("node:child_process").execFileSync);

  try {
    const result = inspectNanoClawGroup({
      groupFolder: "cli-with-test",
      nanoclawDir,
    });

    assert.equal(result.backendMode, "registry");
    assert.deepEqual(result.configuredProfiles, ["arbitrum-one-remote", "development", "mainnet-remote"]);
    assert.equal(result.profileName, "mainnet-remote");
    assert.equal(result.mcpDistExists, true);
    assert.deepEqual(result.runningContainers, ["nanoclaw-v2-cli-with-test-abc123"]);
    assert.deepEqual(result.sessionDirectories, ["sess-current"]);
    assert.equal(result.activeSessions.length, 1);
    assert.deepEqual(result.backendSecretCoverage, [
      { profileName: "arbitrum-one-remote", hasApiSecret: true },
      { profileName: "mainnet-remote", hasApiSecret: false },
    ]);
    assert.match(formatNanoClawPreflight(result), /Configured profiles: arbitrum-one-remote, development, mainnet-remote/);
    assert.match(formatNanoClawPreflight(result), /OneCLI API secret coverage/);
    assert.match(formatNanoClawPreflight(result), /arbitrum-one-remote: present/);
    assert.match(formatNanoClawPreflight(result), /mainnet-remote: missing/);
  } finally {
    setNanoClawExecFileSyncForTest(undefined);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resetNanoClawGroupSessions stops containers, archives sessions, and clears host DB rows", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-nanoclaw-reset-"));
  const nanoclawDir = path.join(tempDir, "nanoclaw");
  const dbPath = path.join(nanoclawDir, "data", "v2.db");
  const containerConfigPath = path.join(nanoclawDir, "groups", "cli-with-test", "container.json");
  const sessionRoot = path.join(nanoclawDir, "data", "v2-sessions", "ag-test");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(path.dirname(containerConfigPath), { recursive: true });
  fs.mkdirSync(path.join(sessionRoot, "sess-current"), { recursive: true });
  fs.mkdirSync(path.join(sessionRoot, "sess-older"), { recursive: true });
  fs.mkdirSync(path.join(sessionRoot, ".claude-shared"), { recursive: true });
  initializeHostDatabase(dbPath);
  fs.writeFileSync(containerConfigPath, JSON.stringify({ additionalMounts: [], mcpServers: {} }, null, 2));

  const db = new DatabaseSync(dbPath);
  try {
    db.prepare("INSERT INTO agent_groups (id, name, folder, agent_provider, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("ag-test", "OpenAgents", "cli-with-test", null, "2026-05-02T00:00:00.000Z");
    db.prepare(
      "INSERT INTO sessions (id, agent_group_id, messaging_group_id, thread_id, agent_provider, status, container_status, last_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "sess-current",
      "ag-test",
      null,
      null,
      null,
      "active",
      "running",
      "2026-05-02T01:00:00.000Z",
      "2026-05-02T00:00:00.000Z",
    );
    db.prepare(
      "INSERT INTO sessions (id, agent_group_id, messaging_group_id, thread_id, agent_provider, status, container_status, last_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      "sess-older",
      "ag-test",
      null,
      null,
      null,
      "stopped",
      "stopped",
      "2026-05-02T00:30:00.000Z",
      "2026-05-02T00:00:00.000Z",
    );
    db.prepare("INSERT INTO pending_questions (id, session_id, created_at) VALUES (?, ?, ?)")
      .run("pq-1", "sess-current", "2026-05-02T01:05:00.000Z");
  } finally {
    db.close();
  }

  const dockerCalls: string[][] = [];
  setNanoClawExecFileSyncForTest(((_cmd: string, args: readonly string[]) => {
    dockerCalls.push([...args]);
    if (args[0] === "ps") {
      return "nanoclaw-v2-cli-with-test-abc123\n";
    }
    if (args[0] === "stop") {
      return "nanoclaw-v2-cli-with-test-abc123\n";
    }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  }) as typeof import("node:child_process").execFileSync);

  try {
    const result = resetNanoClawGroupSessions({
      groupFolder: "cli-with-test",
      nanoclawDir,
    });

    assert.deepEqual(result.runningContainersStopped, ["nanoclaw-v2-cli-with-test-abc123"]);
    assert.deepEqual(result.activeSessionIds, ["sess-current", "sess-older"]);
    assert.equal(fs.existsSync(result.dbBackupPath), true);
    assert.equal(result.movedSessionDirectories.length, 2);
    assert.equal(fs.existsSync(path.join(sessionRoot, "sess-current")), false);
    assert.equal(fs.existsSync(path.join(sessionRoot, "sess-older")), false);
    assert.equal(fs.existsSync(path.join(sessionRoot, ".claude-shared")), true);

    const checkDb = new DatabaseSync(dbPath);
    try {
      const remainingSessions = checkDb.prepare("SELECT COUNT(*) AS count FROM sessions WHERE agent_group_id = ?").get("ag-test") as { count: number };
      const remainingPending = checkDb.prepare("SELECT COUNT(*) AS count FROM pending_questions").get() as { count: number };
      assert.equal(remainingSessions.count, 0);
      assert.equal(remainingPending.count, 0);
    } finally {
      checkDb.close();
    }

    assert.deepEqual(dockerCalls, [
      ["ps", "--format", "{{.Names}}"],
      ["stop", "nanoclaw-v2-cli-with-test-abc123"],
    ]);
    assert.match(formatNanoClawReset(result), /Deleted session rows: sess-current, sess-older/);
  } finally {
    setNanoClawExecFileSyncForTest(undefined);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
