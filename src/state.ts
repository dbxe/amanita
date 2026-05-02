import fs from "node:fs";
import path from "node:path";

import type { TaskRecord } from "./tasks.js";

export interface Watch {
  address: string;
  createdAt: string;
  id: string;
  label: string;
  lastKnownBalance: string;
  queryName: string;
  taskId?: string;
  updatedAt: string;
}

export interface StoredWebhook {
  id: number;
  label: string;
  secret?: string;
  subscriptions: string[];
  updatedAt: string;
  url: string;
}

export interface EventMonitor {
  contractAddress: string;
  contractLabel: string;
  createdAt: string;
  eventName: string;
  followUpAnalysis: string[];
  id: string;
  kind: "arbitrum-frozen-eth-release-proposal";
  label: string;
  lastTriggeredAt?: string;
  matchText: string[];
  network: string;
  profileName: string;
  triggeredEventKeys: string[];
  updatedAt: string;
}

export interface LocalState {
  eventMonitors: EventMonitor[];
  tasks: TaskRecord[];
  version: 3;
  watches: Watch[];
  webhook?: StoredWebhook;
}

export interface AlertRecord {
  currentBalance: string;
  eventCount?: number;
  id: string;
  observedAt: string;
  previousBalance: string;
  queryName: string;
  watchId: string;
}

export interface EventMonitorAlertRecord {
  eventKey: string;
  id: string;
  matchedText: string[];
  monitorId: string;
  observedAt: string;
  summary: string;
}

function createEmptyState(): LocalState {
  return {
    eventMonitors: [],
    tasks: [],
    version: 3,
    watches: [],
  };
}

type PersistedTaskRecord =
  & Partial<TaskRecord>
  & Record<string, unknown>
  & { capability?: "balance-monitor" | "holder-analysis"; kind?: "balance-watch" | "holder-query" };

function migrateTaskRecord(task: PersistedTaskRecord): TaskRecord {
  if (task.capability === "balance-monitor" || task.capability === "holder-analysis") {
    return task as TaskRecord;
  }

  if (task.kind === "balance-watch") {
    return {
      ...task,
      capability: "balance-monitor",
    } as TaskRecord;
  }

  if (task.kind === "holder-query") {
    return {
      ...task,
      capability: "holder-analysis",
    } as TaskRecord;
  }

  throw new Error(`Unsupported persisted task record: ${JSON.stringify(task)}`);
}

function ensureStateDir(stateDir: string): void {
  fs.mkdirSync(stateDir, { recursive: true });
}

function statePath(stateDir: string): string {
  return path.join(stateDir, "state.json");
}

function alertsPath(stateDir: string): string {
  return path.join(stateDir, "alerts.jsonl");
}

export function loadState(stateDir: string): LocalState {
  ensureStateDir(stateDir);
  const filePath = statePath(stateDir);
  if (!fs.existsSync(filePath)) {
    return createEmptyState();
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    eventMonitors?: unknown;
    tasks?: unknown;
    version?: number;
    watches?: unknown;
    webhook?: StoredWebhook;
  };
  return {
    eventMonitors: Array.isArray(parsed.eventMonitors) ? parsed.eventMonitors as EventMonitor[] : [],
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((task) => migrateTaskRecord(task as PersistedTaskRecord)) : [],
    version: 3,
    watches: Array.isArray(parsed.watches) ? parsed.watches : [],
    webhook: parsed.webhook,
  };
}

export function saveState(stateDir: string, state: LocalState): void {
  ensureStateDir(stateDir);
  fs.writeFileSync(statePath(stateDir), `${JSON.stringify(state, null, 2)}\n`);
}

export function appendAlerts(stateDir: string, alerts: AlertRecord[]): void {
  if (alerts.length === 0) {
    return;
  }

  ensureStateDir(stateDir);
  const serialized = alerts.map((alert) => JSON.stringify(alert)).join("\n");
  fs.appendFileSync(alertsPath(stateDir), `${serialized}\n`);
}

function eventMonitorAlertsPath(stateDir: string): string {
  return path.join(stateDir, "event-alerts.jsonl");
}

export function appendEventMonitorAlerts(stateDir: string, alerts: EventMonitorAlertRecord[]): void {
  if (alerts.length === 0) {
    return;
  }

  ensureStateDir(stateDir);
  const serialized = alerts.map((alert) => JSON.stringify(alert)).join("\n");
  fs.appendFileSync(eventMonitorAlertsPath(stateDir), `${serialized}\n`);
}
