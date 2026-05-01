import { randomUUID } from "node:crypto";

import { classifyReadinessFailure } from "./readiness.js";
import type { ExecutionPlan, TaskState, ViewSpec, WaitCondition } from "./runtime-types.js";

export type { ExecutionPlan, TaskState, ViewSpec, WaitCondition } from "./runtime-types.js";

interface BaseTaskRecord {
  addressAlias?: string;
  capability: "balance-monitor" | "holder-analysis";
  contractLabel?: string;
  contractVersion?: string;
  createdAt: string;
  executionPlan: ExecutionPlan;
  id: string;
  intent: string;
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

export interface BalanceMonitorTaskRecord extends BaseTaskRecord {
  capability: "balance-monitor";
  viewSpec: Extract<ViewSpec, { kind: "balance-watch" }>;
}

export interface HolderAnalysisTaskRecord extends BaseTaskRecord {
  capability: "holder-analysis";
  viewSpec: Extract<ViewSpec, { kind: "holder-list" }>;
}

export type TaskRecord = BalanceMonitorTaskRecord | HolderAnalysisTaskRecord;

const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  blocked: ["needs-abi", "needs-link", "syncing", "ready", "monitoring"],
  monitoring: ["blocked", "monitoring", "needs-abi", "needs-link", "ready", "syncing"],
  "needs-abi": ["blocked", "needs-abi", "needs-link", "ready", "syncing"],
  "needs-link": ["blocked", "needs-link", "ready", "syncing"],
  ready: ["blocked", "monitoring", "needs-abi", "needs-link", "ready", "syncing"],
  syncing: ["blocked", "monitoring", "ready", "syncing"],
};

function normalizeHolderContractAddress(contractAddress: string): string {
  return contractAddress.trim().toLowerCase();
}

function createHolderQueryExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Execute the holder view from analytical source ${queryName}.`, kind: "execute-holder-query" },
      { detail: "Format the holder list for the user.", kind: "format-response" },
    ],
  };
}

function createBalanceMonitorExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Resolve the current balance from balance source ${queryName}.`, kind: "resolve-balance" },
      { detail: "Persist a local watch once prerequisites are satisfied.", kind: "persist-watch" },
      { detail: "Reevaluate the watch when webhook-triggered events arrive.", kind: "evaluate-watch" },
    ],
  };
}

export function createBalanceMonitorTask(params: {
  address: string;
  intent?: string;
  label?: string;
  now?: string;
  queryName: string;
  state?: Exclude<TaskState, "monitoring">;
  waitCondition?: WaitCondition;
}): BalanceMonitorTaskRecord {
  const now = params.now ?? new Date().toISOString();
  return {
    capability: "balance-monitor",
    createdAt: now,
    executionPlan: createBalanceMonitorExecutionPlan(params.queryName),
    id: randomUUID(),
    intent: params.intent ?? `Alert me if the balance of ${params.address} moves`,
    state: params.state ?? "ready",
    title: params.label ? `Monitor balance for ${params.address} (${params.label})` : `Monitor balance for ${params.address}`,
    updatedAt: now,
    viewSpec: {
      address: params.address,
      kind: "balance-watch",
      queryName: params.queryName,
    },
    waitCondition: params.waitCondition,
  };
}

export function createHolderAnalysisTask(params: {
  contractAddress: string;
  intent?: string;
  limit: number;
  now?: string;
  queryName: string;
}): HolderAnalysisTaskRecord {
  const now = params.now ?? new Date().toISOString();
  const contractAddress = normalizeHolderContractAddress(params.contractAddress);
  return {
    capability: "holder-analysis",
    createdAt: now,
    executionPlan: createHolderQueryExecutionPlan(params.queryName),
    id: randomUUID(),
    intent: params.intent ?? `Give me the top ${params.limit} holders for token ${params.contractAddress}`,
    state: "ready",
    title: `Get top ${params.limit} holders`,
    updatedAt: now,
    viewSpec: {
      contractAddress,
      kind: "holder-list",
      limit: params.limit,
      queryName: params.queryName,
    },
  };
}

export function findBalanceMonitorTask(
  tasks: TaskRecord[],
  address: string,
  queryName: string,
): BalanceMonitorTaskRecord | undefined {
  return [...tasks]
    .reverse()
    .find(
      (task) =>
        task.capability === "balance-monitor" &&
        task.viewSpec.address === address &&
        task.viewSpec.queryName === queryName,
    ) as BalanceMonitorTaskRecord | undefined;
}

export function findHolderAnalysisTask(
  tasks: TaskRecord[],
  contractAddress: string,
  limit: number,
  queryName: string,
): HolderAnalysisTaskRecord | undefined {
  return [...tasks]
    .reverse()
    .find(
      (task): task is HolderAnalysisTaskRecord =>
        task.capability === "holder-analysis" &&
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
  patch: Partial<Omit<TaskRecord, "capability" | "createdAt" | "executionPlan" | "id" | "intent" | "title" | "viewSpec">> = {},
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

export function attachWatchToTask(
  task: BalanceMonitorTaskRecord,
  params: { balance: string; now: string; watchId: string },
): BalanceMonitorTaskRecord {
  return transitionTask(task, "monitoring", params.now, {
    lastKnownBalance: params.balance,
    watchId: params.watchId,
  }) as BalanceMonitorTaskRecord;
}

export function recordTaskAlert(
  task: BalanceMonitorTaskRecord,
  params: { currentBalance: string; now: string; watchId: string },
): BalanceMonitorTaskRecord {
  if (task.watchId && task.watchId !== params.watchId) {
    throw new Error(`Task ${task.id} does not match watch ${params.watchId}`);
  }

  return transitionTask(task, "monitoring", params.now, {
    lastAlertAt: params.now,
    lastKnownBalance: params.currentBalance,
    watchId: params.watchId,
  }) as BalanceMonitorTaskRecord;
}
