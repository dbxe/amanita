import http from "node:http";
import { randomUUID } from "node:crypto";

import type { NanoClawNotificationTarget } from "./nanoclaw-host.js";
import { sendNanoClawNotification } from "./nanoclaw-host.js";
import { resolveConfig } from "./config.js";
import {
  ensureEventWebhook,
  executeSavedBalanceQuery,
  fetchBalanceSnapshot,
  getAddressBalance,
  normalizeAddress,
  selectTopPositiveHolders,
  verifyWebhookSignature,
} from "./multibaas.js";
import {
  appendAlerts,
  loadState,
  saveState,
  type AlertRecord,
  type LocalState,
  type Watch,
} from "./state.js";
import {
  attachWatchToTask,
  createTaskFromBalanceWatchPlan,
  findBalanceWatchTask,
  recordTaskAlert,
  transitionTask,
  upsertTask,
  type TaskRecord,
} from "./tasks.js";
import {
  createBalanceWatchPlan,
  evaluateBalanceWatchReadiness,
  type BalanceWatchPlan,
  type TaskState,
} from "./planning.js";

export const DEFAULT_WEBHOOK_LABEL = "balance-watch";

export interface TopHoldersResult {
  holders: Array<{ address: string; rawBalance: string }>;
  limit: number;
  queryName: string;
}

export interface BalanceResult {
  address: string;
  balance: string;
  queryName: string;
}

export interface WatchListResult {
  watches: Array<Watch & { taskState?: TaskState }>;
}

export interface WatchSaveResult {
  plan: BalanceWatchPlan;
  task: TaskRecord;
  watch?: Watch;
}

export interface WatchEvaluationResult {
  alerts: AlertRecord[];
  state: LocalState;
}

export interface TaskListResult {
  tasks: TaskRecord[];
}

export interface WebhookEnsureResult {
  id: number;
  label: string;
  secret?: string;
  subscriptions: string[];
  updatedAt: string;
  url: string;
}

export interface WebhookServerOptions {
  nanoclawTarget?: NanoClawNotificationTarget;
  port: number;
  requestPath: string;
  secret?: string;
}

function createWatchLabel(address: string): string {
  return `watch-${address.slice(0, 10)}`;
}

async function evaluateWatches(
  state: LocalState,
  eventCount: number | undefined,
): Promise<{ alerts: AlertRecord[]; nextState: LocalState }> {
  const config = resolveConfig();
  const nextState: LocalState = {
    ...state,
    tasks: [...state.tasks],
    watches: state.watches.map((watch) => ({ ...watch })),
  };

  const alerts: AlertRecord[] = [];
  const snapshots = new Map<string, Awaited<ReturnType<typeof fetchBalanceSnapshot>>>();

  for (const watch of nextState.watches) {
    let snapshot = snapshots.get(watch.queryName);
    if (!snapshot) {
      snapshot = await fetchBalanceSnapshot(config, watch.queryName, config.scanLimit);
      snapshots.set(watch.queryName, snapshot);
    }

    const current = snapshot.get(normalizeAddress(watch.address));
    const currentBalance = current?.rawBalance ?? "0";

    if (currentBalance === watch.lastKnownBalance) {
      continue;
    }

    alerts.push({
      currentBalance,
      eventCount,
      id: randomUUID(),
      observedAt: new Date().toISOString(),
      previousBalance: watch.lastKnownBalance,
      queryName: watch.queryName,
      watchId: watch.id,
    });

    watch.lastKnownBalance = currentBalance;
    watch.updatedAt = new Date().toISOString();
  }

  return { alerts, nextState };
}

export function formatTopHolders(result: TopHoldersResult): string {
  const lines = [`Top ${result.limit} holders`, ""];
  result.holders.forEach((row, index) => {
    lines.push(`${String(index + 1).padStart(2, " ")}. ${row.address}  ${row.rawBalance}`);
  });
  return lines.join("\n");
}

export function formatBalance(result: BalanceResult): string {
  return [`Query: ${result.queryName}`, `Address: ${result.address}`, `Balance: ${result.balance}`].join("\n");
}

function formatTaskLine(task: TaskRecord): string {
  const details = [`${task.id}  ${task.state}  ${task.title}`];
  if (task.waitCondition) {
    details.push(`reason=${task.waitCondition.reason}`);
  }
  if (task.watchId) {
    details.push(`watch=${task.watchId}`);
  }
  if (task.lastKnownBalance) {
    details.push(`balance=${task.lastKnownBalance}`);
  }
  return details.join("  ");
}

export function formatTasks(result: TaskListResult): string {
  if (result.tasks.length === 0) {
    return "No tasks recorded.";
  }

  return result.tasks.map((task) => formatTaskLine(task)).join("\n");
}

export function formatWatches(result: WatchListResult): string {
  if (result.watches.length === 0) {
    return "No watches registered.";
  }

  return result.watches
    .map((watch) =>
      [watch.id, watch.label, watch.address, watch.lastKnownBalance, watch.taskState ? `task=${watch.taskState}` : undefined]
        .filter((value) => value !== undefined)
        .join("  "),
    )
    .join("\n");
}

export function formatSavedWatch(result: WatchSaveResult): string {
  const lines = [formatTaskLine(result.task)];
  if (result.watch) {
    lines.push(
      `Saved watch ${result.watch.label} for ${result.watch.address} at balance ${result.watch.lastKnownBalance}`,
    );
  } else if (result.task.waitCondition) {
    lines.push(`Accepted request for ${result.plan.viewSpec.address}; waiting because ${result.task.waitCondition.reason}`);
  }
  return lines.join("\n");
}

export function formatAlerts(state: LocalState, alerts: AlertRecord[]): string {
  if (alerts.length === 0) {
    return "No balance changes detected.";
  }

  return alerts
    .map((alert) => {
      const watch = state.watches.find((candidate) => candidate.id === alert.watchId);
      const label = watch?.label ?? alert.watchId;
      const address = watch?.address ?? "unknown";
      const delta = BigInt(alert.currentBalance) - BigInt(alert.previousBalance);
      return `[alert] ${label} (${address}) ${alert.previousBalance} -> ${alert.currentBalance} (delta ${delta >= 0n ? "+" : ""}${delta.toString()})`;
    })
    .join("\n");
}

export function formatWebhook(result: WebhookEnsureResult): string {
  const lines = [`Webhook ready: id=${result.id} label=${result.label} url=${result.url}`];
  if (result.secret) {
    lines.push("Stored webhook signing secret in local state.");
  }
  return lines.join("\n");
}

export async function getTopHolders(limit = 20, queryName?: string): Promise<TopHoldersResult> {
  const config = resolveConfig();
  const effectiveQueryName = queryName ?? config.defaultQueryName;
  const rows = await executeSavedBalanceQuery(config, effectiveQueryName, Math.min(limit, 100));

  return {
    holders: selectTopPositiveHolders(rows, limit).map((row) => ({
      address: row.address,
      rawBalance: row.rawBalance,
    })),
    limit,
    queryName: effectiveQueryName,
  };
}

export async function lookupBalance(address: string, queryName?: string): Promise<BalanceResult> {
  const config = resolveConfig();
  const effectiveQueryName = queryName ?? config.defaultQueryName;
  const balance = await getAddressBalance(config, effectiveQueryName, address);

  return {
    address: balance.address,
    balance: balance.rawBalance,
    queryName: effectiveQueryName,
  };
}

export function listTasks(): TaskListResult {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  return { tasks: state.tasks };
}

export function listBalanceWatches(): WatchListResult {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const taskStateById = new Map(state.tasks.map((task) => [task.id, task.state]));
  return {
    watches: state.watches.map((watch) => ({
      ...watch,
      taskState: watch.taskId ? taskStateById.get(watch.taskId) : undefined,
    })),
  };
}

export async function saveBalanceWatch(address: string, label?: string, queryName?: string): Promise<WatchSaveResult> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const normalizedAddress = normalizeAddress(address);
  const effectiveQueryName = queryName ?? config.defaultQueryName;
  const now = new Date().toISOString();
  const plan = await evaluateBalanceWatchReadiness(
    createBalanceWatchPlan({
      address: normalizedAddress,
      label,
      queryName: effectiveQueryName,
      rawText: `Alert me if the balance of ${normalizedAddress} moves`,
    }),
    {
      lookupBalance: (candidateAddress, candidateQueryName) =>
        getAddressBalance(config, candidateQueryName, candidateAddress),
    },
  );
  const existingTask = findBalanceWatchTask(state.tasks, normalizedAddress, effectiveQueryName);
  const baseTask = existingTask ?? createTaskFromBalanceWatchPlan(plan, now);

  if (plan.readiness.state !== "ready" || !plan.readiness.currentBalance) {
    const waitingTask = transitionTask(baseTask, plan.readiness.state, now, {
      waitCondition: plan.readiness.waitCondition,
    });
    const nextState: LocalState = {
      ...state,
      tasks: upsertTask(state.tasks, waitingTask),
    };
    saveState(config.stateDir, nextState);
    return { plan, task: waitingTask };
  }

  const readyTask =
    baseTask.state === "monitoring" ? baseTask : transitionTask(baseTask, "ready", now, { waitCondition: undefined });
  const existingWatch = state.watches.find(
    (watch) => normalizeAddress(watch.address) === normalizedAddress && watch.queryName === effectiveQueryName,
  );
  const watch: Watch = existingWatch
    ? {
        ...existingWatch,
        label: label ?? existingWatch.label,
        lastKnownBalance: plan.readiness.currentBalance,
        taskId: readyTask.id,
        updatedAt: now,
      }
    : {
        address: normalizedAddress,
        createdAt: now,
        id: randomUUID(),
        label: label ?? createWatchLabel(normalizedAddress),
        lastKnownBalance: plan.readiness.currentBalance,
        queryName: effectiveQueryName,
        taskId: readyTask.id,
        updatedAt: now,
      };

  const monitoringTask = attachWatchToTask(readyTask, {
    balance: plan.readiness.currentBalance,
    now,
    watchId: watch.id,
  });
  const nextState: LocalState = {
    ...state,
    tasks: upsertTask(state.tasks, monitoringTask),
    watches: existingWatch
      ? state.watches.map((candidate) => (candidate.id === existingWatch.id ? watch : candidate))
      : [...state.watches, watch],
  };
  saveState(config.stateDir, nextState);

  return { plan, task: monitoringTask, watch };
}

export async function evaluateBalanceWatches(eventCount?: number): Promise<WatchEvaluationResult> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const { alerts, nextState } = await evaluateWatches(state, eventCount);
  const updatedTasks = alerts.reduce((tasks, alert) => {
    const task = tasks.find((candidate) => candidate.watchId === alert.watchId);
    if (!task) {
      return tasks;
    }
    return upsertTask(
      tasks,
      recordTaskAlert(task, {
        currentBalance: alert.currentBalance,
        now: alert.observedAt,
        watchId: alert.watchId,
      }),
    );
  }, nextState.tasks);
  const finalState: LocalState = {
    ...nextState,
    tasks: updatedTasks,
  };
  saveState(config.stateDir, finalState);
  appendAlerts(config.stateDir, alerts);
  return { alerts, state: finalState };
}

export async function ensureBalanceWebhook(url: string, label = DEFAULT_WEBHOOK_LABEL): Promise<WebhookEnsureResult> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const webhook = await ensureEventWebhook(config, label, url);
  const result: WebhookEnsureResult = {
    id: webhook.id,
    label: webhook.label,
    secret: webhook.secret ?? state.webhook?.secret,
    subscriptions: webhook.subscriptions,
    updatedAt: new Date().toISOString(),
    url: webhook.url,
  };

  const nextState: LocalState = {
    ...state,
    webhook: result,
  };
  saveState(config.stateDir, nextState);
  return result;
}

export async function startWebhookServer(options: WebhookServerOptions): Promise<http.Server> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const secret = options.secret ?? state.webhook?.secret ?? process.env.MULTIBAAS_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      "Missing webhook secret. Run `npm run dev -- webhook ensure --url ...` first, or pass --secret / MULTIBAAS_WEBHOOK_SECRET.",
    );
  }

  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== options.requestPath) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    const timestamp = request.headers["x-multibaas-timestamp"];
    const signature = request.headers["x-multibaas-signature"];

    const timestampValue = Array.isArray(timestamp) ? timestamp[0] : timestamp;
    const signatureValue = Array.isArray(signature) ? signature[0] : signature;

    if (!verifyWebhookSignature(body, timestampValue, signatureValue, secret)) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Invalid signature" }));
      return;
    }

    let events: unknown[] = [];
    try {
      const parsed = JSON.parse(body.toString("utf8")) as unknown;
      if (Array.isArray(parsed)) {
        events = parsed;
      }
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: `Invalid JSON: ${String(error)}` }));
      return;
    }

    const result = await evaluateBalanceWatches(events.length);
    let notifyError: string | undefined;

    if (result.alerts.length > 0 && options.nanoclawTarget) {
      try {
        sendNanoClawNotification(
          options.nanoclawTarget,
          [`[MultiBaas alert]`, formatAlerts(result.state, result.alerts)].join("\n"),
        );
      } catch (error) {
        notifyError = error instanceof Error ? error.message : String(error);
        console.error(`Failed to deliver NanoClaw alert: ${notifyError}`);
      }
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ alerts: result.alerts.length, notifyError, received: events.length }));
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, "0.0.0.0", () => resolve());
  });

  return server;
}
