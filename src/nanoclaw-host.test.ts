import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { sendNanoClawNotification } from "./nanoclaw-host.js";

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
      CREATE TABLE messaging_groups (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        platform_id TEXT NOT NULL,
        name TEXT,
        is_group INTEGER DEFAULT 0,
        unknown_sender_policy TEXT NOT NULL DEFAULT 'strict',
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
    `);
  } finally {
    db.close();
  }
}

function initializeOutboundDatabase(dbPath: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE messages_out (
        id TEXT PRIMARY KEY,
        seq INTEGER UNIQUE,
        in_reply_to TEXT,
        timestamp TEXT NOT NULL,
        deliver_after TEXT,
        recurrence TEXT,
        kind TEXT NOT NULL,
        platform_id TEXT,
        channel_type TEXT,
        thread_id TEXT,
        content TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

test("sendNanoClawNotification queues a chat message into the latest active session", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logrunner-nanoclaw-host-"));
  const nanoclawDir = path.join(tempDir, "nanoclaw");
  const hostDbPath = path.join(nanoclawDir, "data", "v2.db");
  const outboundDbPath = path.join(
    nanoclawDir,
    "data",
    "v2-sessions",
    "ag-test",
    "sess-current",
    "outbound.db",
  );

  fs.mkdirSync(path.dirname(hostDbPath), { recursive: true });
  fs.mkdirSync(path.dirname(outboundDbPath), { recursive: true });
  initializeHostDatabase(hostDbPath);
  initializeOutboundDatabase(outboundDbPath);

  const hostDb = new DatabaseSync(hostDbPath);
  try {
    hostDb
      .prepare("INSERT INTO agent_groups (id, name, folder, agent_provider, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("ag-test", "OpenAgents", "dm-with-test", null, "2026-04-30T00:00:00.000Z");
    hostDb
      .prepare(
        "INSERT INTO messaging_groups (id, channel_type, platform_id, name, is_group, unknown_sender_policy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "mg-test",
        "discord",
        "discord:@me:123",
        "Tester",
        0,
        "strict",
        "2026-04-30T00:00:00.000Z",
      );
    hostDb
      .prepare(
        "INSERT INTO sessions (id, agent_group_id, messaging_group_id, thread_id, agent_provider, status, container_status, last_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "sess-current",
        "ag-test",
        "mg-test",
        null,
        null,
        "active",
        "stopped",
        "2026-04-30T01:00:00.000Z",
        "2026-04-30T00:00:00.000Z",
      );
  } finally {
    hostDb.close();
  }

  try {
    const result = sendNanoClawNotification(
      {
        groupFolder: "dm-with-test",
        nanoclawDir,
      },
      "whale moved",
    );

    assert.equal(result.agentGroupId, "ag-test");
    assert.equal(result.sessionId, "sess-current");
    assert.equal(result.channelType, "discord");
    assert.equal(result.platformId, "discord:@me:123");
    assert.equal(result.outboundDbPath, outboundDbPath);

    const outboundDb = new DatabaseSync(outboundDbPath);
    try {
      const row = outboundDb
        .prepare("SELECT kind, platform_id, channel_type, thread_id, content FROM messages_out WHERE id = ?")
        .get(result.messageId) as
        | {
            channel_type: string;
            content: string;
            kind: string;
            platform_id: string;
            thread_id: string | null;
          }
        | undefined;

      assert.ok(row);
      assert.equal(row.kind, "chat");
      assert.equal(row.channel_type, "discord");
      assert.equal(row.platform_id, "discord:@me:123");
      assert.equal(row.thread_id, null);
      assert.deepEqual(JSON.parse(row.content), { text: "whale moved" });
    } finally {
      outboundDb.close();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
