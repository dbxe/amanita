import { resolveConfig } from "./config.js";
import { evaluatePendingHolderQueries, requestTopHolders } from "./holder-query-service.js";
import { createContractBalanceSource, resolveKnownAddress, resolveBalanceSource } from "./multibaas.js";
import { createPlanFromIntent } from "./planning.js";
import { loadState } from "./state.js";
import { formatAlerts, formatSavedWatch, formatTasks, formatWatches } from "./task-formatting.js";
import { evaluateBalanceWatches, listBalanceWatches, saveBalanceWatch } from "./watch-service.js";
import { executeAnalyticalView, formatAnalyticalViewResult } from "./views.js";

type Intent =
  | { kind: "top-holders"; contractAddress?: string; limit: number; needsInterfaceClarification?: boolean; tokenName?: string }
  | { kind: "holder-concentration"; contractAddress?: string; limit: number; tokenName?: string }
  | { kind: "balance"; address: string; contractAddress?: string; tokenName?: string }
  | { kind: "create-watch"; address: string; contractAddress?: string; label?: string; tokenName?: string }
  | { kind: "list-watches" }
  | { kind: "list-tasks" }
  | { kind: "evaluate-watches" }
  | { kind: "evaluate-tasks" };

const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/;
const ADDRESS_PATTERN_GLOBAL = /0x[a-fA-F0-9]{40}/g;

function parseTokenTarget(text: string): { contractAddress?: string; tokenName?: string } {
  const tokenTarget = text.match(/\bfor\s+(?:token|contract)\s+([^?.!,]+)/i)?.[1]?.trim();
  if (!tokenTarget) {
    return {};
  }

  const contractAddress = tokenTarget.match(ADDRESS_PATTERN)?.[0];
  return contractAddress ? { contractAddress } : { tokenName: tokenTarget };
}

async function resolveQueryNameForToken(contractAddress?: string, tokenName?: string): Promise<string> {
  if (contractAddress) {
    return createContractBalanceSource(contractAddress);
  }

  if (tokenName) {
    const resolved = await resolveKnownAddress(resolveConfig(), tokenName);
    if (!resolved) {
      throw new Error(`Unknown token target: ${tokenName}`);
    }
    return createContractBalanceSource(resolved.address);
  }

  return resolveBalanceSource(resolveConfig());
}

export function parseIntent(text: string): Intent | null {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  const addresses = normalized.match(ADDRESS_PATTERN_GLOBAL) ?? [];
  const address = addresses[0];
  const topMatch = lower.match(/\btop\s+(\d+)\b.*\bholders?\b|\bholders?\b.*\btop\s+(\d+)\b/);
  const hasTopBalances = /\btop\b.*\bbalances?\b|\bbalances?\b.*\btop\b/.test(lower);
  const targetMatch = normalized.match(/\b(?:holders?|balances?)\b(?:\s+for|\s+of)\s+(?:token\s+|contract\s+)?([^?.!,]+)/i);
  const explicitTokenTarget = parseTokenTarget(normalized);
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
      ...(explicitTokenTarget.contractAddress
        ? { contractAddress: explicitTokenTarget.contractAddress }
        : address
          ? { contractAddress: address }
          : {}),
      ...(explicitTokenTarget.tokenName ? { tokenName: explicitTokenTarget.tokenName } : {}),
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
      ...(explicitTokenTarget.contractAddress ? { contractAddress: explicitTokenTarget.contractAddress } : {}),
      label: labelMatch?.[1]?.trim(),
      ...(explicitTokenTarget.tokenName ? { tokenName: explicitTokenTarget.tokenName } : {}),
    };
  }

  if (address && /\bbalance\b/.test(lower)) {
    return {
      kind: "balance",
      address,
      ...(explicitTokenTarget.contractAddress ? { contractAddress: explicitTokenTarget.contractAddress } : {}),
      ...(explicitTokenTarget.tokenName ? { tokenName: explicitTokenTarget.tokenName } : {}),
    };
  }

  return null;
}

export async function handleIntent(text: string): Promise<string> {
  const intent = parseIntent(text);

  if (!intent) {
    return [
      "I couldn't map that request to a supported action yet.",
      "Try one of:",
      '- "Give me the top 5 holders for token 0x..."',
      '- "What is the balance of 0x... for token 0x...?"',
      '- "Alert me if the balance of 0x... moves for token 0x..."',
      '- "What is the top 5 holder concentration for token 0x...?"',
      '- "List watches"',
      '- "List tasks"',
    ].join("\n");
  }

  const config = resolveConfig();
  const queryName = config.defaultQueryName;

  try {
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
        const source = await resolveQueryNameForToken(intent.contractAddress, intent.tokenName);
        const plan = createPlanFromIntent({ ...intent, rawText: text }, source);
        return formatAnalyticalViewResult(await executeAnalyticalView(plan));
      }
      case "balance": {
        const source = await resolveQueryNameForToken(intent.contractAddress, intent.tokenName);
        const plan = createPlanFromIntent({ ...intent, rawText: text }, source);
        return formatAnalyticalViewResult(await executeAnalyticalView(plan));
      }
      case "create-watch": {
        const source = await resolveQueryNameForToken(intent.contractAddress, intent.tokenName);
        const plan = createPlanFromIntent({ ...intent, rawText: text }, source);
        return formatSavedWatch(await saveBalanceWatch(plan.viewSpec.address, plan.intent.label, plan.viewSpec.queryName));
      }
      case "list-watches":
        return formatWatches(listBalanceWatches());
      case "list-tasks":
        return formatTasks({ tasks: loadState(config.stateDir).tasks });
      case "evaluate-watches": {
        const result = await evaluateBalanceWatches();
        return formatAlerts(result.state, result.alerts);
      }
      case "evaluate-tasks": {
        const result = await evaluatePendingHolderQueries(queryName);
        return result.messages.length > 0 ? result.messages.join("\n\n") : "No pending holder queries completed.";
      }
    }
  } catch (error) {
    if (error instanceof Error && /Unknown token target:/i.test(error.message)) {
      const tokenName = error.message.replace(/^Unknown token target:\s*/i, "").trim();
      return `I don't know the contract address for ${tokenName} yet. Tell me the token contract address and I'll query it directly.`;
    }
    if (error instanceof Error && /saved query name or token contract address is required/i.test(error.message)) {
      return "Tell me the token contract address for that balance request and I'll query it directly.";
    }
    throw error;
  }
}
