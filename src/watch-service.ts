import { randomUUID } from "node:crypto";

import { resolveConfig } from "./config.js";
import { fetchBalanceSourceSnapshot, getAddressBalance, normalizeAddress, resolveBalanceSource } from "./multibaas.js";
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
  createBalanceMonitorTaskFromPlan,
  findBalanceMonitorTask,
  recordTaskAlert,
  transitionTask,
  upsertTask,
  type BalanceMonitorTaskRecord,
  type TaskRecord,
} from "./tasks.js";
import {
  createBalanceWatchPlan,
  evaluateBalanceWatchReadiness,
  type BalanceWatchPlan,
  type TaskState,
} from "./planning.js";

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
  const snapshots = new Map<string, Awaited<ReturnType<typeof fetchBalanceSourceSnapshot>>>();

  for (const watch of nextState.watches) {
    let snapshot = snapshots.get(watch.queryName);
    if (!snapshot) {
      snapshot = await fetchBalanceSourceSnapshot(config, watch.queryName, config.scanLimit);
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
  const effectiveQueryName = resolveBalanceSource(config, queryName);
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
  const existingTask = findBalanceMonitorTask(state.tasks, normalizedAddress, effectiveQueryName);
  const baseTask = existingTask ?? createBalanceMonitorTaskFromPlan(plan, now);

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
    baseTask.state === "monitoring"
      ? baseTask
      : (transitionTask(baseTask, "ready", now, { waitCondition: undefined }) as BalanceMonitorTaskRecord);
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
    const task = tasks.find(
      (candidate): candidate is BalanceMonitorTaskRecord =>
        candidate.capability === "balance-monitor" && candidate.watchId === alert.watchId,
    );
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
