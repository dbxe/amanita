import { randomUUID } from "node:crypto";

export type TaskState = "needs-abi" | "needs-link" | "syncing" | "ready" | "monitoring" | "blocked";

export interface WaitCondition {
  reason: string;
  state: Exclude<TaskState, "ready" | "monitoring">;
}

export interface ViewSpec {
  address: string;
  kind: "balance-watch";
  queryName: string;
}

export interface ExecutionStep {
  detail: string;
  kind: "resolve-balance" | "persist-watch" | "evaluate-watch";
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
}

export interface TaskRecord {
  createdAt: string;
  executionPlan: ExecutionPlan;
  id: string;
  intent: string;
  kind: "balance-watch";
  lastAlertAt?: string;
  lastKnownBalance?: string;
  state: TaskState;
  title: string;
  updatedAt: string;
  viewSpec: ViewSpec;
  waitCondition?: WaitCondition;
  watchId?: string;
}

const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  blocked: ["needs-abi", "needs-link", "syncing", "ready", "monitoring"],
  monitoring: ["blocked", "monitoring", "needs-abi", "needs-link", "ready", "syncing"],
  "needs-abi": ["blocked", "needs-abi", "needs-link", "ready", "syncing"],
  "needs-link": ["blocked", "needs-link", "ready", "syncing"],
  ready: ["blocked", "monitoring", "needs-abi", "needs-link", "ready", "syncing"],
  syncing: ["blocked", "monitoring", "ready", "syncing"],
};

function createExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Resolve the current balance from saved query ${queryName}.`, kind: "resolve-balance" },
      { detail: "Persist a local watch once prerequisites are satisfied.", kind: "persist-watch" },
      { detail: "Reevaluate the watch when webhook-triggered events arrive.", kind: "evaluate-watch" },
    ],
  };
}

function createTaskTitle(address: string): string {
  return `Monitor balance for ${address}`;
}

export function createBalanceWatchTask(params: {
  address: string;
  intent?: string;
  now?: string;
  queryName: string;
}): TaskRecord {
  const now = params.now ?? new Date().toISOString();
  return {
    createdAt: now,
    executionPlan: createExecutionPlan(params.queryName),
    id: randomUUID(),
    intent: params.intent ?? `Alert me if the balance of ${params.address} moves`,
    kind: "balance-watch",
    state: "ready",
    title: createTaskTitle(params.address),
    updatedAt: now,
    viewSpec: {
      address: params.address,
      kind: "balance-watch",
      queryName: params.queryName,
    },
  };
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

export function classifyTaskFailure(error: unknown): WaitCondition {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (/\babi\b|\bcontract definition\b/.test(normalized)) {
    return { reason: message, state: "needs-abi" };
  }

  if (/\blink\b|\bnot linked\b|\baddress\b.*\bcontract\b/.test(normalized)) {
    return { reason: message, state: "needs-link" };
  }

  if (/\bsync\b|\bindex\b|\bindexing\b|\bhistorical\b/.test(normalized)) {
    return { reason: message, state: "syncing" };
  }

  return { reason: message, state: "blocked" };
}

export function applyTaskFailure(task: TaskRecord, error: unknown, now: string): TaskRecord {
  const waitCondition = classifyTaskFailure(error);
  return transitionTask(task, waitCondition.state, now, { waitCondition });
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
