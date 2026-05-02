import { resolveConfig, type RuntimeConfig } from "./config.js";
import {
  createContractBalanceSource,
  executeBalanceSourceQuery,
  executeContractBalanceQuery,
  executeSavedBalanceQuery,
  fetchBalanceSourceSnapshot,
  fetchContractBalanceSnapshot,
  fetchBalanceSnapshot,
  getAddressBalance,
  getContractTargetFromBalanceSource,
  getErc20TokenDecimals,
  getErc20TokenSymbol,
  normalizeTokenIdentifier,
  resolveBalanceSource,
  selectTopPositiveHolders,
  type BalanceRow,
} from "./multibaas.js";

export interface TopHoldersResult {
  contractAddress?: string;
  holders: Array<{ address: string; rawBalance: string }>;
  kind: "holder-list";
  limit: number;
  queryName: string;
  tokenDecimals?: number;
  tokenSymbol?: string;
}

export interface BalanceResult {
  address: string;
  balance: string;
  kind: "address-balance";
  queryName: string;
}

export interface HolderConcentrationResult {
  concentrationBps: number;
  concentrationPct: string;
  contractAddress?: string;
  coveredBalance: string;
  holderCount: number;
  holders: Array<{ address: string; rawBalance: string }>;
  kind: "holder-concentration";
  limit: number;
  queryName: string;
  totalTrackedBalance: string;
}

export type AnalyticalViewResult = BalanceResult | HolderConcentrationResult | TopHoldersResult;

function formatPercentFromBps(basisPoints: number): string {
  return `${(basisPoints / 100).toFixed(2)}%`;
}

export function computeHolderConcentration(
  rows: BalanceRow[],
  limit: number,
  queryName: string,
): HolderConcentrationResult {
  const positiveRows = rows.filter((row) => row.balance > 0n);
  const selected = selectTopPositiveHolders(rows, limit);
  const totalTrackedBalance = positiveRows.reduce((sum, row) => sum + row.balance, 0n);
  const coveredBalance = selected.reduce((sum, row) => sum + row.balance, 0n);
  const concentrationBps =
    totalTrackedBalance === 0n ? 0 : Number((coveredBalance * 10_000n) / totalTrackedBalance);

  return {
    concentrationBps,
    concentrationPct: formatPercentFromBps(concentrationBps),
    coveredBalance: coveredBalance.toString(),
    holderCount: positiveRows.length,
    holders: selected.map((row) => ({
      address: row.address,
      rawBalance: row.rawBalance,
    })),
    kind: "holder-concentration",
    limit,
    queryName,
    totalTrackedBalance: totalTrackedBalance.toString(),
  };
}

export async function getTopHolders(limit = 20, queryName?: string): Promise<TopHoldersResult> {
  const config = resolveConfig();
  const effectiveQueryName = resolveBalanceSource(queryName);
  const contractAddress = getContractTargetFromBalanceSource(effectiveQueryName);
  const [rows, tokenDecimals, tokenSymbol] = await Promise.all([
    executeBalanceSourceQuery(config, effectiveQueryName, Math.min(limit, 100)),
    contractAddress ? getErc20TokenDecimals(config, contractAddress) : undefined,
    contractAddress ? getErc20TokenSymbol(config, contractAddress) : undefined,
  ]);

  return {
    contractAddress,
    holders: selectTopPositiveHolders(rows, limit).map((row) => ({
      address: row.address,
      rawBalance: row.rawBalance,
    })),
    kind: "holder-list",
    limit,
    queryName: effectiveQueryName,
    tokenDecimals,
    tokenSymbol,
  };
}

export async function getContractTopHolders(
  contractAddress: string,
  limit = 20,
  queryName?: string,
): Promise<TopHoldersResult> {
  const config = resolveConfig();
  const effectiveQueryName = queryName?.trim() || createContractBalanceSource(contractAddress);
  const [rows, tokenDecimals, tokenSymbol] = await Promise.all([
    executeContractBalanceQuery(config, contractAddress, Math.min(limit, 100)),
    getErc20TokenDecimals(config, contractAddress),
    getErc20TokenSymbol(config, contractAddress),
  ]);

  return {
    contractAddress,
    holders: selectTopPositiveHolders(rows, limit).map((row) => ({
      address: row.address,
      rawBalance: row.rawBalance,
    })),
    kind: "holder-list",
    limit,
    queryName: effectiveQueryName,
    tokenDecimals,
    tokenSymbol,
  };
}

export async function lookupBalance(address: string, queryName?: string): Promise<BalanceResult> {
  const config = resolveConfig();
  const effectiveQueryName = resolveBalanceSource(queryName);
  const balance = await getAddressBalance(config, effectiveQueryName, address);

  return {
    address: balance.address,
    balance: balance.rawBalance,
    kind: "address-balance",
    queryName: effectiveQueryName,
  };
}

export async function getHolderConcentration(limit = 5, queryName?: string): Promise<HolderConcentrationResult> {
  const config = resolveConfig();
  const effectiveQueryName = resolveBalanceSource(queryName);
  const snapshot = await fetchBalanceSourceSnapshot(config, effectiveQueryName, config.scanLimit);
  return {
    ...computeHolderConcentration([...snapshot.values()], limit, effectiveQueryName),
    contractAddress: getContractTargetFromBalanceSource(effectiveQueryName),
  };
}

export async function getContractHolderConcentration(
  contractAddress: string,
  limit = 5,
  queryName?: string,
): Promise<HolderConcentrationResult> {
  const config = resolveConfig();
  const effectiveQueryName = queryName?.trim() || createContractBalanceSource(contractAddress);
  const snapshot = await fetchContractBalanceSnapshot(config, contractAddress, config.scanLimit);
  return {
    ...computeHolderConcentration([...snapshot.values()], limit, effectiveQueryName),
    contractAddress,
  };
}

export function formatTopHolders(result: TopHoldersResult): string {
  const lines = [`Top ${result.limit} holders`, ""];
  if (result.contractAddress) {
    lines.push(`Contract: ${result.contractAddress}`, "");
  }
  result.holders.forEach((row, index) => {
    lines.push(`${String(index + 1).padStart(2, " ")}. ${row.address}  ${row.rawBalance}`);
  });
  return lines.join("\n");
}

function formatHolderQueryTarget(result: TopHoldersResult, config: RuntimeConfig): string {
  const network = config.hardhatNetwork === "ethereum-mainnet" ? "Ethereum mainnet" : config.hardhatNetwork;
  const label = result.contractAddress ? `Token \`${result.contractAddress}\`` : `Source ${result.queryName}`;
  return `${config.profileName} (${network}) | ${label} / Transfer`;
}

function formatTokenLabel(label: string | undefined): string {
  if (!label) {
    return "ERC-20";
  }
  if (normalizeTokenIdentifier(label) === "arbtokenethereum") {
    return "L1 bridged ARB";
  }
  return label;
}

const DISPLAY_FRACTION_DIGITS = 6;

function groupIntegerDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatTokenBalance(rawBalance: string, decimals: number, symbol?: string): string {
  const normalized = rawBalance.trim();
  if (!/^-?\d+$/.test(normalized) || decimals < 0 || !Number.isSafeInteger(decimals)) {
    return rawBalance;
  }

  const raw = BigInt(normalized);
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const displayDecimals = Math.min(decimals, DISPLAY_FRACTION_DIGITS);
  const reductionFactor = 10n ** BigInt(decimals - displayDecimals);
  const rounded =
    reductionFactor === 1n
      ? absolute
      : (absolute + (reductionFactor / 2n)) / reductionFactor;

  if (absolute > 0n && rounded === 0n && displayDecimals > 0) {
    return `<0.${"0".repeat(displayDecimals - 1)}1${symbol?.trim() ? ` ${symbol.trim()}` : ""}`;
  }

  const digits = rounded.toString();
  const padded = displayDecimals > 0 && digits.length <= displayDecimals ? digits.padStart(displayDecimals + 1, "0") : digits;
  const splitIndex = displayDecimals === 0 ? padded.length : padded.length - displayDecimals;
  const integerPart = padded.slice(0, splitIndex) || "0";
  const fractionalPart = displayDecimals === 0 ? "" : padded.slice(splitIndex).replace(/0+$/, "");
  const amount = `${negative ? "-" : ""}${groupIntegerDigits(integerPart)}${fractionalPart ? `.${fractionalPart}` : ""}`;
  return symbol?.trim() ? `${amount} ${symbol.trim()}` : amount;
}

function formatHolderBalance(result: TopHoldersResult, rawBalance: string): string {
  return result.tokenDecimals === undefined
    ? rawBalance
    : formatTokenBalance(rawBalance, result.tokenDecimals, result.tokenSymbol);
}

export function formatTopHoldersEvidence(
  result: TopHoldersResult,
  options: {
    contractLabel?: string;
    status?: "partial" | "ready";
    statusReason?: string;
  } = {},
): string {
  const config = resolveConfig();
  const status = options.status ?? "ready";
  const lines = [
    status === "partial"
      ? `Verdict: current indexed top ${result.limit} holder snapshot; historical Transfer sync is still in progress, so rankings may move.`
      : `Verdict: top ${result.limit} holders from the event-backed holder view.`,
    "",
    "Checked",
    `- Network: ${config.hardhatNetwork === "ethereum-mainnet" ? "Ethereum mainnet" : config.hardhatNetwork} (\`${config.profileName}\`)`,
    ...(result.contractAddress ? [`- Token: ${formatTokenLabel(options.contractLabel)} \`${result.contractAddress}\``] : []),
    ...(result.tokenSymbol ? [`- Symbol: ${result.tokenSymbol}`] : []),
    ...(result.tokenDecimals === undefined ? [] : [`- Decimals: ${result.tokenDecimals}`]),
    "- Capability: ERC-20 holder reconstruction from Transfer events",
    ...(options.statusReason ? [`- Sync status: ${options.statusReason}`] : []),
    "",
    `Top ${result.limit} holders`,
    "",
  ];

  if (result.holders.length === 0) {
    lines.push("- No positive balances returned by the current indexed view.");
  } else {
    lines.push(
      `| Rank | Holder | ${result.tokenDecimals === undefined ? "Raw balance" : "Balance"} |`,
      "| ---: | --- | ---: |",
    );
    result.holders.forEach((row, index) => {
      lines.push(`| ${index + 1} | \`${row.address}\` | ${formatHolderBalance(result, row.rawBalance)} |`);
    });
  }

  lines.push(
    "",
    "```event_query",
    "query: multibaas.eventQuery",
    "purpose: reconstruct current ERC-20 holders from Transfer deltas",
    `stream: ${formatHolderQueryTarget(result, config)}`,
    "fields: from + to + value + block number + tx hash + timestamp",
    "aggregation: add value to `to`; subtract value from `from`; rank positive balances descending",
    ...(result.tokenDecimals === undefined
      ? []
      : [`post_processing: scale raw uint256 balance by token decimals (${result.tokenDecimals}) in the runtime formatter`]),
    `source: ${result.queryName}`,
    `limit: top ${result.limit} positive balances`,
    `status: ${status === "partial" ? "syncing historical events; partial indexed snapshot" : "ready"}`,
    "```",
    "",
    "Boundary: do not infer total supply, percentages, or concentration from this holder list alone. Use holder concentration for that.",
  );

  return lines.join("\n");
}

export function formatBalance(result: BalanceResult): string {
  const contractTarget = getContractTargetFromBalanceSource(result.queryName);
  return [
    contractTarget ? `Contract: ${contractTarget}` : `Query: ${result.queryName}`,
    `Address: ${result.address}`,
    `Balance: ${result.balance}`,
  ].join("\n");
}

export function formatHolderConcentration(result: HolderConcentrationResult): string {
  const lines = [
    `Top ${result.limit} holder concentration`,
    "",
    ...(result.contractAddress ? [`Contract: ${result.contractAddress}`, ""] : []),
    `Tracked supply: ${result.totalTrackedBalance}`,
    `Covered balance: ${result.coveredBalance}`,
    `Tracked holders: ${result.holderCount}`,
    `Concentration: ${result.concentrationPct} (${result.concentrationBps} bps)`,
  ];
  if (result.holders.length > 0) {
    lines.push("", "Top holders");
    result.holders.forEach((holder, index) => {
      lines.push(`${String(index + 1).padStart(2, " ")}. ${holder.address}  ${holder.rawBalance}`);
    });
  }
  return lines.join("\n");
}

export function formatAnalyticalViewResult(result: AnalyticalViewResult): string {
  switch (result.kind) {
    case "holder-list":
      return formatTopHolders(result);
    case "address-balance":
      return formatBalance(result);
    case "holder-concentration":
      return formatHolderConcentration(result);
  }
}
