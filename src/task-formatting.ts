import type { TaskState } from "./runtime-types.js";
import type { AlertRecord, LocalState, Watch } from "./state.js";
import type { TaskRecord } from "./tasks.js";

export interface TaskListResult {
  tasks: TaskRecord[];
}

export interface WatchListResult {
  watches: Array<Watch & { taskState?: TaskState }>;
}

export interface WatchSaveResult {
  address: string;
  task: TaskRecord;
  watch?: Watch;
}

export interface WebhookEnsureResult {
  id: number;
  label: string;
  secret?: string;
  subscriptions: string[];
  updatedAt: string;
  url: string;
}

function formatTaskLine(task: TaskRecord): string {
  const details = [`${task.id}  ${task.state}  ${task.title}`];
  if (task.waitCondition) {
    details.push(`reason=${task.waitCondition.reason}`);
  }
  if (task.capability === "balance-monitor" && task.watchId) {
    details.push(`watch=${task.watchId}`);
  }
  if (task.capability === "balance-monitor" && task.lastKnownBalance) {
    details.push(`balance=${task.lastKnownBalance}`);
  }
  if (task.capability === "holder-analysis" && task.viewSpec.contractAddress) {
    details.push(`contract=${task.viewSpec.contractAddress}`);
  }
  if (task.capability === "holder-analysis" && task.addressAlias) {
    details.push(`alias=${task.addressAlias}`);
  }
  if (task.capability === "holder-analysis" && task.contractLabel) {
    details.push(`interface=${task.contractLabel}`);
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
    lines.push(`Accepted request for ${result.address}; waiting because ${result.task.waitCondition.reason}`);
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
