import type { TaskState, WaitCondition } from "./runtime-types.js";

export interface BalanceMonitorReadiness {
  currentBalance?: string;
  state: Exclude<TaskState, "monitoring">;
  waitCondition?: WaitCondition;
}

export interface BalanceReadinessDeps {
  lookupBalance: (address: string, queryName: string) => Promise<{ rawBalance: string }>;
}

export function classifyReadinessFailure(error: unknown): BalanceMonitorReadiness {
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

export async function evaluateBalanceMonitorReadiness(
  address: string,
  queryName: string,
  deps: BalanceReadinessDeps,
): Promise<BalanceMonitorReadiness> {
  try {
    const balance = await deps.lookupBalance(address, queryName);
    return {
      currentBalance: balance.rawBalance,
      state: "ready",
    };
  } catch (error) {
    return classifyReadinessFailure(error);
  }
}
