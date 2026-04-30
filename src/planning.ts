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

export interface CreateWatchIntent {
  address: string;
  kind: "create-watch";
  label?: string;
  rawText: string;
}

export interface BalanceWatchReadiness {
  currentBalance?: string;
  state: Exclude<TaskState, "monitoring">;
  waitCondition?: WaitCondition;
}

export interface BalanceWatchPlan {
  executionPlan: ExecutionPlan;
  intent: CreateWatchIntent;
  kind: "balance-watch";
  readiness: BalanceWatchReadiness;
  title: string;
  viewSpec: ViewSpec;
}

export interface BalanceWatchReadinessDeps {
  lookupBalance: (address: string, queryName: string) => Promise<{ rawBalance: string }>;
}

function createTaskTitle(address: string): string {
  return `Monitor balance for ${address}`;
}

function createExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Resolve the current balance from saved query ${queryName}.`, kind: "resolve-balance" },
      { detail: "Persist a local watch once prerequisites are satisfied.", kind: "persist-watch" },
      { detail: "Reevaluate the watch when webhook-triggered events arrive.", kind: "evaluate-watch" },
    ],
  };
}

export function createBalanceWatchPlan(params: {
  address: string;
  label?: string;
  queryName: string;
  rawText: string;
}): BalanceWatchPlan {
  return {
    executionPlan: createExecutionPlan(params.queryName),
    intent: {
      address: params.address,
      kind: "create-watch",
      label: params.label,
      rawText: params.rawText,
    },
    kind: "balance-watch",
    readiness: {
      state: "ready",
    },
    title: createTaskTitle(params.address),
    viewSpec: {
      address: params.address,
      kind: "balance-watch",
      queryName: params.queryName,
    },
  };
}

export function classifyReadinessFailure(error: unknown): BalanceWatchReadiness {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();

  if (/\babi\b|\bcontract definition\b/.test(normalized)) {
    return {
      state: "needs-abi",
      waitCondition: { reason: message, state: "needs-abi" },
    };
  }

  if (/\blink\b|\bnot linked\b|\baddress\b.*\bcontract\b/.test(normalized)) {
    return {
      state: "needs-link",
      waitCondition: { reason: message, state: "needs-link" },
    };
  }

  if (/\bsync\b|\bindex\b|\bindexing\b|\bhistorical\b/.test(normalized)) {
    return {
      state: "syncing",
      waitCondition: { reason: message, state: "syncing" },
    };
  }

  return {
    state: "blocked",
    waitCondition: { reason: message, state: "blocked" },
  };
}

export async function evaluateBalanceWatchReadiness(
  plan: BalanceWatchPlan,
  deps: BalanceWatchReadinessDeps,
): Promise<BalanceWatchPlan> {
  try {
    const balance = await deps.lookupBalance(plan.viewSpec.address, plan.viewSpec.queryName);
    return {
      ...plan,
      readiness: {
        currentBalance: balance.rawBalance,
        state: "ready",
      },
    };
  } catch (error) {
    return {
      ...plan,
      readiness: classifyReadinessFailure(error),
    };
  }
}
