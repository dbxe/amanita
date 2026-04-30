import {
  evaluatePendingHolderQueries,
  evaluateBalanceWatches,
  formatAlerts,
  formatSavedWatch,
  formatTasks,
  formatWatches,
  listTasks,
  listBalanceWatches,
  requestTopHolders,
  saveBalanceWatch,
} from "./agent-tools.js";
import { resolveConfig } from "./config.js";
import { createPlanFromIntent } from "./planning.js";
import { executeAnalyticalView, formatAnalyticalViewResult } from "./views.js";

type Intent =
  | { kind: "top-holders"; contractAddress?: string; limit: number; needsInterfaceClarification?: boolean; tokenName?: string }
  | { kind: "holder-concentration"; contractAddress?: string; limit: number }
  | { kind: "balance"; address: string }
  | { kind: "create-watch"; address: string; label?: string }
  | { kind: "list-watches" }
  | { kind: "list-tasks" }
  | { kind: "evaluate-watches" }
  | { kind: "evaluate-tasks" };

const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/;

export function parseIntent(text: string): Intent | null {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  const address = normalized.match(ADDRESS_PATTERN)?.[0];
  const topMatch = lower.match(/\btop\s+(\d+)\b.*\bholders?\b|\bholders?\b.*\btop\s+(\d+)\b/);
  const hasTopBalances = /\btop\b.*\bbalances?\b|\bbalances?\b.*\btop\b/.test(lower);
  const targetMatch = normalized.match(/\b(?:holders?|balances?)\b(?:\s+for|\s+of)\s+(?:token\s+|contract\s+)?([^?.!,]+)/i);
  const tokenName = !address ? targetMatch?.[1]?.trim() : undefined;

  if (/\b(list|show)\b.*\bwatches?\b/.test(lower) || /\bwhat\b.*\btracking\b/.test(lower)) {
    return { kind: "list-watches" };
  }

  if (/\b(list|show)\b.*\btasks?\b/.test(lower) || /\bwhat\b.*\bwaiting\b/.test(lower)) {
    return { kind: "list-tasks" };
  }

  if (/\b(evaluate|check|refresh)\b.*\btasks?\b/.test(lower)) {
    return { kind: "evaluate-tasks" };
  }

  if (/\b(evaluate|check|refresh)\b.*\bwatches?\b/.test(lower)) {
    return { kind: "evaluate-watches" };
  }

  if (/\bconcentration\b/.test(lower) && /\bholders?\b/.test(lower)) {
    const parsedLimit = Number.parseInt(topMatch?.[1] ?? topMatch?.[2] ?? "", 10);
    return {
      kind: "holder-concentration",
      limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5,
      ...(address ? { contractAddress: address } : {}),
    };
  }

  if (/\btop\b.*\bholders?\b/.test(lower) || /\bholders?\b/.test(lower)) {
    const parsedLimit = Number.parseInt(topMatch?.[1] ?? topMatch?.[2] ?? "", 10);
    return {
      kind: "top-holders",
      limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20,
      ...(address ? { contractAddress: address } : {}),
      ...(tokenName ? { tokenName } : {}),
    };
  }

  if (hasTopBalances) {
    return {
      kind: "top-holders",
      limit: 20,
      ...(address ? { contractAddress: address } : {}),
      ...(tokenName ? { tokenName } : {}),
      ...(address && !/\b(token|contract|erc[- ]?20)\b/.test(lower) ? { needsInterfaceClarification: true } : {}),
    };
  }

  if (address && /\b(alert|watch|notify|track)\b/.test(lower)) {
    const labelMatch = normalized.match(/\blabel\s+["']?([^"']+)["']?$/i);
    return {
      kind: "create-watch",
      address,
      label: labelMatch?.[1]?.trim(),
    };
  }

  if (address && /\bbalance\b/.test(lower)) {
    return { kind: "balance", address };
  }

  return null;
}

export async function handleIntent(text: string): Promise<string> {
  const intent = parseIntent(text);

  if (!intent) {
    return [
      "I couldn't map that request to a supported action yet.",
      "Try one of:",
      '- "Give me the top 5 holders"',
        '- "What is the balance of 0x...?"',
        '- "Alert me if the balance of 0x... moves"',
        '- "What is the top 5 holder concentration?"',
        '- "List watches"',
        '- "List tasks"',
      ].join("\n");
  }

    const queryName = resolveConfig().defaultQueryName;
  switch (intent.kind) {
    case "top-holders": {
      return (
        await requestTopHolders(
          {
            contractAddress: intent.contractAddress,
            limit: intent.limit,
            needsInterfaceClarification: intent.needsInterfaceClarification,
            rawText: text,
            tokenName: intent.tokenName,
          },
        )
      ).responseText;
    }
    case "holder-concentration": {
      const plan = createPlanFromIntent({ ...intent, rawText: text }, queryName);
      return formatAnalyticalViewResult(await executeAnalyticalView(plan));
    }
    case "balance": {
      const plan = createPlanFromIntent({ ...intent, rawText: text }, queryName);
      return formatAnalyticalViewResult(await executeAnalyticalView(plan));
    }
    case "create-watch": {
      const plan = createPlanFromIntent({ ...intent, rawText: text }, queryName);
      return formatSavedWatch(await saveBalanceWatch(plan.viewSpec.address, plan.intent.label, plan.viewSpec.queryName));
    }
    case "list-watches":
      return formatWatches(listBalanceWatches());
    case "list-tasks":
      return formatTasks(listTasks());
    case "evaluate-watches": {
      const result = await evaluateBalanceWatches();
      return formatAlerts(result.state, result.alerts);
    }
    case "evaluate-tasks": {
      const result = await evaluatePendingHolderQueries(queryName);
      return result.messages.length > 0 ? result.messages.join("\n\n") : "No pending holder queries completed.";
    }
  }
}
