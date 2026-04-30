import { randomUUID } from "node:crypto";

import {
  classifyReadinessFailure,
  createBalanceWatchPlan,
  createHolderListPlan,
  type BalanceWatchPlan,
  type ExecutionPlan,
  type HolderListPlan,
  type TaskState,
  type ViewSpec,
  type WaitCondition,
} from "./planning.js";

export type { ExecutionPlan, TaskState, ViewSpec, WaitCondition } from "./planning.js";

interface BaseTaskRecord {
  addressAlias?: string;
  contractLabel?: string;
  contractVersion?: string;
  createdAt: string;
  executionPlan: ExecutionPlan;
  id: string;
  intent: string;
  kind: "balance-watch" | "holder-query";
  lastAlertAt?: string;
  lastKnownBalance?: string;
  lastEvaluatedAt?: string;
  lastReportedAt?: string;
  resultText?: string;
  state: TaskState;
  title: string;
  updatedAt: string;
  waitCondition?: WaitCondition;
  watchId?: string;
}

export interface BalanceWatchTaskRecord extends BaseTaskRecord {
  kind: "balance-watch";
  viewSpec: Extract<ViewSpec, { kind: "balance-watch" }>;
}

export interface HolderQueryTaskRecord extends BaseTaskRecord {
  kind: "holder-query";
  viewSpec: Extract<ViewSpec, { kind: "holder-list" }>;
}

export type TaskRecord = BalanceWatchTaskRecord | HolderQueryTaskRecord;

const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  blocked: ["needs-abi", "needs-link", "syncing", "ready", "monitoring"],
  monitoring: ["blocked", "monitoring", "needs-abi", "needs-link", "ready", "syncing"],
  "needs-abi": ["blocked", "needs-abi", "needs-link", "ready", "syncing"],
  "needs-link": ["blocked", "needs-link", "ready", "syncing"],
  ready: ["blocked", "monitoring", "needs-abi", "needs-link", "ready", "syncing"],
  syncing: ["blocked", "monitoring", "ready", "syncing"],
};

export function createTaskFromBalanceWatchPlan(plan: BalanceWatchPlan, now = new Date().toISOString()): TaskRecord {
  return {
    createdAt: now,
    executionPlan: plan.executionPlan,
    id: randomUUID(),
    intent: plan.intent.rawText,
    kind: "balance-watch",
    state: plan.readiness.state,
    title: plan.title,
    updatedAt: now,
    viewSpec: plan.viewSpec,
    waitCondition: plan.readiness.waitCondition,
  };
}

export function createTaskFromHolderListPlan(plan: HolderListPlan, now = new Date().toISOString()): HolderQueryTaskRecord {
  return {
    createdAt: now,
    executionPlan: plan.executionPlan,
    id: randomUUID(),
    intent: plan.intent.rawText,
    kind: "holder-query",
    state: plan.readiness.state,
    title: plan.title,
    updatedAt: now,
    viewSpec: plan.viewSpec,
    waitCondition: plan.readiness.waitCondition,
  };
}

export function createBalanceWatchTask(params: {
  address: string;
  intent?: string;
  label?: string;
  now?: string;
  queryName: string;
}): TaskRecord {
  const now = params.now ?? new Date().toISOString();
  const plan = createBalanceWatchPlan({
    address: params.address,
    label: params.label,
    queryName: params.queryName,
    rawText: params.intent ?? `Alert me if the balance of ${params.address} moves`,
  });
  return createTaskFromBalanceWatchPlan(plan, now);
}

export function createHolderQueryTask(params: {
  contractAddress: string;
  intent?: string;
  limit: number;
  now?: string;
  queryName: string;
}): HolderQueryTaskRecord {
  const now = params.now ?? new Date().toISOString();
  const plan = createHolderListPlan({
    contractAddress: params.contractAddress,
    limit: params.limit,
    queryName: params.queryName,
    rawText: params.intent ?? `Give me the top ${params.limit} holders for token ${params.contractAddress}`,
  });
  return createTaskFromHolderListPlan(plan, now);
}

export function findBalanceWatchTask(tasks: TaskRecord[], address: string, queryName: string): TaskRecord | undefined {
  return [...tasks]
    .reverse()
    .find(
      (task) =>
        task.kind === "balance-watch" &&
        task.viewSpec.address === address &&
        task.viewSpec.queryName === queryName,
    );
}

export function findHolderQueryTask(
  tasks: TaskRecord[],
  contractAddress: string,
  limit: number,
  queryName: string,
): HolderQueryTaskRecord | undefined {
  return [...tasks]
    .reverse()
    .find(
      (task): task is HolderQueryTaskRecord =>
        task.kind === "holder-query" &&
        task.viewSpec.contractAddress === contractAddress &&
        task.viewSpec.limit === limit &&
        task.viewSpec.queryName === queryName,
    );
}

export function upsertTask(tasks: TaskRecord[], task: TaskRecord): TaskRecord[] {
  const index = tasks.findIndex((candidate) => candidate.id === task.id);
  if (index === -1) {
    return [...tasks, task];
  }

  return tasks.map((candidate) => (candidate.id === task.id ? task : candidate));
}

export function transitionTask(
  task: TaskRecord,
  nextState: TaskState,
  now: string,
  patch: Partial<Omit<TaskRecord, "createdAt" | "executionPlan" | "id" | "intent" | "kind" | "title" | "viewSpec">> = {},
): TaskRecord {
  if (task.state !== nextState && !ALLOWED_TRANSITIONS[task.state].includes(nextState)) {
    throw new Error(`Illegal task transition: ${task.state} -> ${nextState}`);
  }

  const waitCondition = nextState === "ready" || nextState === "monitoring" ? undefined : patch.waitCondition;

  return {
    ...task,
    ...patch,
    state: nextState,
    updatedAt: now,
    waitCondition,
  };
}

export function applyTaskFailure(task: TaskRecord, error: unknown, now: string): TaskRecord {
  const readiness = classifyReadinessFailure(error);
  return transitionTask(task, readiness.state, now, { waitCondition: readiness.waitCondition });
}

export function attachWatchToTask(task: TaskRecord, params: { balance: string; now: string; watchId: string }): TaskRecord {
  return transitionTask(task, "monitoring", params.now, {
    lastKnownBalance: params.balance,
    watchId: params.watchId,
  });
}

export function recordTaskAlert(
  task: TaskRecord,
  params: { currentBalance: string; now: string; watchId: string },
): TaskRecord {
  if (task.watchId && task.watchId !== params.watchId) {
    throw new Error(`Task ${task.id} does not match watch ${params.watchId}`);
  }

  return transitionTask(task, "monitoring", params.now, {
    lastAlertAt: params.now,
    lastKnownBalance: params.currentBalance,
    watchId: params.watchId,
  });
}
