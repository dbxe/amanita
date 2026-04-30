import {
  evaluateBalanceWatches,
  formatAlerts,
  formatBalance,
  formatSavedWatch,
  formatTopHolders,
  formatWatches,
  getTopHolders,
  listBalanceWatches,
  lookupBalance,
  saveBalanceWatch,
} from "./agent-tools.js";

type Intent =
  | { kind: "top-holders"; limit: number }
  | { kind: "balance"; address: string }
  | { kind: "create-watch"; address: string; label?: string }
  | { kind: "list-watches" }
  | { kind: "evaluate-watches" };

const ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/;

export function parseIntent(text: string): Intent | null {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  const address = normalized.match(ADDRESS_PATTERN)?.[0];
  const topMatch = lower.match(/\btop\s+(\d+)\b.*\bholders?\b|\bholders?\b.*\btop\s+(\d+)\b/);

  if (/\b(list|show)\b.*\bwatches?\b/.test(lower) || /\bwhat\b.*\btracking\b/.test(lower)) {
    return { kind: "list-watches" };
  }

  if (/\b(evaluate|check|refresh)\b.*\bwatches?\b/.test(lower)) {
    return { kind: "evaluate-watches" };
  }

  if (/\btop\b.*\bholders?\b/.test(lower) || /\bholders?\b/.test(lower)) {
    const parsedLimit = Number.parseInt(topMatch?.[1] ?? topMatch?.[2] ?? "", 10);
    return {
      kind: "top-holders",
      limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20,
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
      '- "List watches"',
    ].join("\n");
  }

  switch (intent.kind) {
    case "top-holders":
      return formatTopHolders(await getTopHolders(intent.limit));
    case "balance":
      return formatBalance(await lookupBalance(intent.address));
    case "create-watch":
      return formatSavedWatch(await saveBalanceWatch(intent.address, intent.label));
    case "list-watches":
      return formatWatches(listBalanceWatches());
    case "evaluate-watches": {
      const result = await evaluateBalanceWatches();
      return formatAlerts(result.state, result.alerts);
    }
  }
}
