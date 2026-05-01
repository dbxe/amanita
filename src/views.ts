import { resolveConfig } from "./config.js";
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
  resolveBalanceSource,
  selectTopPositiveHolders,
  type BalanceRow,
} from "./multibaas.js";
import type { AddressBalancePlan, HolderConcentrationPlan, HolderListPlan } from "./planning.js";

export interface TopHoldersResult {
  contractAddress?: string;
  holders: Array<{ address: string; rawBalance: string }>;
  kind: "holder-list";
  limit: number;
  queryName: string;
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

export type AnalyticalViewPlan = AddressBalancePlan | HolderConcentrationPlan | HolderListPlan;
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
  const effectiveQueryName = resolveBalanceSource(config, queryName);
  const rows = await executeBalanceSourceQuery(config, effectiveQueryName, Math.min(limit, 100));

  return {
    contractAddress: getContractTargetFromBalanceSource(effectiveQueryName),
    holders: selectTopPositiveHolders(rows, limit).map((row) => ({
      address: row.address,
      rawBalance: row.rawBalance,
    })),
    kind: "holder-list",
    limit,
    queryName: effectiveQueryName,
  };
}

export async function getContractTopHolders(
  contractAddress: string,
  limit = 20,
  queryName?: string,
): Promise<TopHoldersResult> {
  const config = resolveConfig();
  const effectiveQueryName = queryName?.trim() || createContractBalanceSource(contractAddress);
  const rows = await executeContractBalanceQuery(config, contractAddress, Math.min(limit, 100));

  return {
    contractAddress,
    holders: selectTopPositiveHolders(rows, limit).map((row) => ({
      address: row.address,
      rawBalance: row.rawBalance,
    })),
    kind: "holder-list",
    limit,
    queryName: effectiveQueryName,
  };
}

export async function lookupBalance(address: string, queryName?: string): Promise<BalanceResult> {
  const config = resolveConfig();
  const effectiveQueryName = resolveBalanceSource(config, queryName);
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
  const effectiveQueryName = resolveBalanceSource(config, queryName);
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

export async function executeAnalyticalView(plan: AnalyticalViewPlan): Promise<AnalyticalViewResult> {
  switch (plan.kind) {
    case "holder-list":
      return plan.viewSpec.contractAddress
        ? getContractTopHolders(plan.viewSpec.contractAddress, plan.viewSpec.limit, plan.viewSpec.queryName)
        : getTopHolders(plan.viewSpec.limit, plan.viewSpec.queryName);
    case "address-balance":
      return lookupBalance(plan.viewSpec.address, plan.viewSpec.queryName);
    case "holder-concentration":
      return plan.viewSpec.contractAddress
        ? getContractHolderConcentration(plan.viewSpec.contractAddress, plan.viewSpec.limit, plan.viewSpec.queryName)
        : getHolderConcentration(plan.viewSpec.limit, plan.viewSpec.queryName);
  }
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
