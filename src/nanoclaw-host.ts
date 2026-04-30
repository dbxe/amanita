import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

interface AgentGroupRow {
  id: string;
  folder: string;
}

interface MessagingGroupRow {
  channel_type: string;
  id: string;
  platform_id: string;
}

interface SessionRow {
  agent_group_id: string;
  id: string;
  messaging_group_id: string | null;
  thread_id: string | null;
}

export interface NanoClawNotificationTarget {
  agentGroupId?: string;
  groupFolder?: string;
  nanoclawDir: string;
  sessionId?: string;
}

export interface NanoClawNotificationResult {
  agentGroupId: string;
  channelType: string;
  messageId: string;
  outboundDbPath: string;
  platformId: string;
  sessionId: string;
  threadId: string | null;
}

function hostDatabasePath(nanoclawDir: string): string {
  return path.join(path.resolve(nanoclawDir), "data", "v2.db");
}

function sessionOutboundDbPath(nanoclawDir: string, agentGroupId: string, sessionId: string): string {
  return path.join(path.resolve(nanoclawDir), "data", "v2-sessions", agentGroupId, sessionId, "outbound.db");
}

function resolveAgentGroup(db: DatabaseSync, target: NanoClawNotificationTarget): AgentGroupRow {
  if (target.agentGroupId) {
    const row = db
      .prepare("SELECT id, folder FROM agent_groups WHERE id = ?")
      .get(target.agentGroupId) as AgentGroupRow | undefined;
    if (!row) {
      throw new Error(`NanoClaw agent group not found: ${target.agentGroupId}`);
    }
    return row;
  }

  if (!target.groupFolder) {
    throw new Error("Missing NanoClaw target. Pass --group-folder, --agent-group-id, or --session-id.");
  }

  const row = db
    .prepare("SELECT id, folder FROM agent_groups WHERE folder = ?")
    .get(target.groupFolder) as AgentGroupRow | undefined;
  if (!row) {
    throw new Error(`NanoClaw group folder not found: ${target.groupFolder}`);
  }
  return row;
}

function resolveSession(db: DatabaseSync, target: NanoClawNotificationTarget, agentGroupId?: string): SessionRow {
  if (target.sessionId) {
    const session = db
      .prepare("SELECT id, agent_group_id, messaging_group_id, thread_id FROM sessions WHERE id = ? AND status = 'active'")
      .get(target.sessionId) as SessionRow | undefined;
    if (!session) {
      throw new Error(`Active NanoClaw session not found: ${target.sessionId}`);
    }
    return session;
  }

  if (!agentGroupId) {
    throw new Error("Cannot resolve a NanoClaw session without an agent group.");
  }

  const session = db
    .prepare(
      "SELECT id, agent_group_id, messaging_group_id, thread_id FROM sessions WHERE agent_group_id = ? AND status = 'active' ORDER BY COALESCE(last_active, created_at) DESC LIMIT 1",
    )
    .get(agentGroupId) as SessionRow | undefined;
  if (!session) {
    throw new Error(`No active NanoClaw session found for agent group ${agentGroupId}`);
  }
  return session;
}

function resolveMessagingGroup(db: DatabaseSync, messagingGroupId: string | null): MessagingGroupRow {
  if (!messagingGroupId) {
    throw new Error("NanoClaw session is not bound to a messaging group.");
  }

  const row = db
    .prepare("SELECT id, channel_type, platform_id FROM messaging_groups WHERE id = ?")
    .get(messagingGroupId) as MessagingGroupRow | undefined;
  if (!row) {
    throw new Error(`NanoClaw messaging group not found: ${messagingGroupId}`);
  }
  return row;
}

export function sendNanoClawNotification(
  target: NanoClawNotificationTarget,
  text: string,
): NanoClawNotificationResult {
  const normalizedText = text.trim();
  if (!normalizedText) {
    throw new Error("Cannot send an empty NanoClaw notification.");
  }

  const dbPath = hostDatabasePath(target.nanoclawDir);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`NanoClaw database not found: ${dbPath}`);
  }

  const hostDb = new DatabaseSync(dbPath);
  try {
    const agentGroup = target.sessionId ? undefined : resolveAgentGroup(hostDb, target);
    const session = resolveSession(hostDb, target, agentGroup?.id);
    const messagingGroup = resolveMessagingGroup(hostDb, session.messaging_group_id);
    const outboundDbPath = sessionOutboundDbPath(target.nanoclawDir, session.agent_group_id, session.id);

    if (!fs.existsSync(outboundDbPath)) {
      throw new Error(`NanoClaw outbound DB not found: ${outboundDbPath}`);
    }

    const outboundDb = new DatabaseSync(outboundDbPath);
    try {
      const nextSeq =
        ((outboundDb.prepare("SELECT COALESCE(MAX(seq), 0) + 2 AS next_seq FROM messages_out").get() as {
          next_seq?: number;
        }).next_seq ??
          2);
      const messageId = `multibaas-alert-${randomUUID()}`;
      outboundDb
        .prepare(
          "INSERT INTO messages_out (id, seq, timestamp, kind, platform_id, channel_type, thread_id, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          messageId,
          nextSeq,
          new Date().toISOString(),
          "chat",
          messagingGroup.platform_id,
          messagingGroup.channel_type,
          session.thread_id,
          JSON.stringify({ text: normalizedText }),
        );

      return {
        agentGroupId: session.agent_group_id,
        channelType: messagingGroup.channel_type,
        messageId,
        outboundDbPath,
        platformId: messagingGroup.platform_id,
        sessionId: session.id,
        threadId: session.thread_id,
      };
    } finally {
      outboundDb.close();
    }
  } finally {
    hostDb.close();
  }
}
