export type TaskState = "needs-abi" | "needs-link" | "syncing" | "ready" | "monitoring" | "blocked";

export interface WaitCondition {
  reason: string;
  state: Exclude<TaskState, "ready" | "monitoring">;
}

export type ViewSpec =
  | {
      kind: "address-balance";
      address: string;
      queryName: string;
    }
  | {
      kind: "balance-watch";
      address: string;
      queryName: string;
    }
  | {
      kind: "holder-list";
      contractAddress?: string;
      limit: number;
      queryName: string;
    }
  | {
      contractAddress?: string;
      kind: "holder-concentration";
      limit: number;
      queryName: string;
    };

export interface ExecutionStep {
  detail: string;
  kind:
    | "compute-concentration"
    | "evaluate-watch"
    | "execute-holder-query"
    | "format-response"
    | "persist-watch"
    | "resolve-balance";
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

export interface AddressBalanceIntent {
  address: string;
  kind: "balance";
  rawText: string;
}

export interface TopHoldersIntent {
  contractAddress?: string;
  kind: "top-holders";
  limit: number;
  rawText: string;
}

export interface HolderConcentrationIntent {
  contractAddress?: string;
  kind: "holder-concentration";
  limit: number;
  rawText: string;
}

export type ViewIntent = AddressBalanceIntent | CreateWatchIntent | HolderConcentrationIntent | TopHoldersIntent;

export interface BalanceWatchReadiness {
  contractAddress?: string;
  contractLabel?: string;
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
  viewSpec: Extract<ViewSpec, { kind: "balance-watch" }>;
}

export interface AddressBalancePlan {
  executionPlan: ExecutionPlan;
  intent: AddressBalanceIntent;
  kind: "address-balance";
  readiness: BalanceWatchReadiness;
  title: string;
  viewSpec: Extract<ViewSpec, { kind: "address-balance" }>;
}

export interface HolderListPlan {
  executionPlan: ExecutionPlan;
  intent: TopHoldersIntent;
  kind: "holder-list";
  readiness: BalanceWatchReadiness;
  title: string;
  viewSpec: Extract<ViewSpec, { kind: "holder-list" }>;
}

export interface HolderConcentrationPlan {
  executionPlan: ExecutionPlan;
  intent: HolderConcentrationIntent;
  kind: "holder-concentration";
  readiness: BalanceWatchReadiness;
  title: string;
  viewSpec: Extract<ViewSpec, { kind: "holder-concentration" }>;
}

export type ViewPlan = AddressBalancePlan | BalanceWatchPlan | HolderConcentrationPlan | HolderListPlan;

export interface BalanceWatchReadinessDeps {
  lookupBalance: (address: string, queryName: string) => Promise<{ rawBalance: string }>;
}

export interface HolderViewReadinessDeps {
  inspectContract: (address: string) => Promise<{
    contractLabel?: string;
    isProcessingPastLogs: boolean;
  }>;
}

function normalizeContractAddress(value: string): string {
  return value.trim().toLowerCase();
}

function createTaskTitle(address: string): string {
  return `Monitor balance for ${address}`;
}

function createBalanceWatchExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Resolve the current balance from saved query ${queryName}.`, kind: "resolve-balance" },
      { detail: "Persist a local watch once prerequisites are satisfied.", kind: "persist-watch" },
      { detail: "Reevaluate the watch when webhook-triggered events arrive.", kind: "evaluate-watch" },
    ],
  };
}

function createAddressBalanceExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Resolve the current balance from saved query ${queryName}.`, kind: "resolve-balance" },
      { detail: "Format the balance answer for the user.", kind: "format-response" },
    ],
  };
}

function createHolderListExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Execute the holder view from saved query ${queryName}.`, kind: "execute-holder-query" },
      { detail: "Format the holder list for the user.", kind: "format-response" },
    ],
  };
}

function createHolderConcentrationExecutionPlan(queryName: string): ExecutionPlan {
  return {
    steps: [
      { detail: `Execute the holder view from saved query ${queryName}.`, kind: "execute-holder-query" },
      { detail: "Compute concentration from the top positive holders over tracked supply.", kind: "compute-concentration" },
      { detail: "Format the concentration result for the user.", kind: "format-response" },
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
    executionPlan: createBalanceWatchExecutionPlan(params.queryName),
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

export function createAddressBalancePlan(params: {
  address: string;
  queryName: string;
  rawText: string;
}): AddressBalancePlan {
  return {
    executionPlan: createAddressBalanceExecutionPlan(params.queryName),
    intent: {
      address: params.address,
      kind: "balance",
      rawText: params.rawText,
    },
    kind: "address-balance",
    readiness: {
      state: "ready",
    },
    title: `Get balance for ${params.address}`,
    viewSpec: {
      address: params.address,
      kind: "address-balance",
      queryName: params.queryName,
    },
  };
}

export function createHolderListPlan(params: {
  contractAddress?: string;
  limit: number;
  queryName: string;
  rawText: string;
}): HolderListPlan {
  return {
    executionPlan: createHolderListExecutionPlan(params.queryName),
    intent: {
      contractAddress: params.contractAddress ? normalizeContractAddress(params.contractAddress) : undefined,
      kind: "top-holders",
      limit: params.limit,
      rawText: params.rawText,
    },
    kind: "holder-list",
    readiness: {
      state: "ready",
    },
    title: `Get top ${params.limit} holders`,
    viewSpec: {
      contractAddress: params.contractAddress ? normalizeContractAddress(params.contractAddress) : undefined,
      kind: "holder-list",
      limit: params.limit,
      queryName: params.queryName,
    },
  };
}

export function createHolderConcentrationPlan(params: {
  contractAddress?: string;
  limit: number;
  queryName: string;
  rawText: string;
}): HolderConcentrationPlan {
  return {
    executionPlan: createHolderConcentrationExecutionPlan(params.queryName),
    intent: {
      contractAddress: params.contractAddress ? normalizeContractAddress(params.contractAddress) : undefined,
      kind: "holder-concentration",
      limit: params.limit,
      rawText: params.rawText,
    },
    kind: "holder-concentration",
    readiness: {
      state: "ready",
    },
    title: `Get top ${params.limit} holder concentration`,
    viewSpec: {
      contractAddress: params.contractAddress ? normalizeContractAddress(params.contractAddress) : undefined,
      kind: "holder-concentration",
      limit: params.limit,
      queryName: params.queryName,
    },
  };
}

export function createPlanFromIntent(intent: TopHoldersIntent, queryName: string): HolderListPlan;
export function createPlanFromIntent(intent: AddressBalanceIntent, queryName: string): AddressBalancePlan;
export function createPlanFromIntent(intent: CreateWatchIntent, queryName: string): BalanceWatchPlan;
export function createPlanFromIntent(intent: HolderConcentrationIntent, queryName: string): HolderConcentrationPlan;
export function createPlanFromIntent(intent: ViewIntent, queryName: string): ViewPlan {
  switch (intent.kind) {
    case "top-holders":
      return createHolderListPlan({
        contractAddress: intent.contractAddress,
        limit: intent.limit,
        queryName,
        rawText: intent.rawText,
      });
    case "balance":
      return createAddressBalancePlan({
        address: intent.address,
        queryName,
        rawText: intent.rawText,
        });
    case "holder-concentration":
      return createHolderConcentrationPlan({
        contractAddress: intent.contractAddress,
        limit: intent.limit,
        queryName,
        rawText: intent.rawText,
      });
    case "create-watch":
      return createBalanceWatchPlan({
        address: intent.address,
        label: intent.label,
        queryName,
        rawText: intent.rawText,
      });
  }
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

export async function evaluateHolderViewReadiness<T extends HolderListPlan | HolderConcentrationPlan>(
  plan: T,
  deps: HolderViewReadinessDeps,
): Promise<T> {
  if (!plan.viewSpec.contractAddress) {
    return plan;
  }

  const contract = await deps.inspectContract(plan.viewSpec.contractAddress);
  if (!contract.contractLabel) {
    return {
      ...plan,
      readiness: {
        contractAddress: plan.viewSpec.contractAddress,
        state: "needs-link",
        waitCondition: {
          reason: `Contract ${plan.viewSpec.contractAddress} is not linked in MultiBaas yet.`,
          state: "needs-link",
        },
      },
    };
  }

  if (contract.isProcessingPastLogs) {
    return {
      ...plan,
      readiness: {
        contractAddress: plan.viewSpec.contractAddress,
        contractLabel: contract.contractLabel,
        state: "syncing",
        waitCondition: {
          reason: `Contract ${plan.viewSpec.contractAddress} is still syncing historical events.`,
          state: "syncing",
        },
      },
    };
  }

  return {
    ...plan,
    readiness: {
      contractAddress: plan.viewSpec.contractAddress,
      contractLabel: contract.contractLabel,
      state: "ready",
    },
  };
}
