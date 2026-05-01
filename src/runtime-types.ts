export type TaskState = "needs-abi" | "needs-link" | "syncing" | "ready" | "monitoring" | "blocked";

export interface WaitCondition {
  reason: string;
  state: Exclude<TaskState, "ready" | "monitoring">;
}

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

export type ViewSpec =
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
    };
