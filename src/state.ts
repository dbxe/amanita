import fs from "node:fs";
import path from "node:path";

export interface Watch {
  address: string;
  createdAt: string;
  id: string;
  label: string;
  lastKnownBalance: string;
  queryName: string;
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

export interface LocalState {
  version: 1;
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

function createEmptyState(): LocalState {
  return {
    version: 1,
    watches: [],
  };
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

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<LocalState>;
  return {
    version: 1,
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
