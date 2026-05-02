import * as childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface NanoClawGroupTarget {
  agentGroupId?: string;
  groupFolder?: string;
  nanoclawDir: string;
}

interface AgentGroupRow {
  id: string;
  folder: string;
}

interface SessionRow {
  container_status: string;
  created_at: string;
  id: string;
  status: string;
}

interface ContainerConfigSummary {
  backendProfilesJson?: string;
  baseUrl?: string;
  containerConfigPath: string;
  profileName?: string;
  runtimeMountPath?: string;
}

interface OneCliSecretSummary {
  hostPattern?: string;
  pathPattern?: string;
}

interface BackendSecretCoverage {
  hasApiSecret: boolean;
  profileName: string;
}

export interface NanoClawPreflightResult {
  activeSessions: SessionRow[];
  agentGroupId: string;
  backendMode: "registry" | "single-base-url" | "missing";
  configuredProfiles: string[];
  containerConfigPath: string;
  groupFolder: string;
  backendSecretCoverage: BackendSecretCoverage[];
  mcpDistExists: boolean;
  mcpDistPath: string;
  profileName?: string;
  runningContainers: string[];
  sessionDirectories: string[];
}

export interface NanoClawResetResult {
  activeSessionIds: string[];
  agentGroupId: string;
  dbBackupPath: string;
  groupFolder: string;
  movedSessionDirectories: string[];
  runningContainersStopped: string[];
}

let execFileSyncImpl: typeof childProcess.execFileSync = childProcess.execFileSync;

export function setNanoClawExecFileSyncForTest(
  fn: typeof childProcess.execFileSync | undefined,
): void {
  execFileSyncImpl = fn ?? childProcess.execFileSync;
}

function hostDatabasePath(nanoclawDir: string): string {
  return path.join(path.resolve(nanoclawDir), "data", "v2.db");
}

function groupSessionsDir(nanoclawDir: string, agentGroupId: string): string {
  return path.join(path.resolve(nanoclawDir), "data", "v2-sessions", agentGroupId);
}

function resolveAgentGroup(db: DatabaseSync, target: NanoClawGroupTarget): AgentGroupRow {
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
    throw new Error("Missing NanoClaw target. Pass --group-folder or --agent-group-id.");
  }

  const row = db
    .prepare("SELECT id, folder FROM agent_groups WHERE folder = ?")
    .get(target.groupFolder) as AgentGroupRow | undefined;
  if (!row) {
    throw new Error(`NanoClaw group folder not found: ${target.groupFolder}`);
  }
  return row;
}

function listRunningContainers(groupFolder: string): string[] {
  const output = execFileSyncImpl("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" }).trim();
  if (!output) {
    return [];
  }

  const prefix = `nanoclaw-v2-${groupFolder}-`;
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(prefix));
}

function stopContainers(containerNames: string[]): string[] {
  for (const containerName of containerNames) {
    execFileSyncImpl("docker", ["stop", containerName], { encoding: "utf8" });
  }
  return containerNames;
}

function readContainerConfig(nanoclawDir: string, groupFolder: string): ContainerConfigSummary {
  const containerConfigPath = path.join(path.resolve(nanoclawDir), "groups", groupFolder, "container.json");
  const parsed = JSON.parse(fs.readFileSync(containerConfigPath, "utf8")) as {
    additionalMounts?: Array<{ containerPath?: string; hostPath?: string }>;
    mcpServers?: Record<string, { args?: string[]; env?: Record<string, string> }>;
  };
  const runtime = parsed.mcpServers?.["multibaas-runtime"];
  const runtimeMountPath = parsed.additionalMounts?.find((mount) => mount.containerPath === "multibaas-runtime")?.hostPath;

  return {
    backendProfilesJson: runtime?.env?.MULTIBAAS_BACKENDS_JSON,
    baseUrl: runtime?.env?.MULTIBAAS_BASE_URL,
    containerConfigPath,
    profileName: runtime?.env?.MULTIBAAS_PROFILE,
    runtimeMountPath,
  };
}

function listOneCliSecrets(): OneCliSecretSummary[] {
  const output = execFileSyncImpl("onecli", ["secrets", "list"], { encoding: "utf8" });
  const parsed = JSON.parse(output) as { data?: OneCliSecretSummary[] };
  return Array.isArray(parsed.data) ? parsed.data : [];
}

function inspectBackendSecretCoverage(backendProfilesJson?: string): BackendSecretCoverage[] {
  if (!backendProfilesJson) {
    return [];
  }

  const parsed = JSON.parse(backendProfilesJson) as {
    profiles?: Record<string, { baseUrl?: string; inactive?: boolean }>;
  };
  const profiles = parsed.profiles ?? {};
  const secrets = listOneCliSecrets();

  return Object.entries(profiles)
    .filter(([, profile]) => profile.baseUrl && !profile.inactive)
    .map(([profileName, profile]) => {
      const host = new URL(profile.baseUrl!).host;
      const hasApiSecret = secrets.some((secret) =>
        secret.hostPattern === host && secret.pathPattern === "/api/v0/*"
      );

      return {
        hasApiSecret,
        profileName,
      };
    })
    .sort((left, right) => left.profileName.localeCompare(right.profileName));
}

function listSessionDirectories(nanoclawDir: string, agentGroupId: string): string[] {
  const sessionsDir = groupSessionsDir(nanoclawDir, agentGroupId);
  if (!fs.existsSync(sessionsDir)) {
    return [];
  }

  return fs.readdirSync(sessionsDir)
    .filter((entry) => entry.startsWith("sess-"))
    .sort();
}

function activeSessionsForGroup(db: DatabaseSync, agentGroupId: string): SessionRow[] {
  return db
    .prepare(
      "SELECT id, status, container_status, created_at FROM sessions WHERE agent_group_id = ? ORDER BY created_at DESC",
    )
    .all(agentGroupId) as unknown as SessionRow[];
}

export function inspectNanoClawGroup(target: NanoClawGroupTarget): NanoClawPreflightResult {
  const dbPath = hostDatabasePath(target.nanoclawDir);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`NanoClaw database not found: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath);
  try {
    const agentGroup = resolveAgentGroup(db, target);
    const containerConfig = readContainerConfig(target.nanoclawDir, agentGroup.folder);
    const backendProfilesJson = containerConfig.backendProfilesJson
      ? JSON.parse(containerConfig.backendProfilesJson) as { profiles?: Record<string, unknown> }
      : undefined;
    const configuredProfiles = Object.keys(backendProfilesJson?.profiles ?? {}).sort((left, right) => left.localeCompare(right));
    const backendMode = containerConfig.backendProfilesJson
      ? "registry"
      : containerConfig.baseUrl
        ? "single-base-url"
        : "missing";
    const mcpDistPath = path.join(containerConfig.runtimeMountPath ?? path.resolve(process.cwd()), "dist", "mcp.js");

    return {
      activeSessions: activeSessionsForGroup(db, agentGroup.id),
      agentGroupId: agentGroup.id,
      backendMode,
      backendSecretCoverage: inspectBackendSecretCoverage(containerConfig.backendProfilesJson),
      configuredProfiles,
      containerConfigPath: containerConfig.containerConfigPath,
      groupFolder: agentGroup.folder,
      mcpDistExists: fs.existsSync(mcpDistPath),
      mcpDistPath,
      profileName: containerConfig.profileName,
      runningContainers: listRunningContainers(agentGroup.folder),
      sessionDirectories: listSessionDirectories(target.nanoclawDir, agentGroup.id),
    };
  } finally {
    db.close();
  }
}

export function resetNanoClawGroupSessions(target: NanoClawGroupTarget): NanoClawResetResult {
  const dbPath = hostDatabasePath(target.nanoclawDir);
  if (!fs.existsSync(dbPath)) {
    throw new Error(`NanoClaw database not found: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath);
  try {
    const agentGroup = resolveAgentGroup(db, target);
    const activeSessions = activeSessionsForGroup(db, agentGroup.id);
    const sessionIds = activeSessions.map((session) => session.id);
    const runningContainers = stopContainers(listRunningContainers(agentGroup.folder));

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const dbBackupPath = `${dbPath}.bak-${stamp}`;
    fs.copyFileSync(dbPath, dbBackupPath);

    const movedSessionDirectories: string[] = [];
    const sessionsDir = groupSessionsDir(target.nanoclawDir, agentGroup.id);
    const sessionsBackupRoot = path.join(path.resolve(target.nanoclawDir), "data", "v2-sessions-archive", `${agentGroup.id}-${stamp}`);
    fs.mkdirSync(sessionsBackupRoot, { recursive: true });

    for (const sessionDirName of listSessionDirectories(target.nanoclawDir, agentGroup.id)) {
      const fromPath = path.join(sessionsDir, sessionDirName);
      const toPath = path.join(sessionsBackupRoot, sessionDirName);
      fs.renameSync(fromPath, toPath);
      movedSessionDirectories.push(toPath);
    }

    db.exec("BEGIN");
    try {
      if (sessionIds.length > 0) {
        const placeholders = sessionIds.map(() => "?").join(", ");
        db.prepare(`DELETE FROM pending_questions WHERE session_id IN (${placeholders})`).run(...sessionIds);
      }
      db.prepare("DELETE FROM sessions WHERE agent_group_id = ?").run(agentGroup.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      activeSessionIds: sessionIds,
      agentGroupId: agentGroup.id,
      dbBackupPath,
      groupFolder: agentGroup.folder,
      movedSessionDirectories,
      runningContainersStopped: runningContainers,
    };
  } finally {
    db.close();
  }
}

export function formatNanoClawPreflight(result: NanoClawPreflightResult): string {
  const lines = [
    "NanoClaw preflight",
    "",
    `Group: ${result.groupFolder}`,
    `Agent group id: ${result.agentGroupId}`,
    `Container config: ${result.containerConfigPath}`,
    `Backend mode: ${result.backendMode}`,
    `Selected profile: ${result.profileName ?? "(none)"}`,
    `Configured profiles: ${result.configuredProfiles.length > 0 ? result.configuredProfiles.join(", ") : "(none)"}`,
    `MCP dist path: ${result.mcpDistPath}`,
    `MCP dist present: ${result.mcpDistExists ? "yes" : "no"}`,
    `Running containers: ${result.runningContainers.length > 0 ? result.runningContainers.join(", ") : "(none)"}`,
    `Session directories: ${result.sessionDirectories.length > 0 ? result.sessionDirectories.join(", ") : "(none)"}`,
  ];

  if (result.backendSecretCoverage.length > 0) {
    lines.push("", "OneCLI API secret coverage");
    for (const backend of result.backendSecretCoverage) {
      lines.push(`- ${backend.profileName}: ${backend.hasApiSecret ? "present" : "missing"}`);
    }
  }

  if (result.activeSessions.length > 0) {
    lines.push("", "Active sessions");
    for (const session of result.activeSessions) {
      lines.push(`- ${session.id} status=${session.status} container=${session.container_status} created=${session.created_at}`);
    }
  } else {
    lines.push("", "Active sessions", "- (none)");
  }

  return lines.join("\n");
}

export function formatNanoClawReset(result: NanoClawResetResult): string {
  const lines = [
    "NanoClaw reset",
    "",
    `Group: ${result.groupFolder}`,
    `Agent group id: ${result.agentGroupId}`,
    `DB backup: ${result.dbBackupPath}`,
    `Stopped containers: ${result.runningContainersStopped.length > 0 ? result.runningContainersStopped.join(", ") : "(none)"}`,
    `Deleted session rows: ${result.activeSessionIds.length > 0 ? result.activeSessionIds.join(", ") : "(none)"}`,
    `Archived session directories: ${result.movedSessionDirectories.length > 0 ? result.movedSessionDirectories.join(", ") : "(none)"}`,
  ];

  return lines.join("\n");
}
