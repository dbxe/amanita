import { resolveConfig } from "./config.js";
import { importBestContractLookupCandidateForAddress } from "./contract-lookup-service.js";
import {
  type ContractReadiness,
  getErc20Metadata,
  resolveContractReadiness,
} from "./multibaas.js";
import type { TokenTargetInput } from "./token-target-service.js";
import { resolveTokenTarget } from "./token-target-service.js";
import { getContractHolderConcentration, getContractTopHolders } from "./views.js";

export interface TokenInvestigationRequest extends TokenTargetInput {
  limit?: number;
}

export interface InvestigationSignal {
  severity: "high" | "medium" | "low";
  summary: string;
}

export interface TokenInvestigationResult {
  concentration?: Awaited<ReturnType<typeof getContractHolderConcentration>>;
  metadata?: Awaited<ReturnType<typeof getErc20Metadata>>;
  onboarding?: {
    candidateAddress: string;
    candidateName?: string;
    contractLabel: string;
    contractVersion: string;
  };
  readiness?: ContractReadiness;
  requestedLimit: number;
  resolvedAddress?: string;
  resolvedAlias?: string;
  signals: InvestigationSignal[];
  topHolders?: Awaited<ReturnType<typeof getContractTopHolders>>;
  unresolvedTokenName?: string;
}

function formatPercentFromRaw(rawBalance: string, totalTrackedBalance: string): string | undefined {
  const balance = BigInt(rawBalance);
  const total = BigInt(totalTrackedBalance);
  if (total <= 0n) {
    return undefined;
  }
  const basisPoints = Number((balance * 10_000n) / total);
  return `${(basisPoints / 100).toFixed(2)}%`;
}

function buildSignals(
  metadata: Awaited<ReturnType<typeof getErc20Metadata>> | undefined,
  concentration: Awaited<ReturnType<typeof getContractHolderConcentration>> | undefined,
  topHolders: Awaited<ReturnType<typeof getContractTopHolders>> | undefined,
): InvestigationSignal[] {
  const signals: InvestigationSignal[] = [];

  if (concentration) {
    if (concentration.concentrationBps >= 7_500) {
      signals.push({
        severity: "high",
        summary: `Top ${concentration.limit} holders control ${concentration.concentrationPct} of tracked supply.`,
      });
    } else if (concentration.concentrationBps >= 4_000) {
      signals.push({
        severity: "medium",
        summary: `Top ${concentration.limit} holders control ${concentration.concentrationPct} of tracked supply.`,
      });
    } else {
      signals.push({
        severity: "low",
        summary: `Top ${concentration.limit} holders control ${concentration.concentrationPct} of tracked supply.`,
      });
    }
  }

  if (topHolders && concentration && topHolders.holders.length > 0) {
    const leadHolder = topHolders.holders[0];
    const leadPct = formatPercentFromRaw(leadHolder.rawBalance, concentration.totalTrackedBalance);
    if (leadPct) {
      signals.push({
        severity: concentration.concentrationBps >= 7_500 ? "high" : "medium",
        summary: `The largest holder alone controls ${leadPct} of tracked supply.`,
      });
    }
  }

  if (metadata?.state === "syncing") {
    signals.push({
      severity: "medium",
      summary: "MultiBaas is still syncing historical events for this token, so analytics may still move.",
    });
  }

  if (metadata?.state === "needs-link") {
    signals.push({
      severity: "medium",
      summary: "This token is not linked in MultiBaas yet, so deeper analytics are not ready.",
    });
  }

  return signals;
}

export async function investigateToken(request: TokenInvestigationRequest): Promise<TokenInvestigationResult> {
  const requestedLimit = request.limit ?? 5;
  const resolved = await resolveTokenTarget(request);
  if (resolved.unresolved) {
    return {
      requestedLimit,
      signals: [],
      unresolvedTokenName: resolved.tokenNameInput,
    };
  }

  if (!resolved.address) {
    return {
      requestedLimit,
      signals: [],
    };
  }

  const config = resolveConfig();
  let readiness = await resolveContractReadiness(config, resolved.address);
  let onboarding: TokenInvestigationResult["onboarding"];

  if (request.contractAddress && readiness.state === "needs-link") {
    try {
      const imported = await importBestContractLookupCandidateForAddress({
        address: resolved.address,
      });
      onboarding = {
        candidateAddress: imported.candidate.address,
        candidateName: imported.candidate.name,
        contractLabel: imported.contractLabel,
        contractVersion: imported.contractVersion,
      };
      readiness = imported.inspection.readiness;
    } catch {
      // Leave the token in its original waiting state when lookup import is unavailable.
    }
  }

  const metadata = await getErc20Metadata(config, resolved.address);

  if (readiness.state !== "ready") {
    return {
      metadata,
      onboarding,
      readiness,
      requestedLimit,
      resolvedAddress: resolved.address,
      resolvedAlias: resolved.alias ?? readiness.alias,
      signals: buildSignals(metadata, undefined, undefined),
    };
  }

  const [concentration, topHolders] = await Promise.all([
    getContractHolderConcentration(resolved.address, requestedLimit, resolved.balanceSource),
    getContractTopHolders(resolved.address, requestedLimit, resolved.balanceSource),
  ]);

  return {
    concentration,
    metadata,
    onboarding,
    readiness,
    requestedLimit,
    resolvedAddress: resolved.address,
    resolvedAlias: resolved.alias ?? readiness.alias,
    signals: buildSignals(metadata, concentration, topHolders),
    topHolders,
  };
}

export function formatTokenInvestigation(result: TokenInvestigationResult): string {
  if (result.unresolvedTokenName) {
    return `I don't know the contract address for ${result.unresolvedTokenName} yet. Tell me the token contract address and I'll investigate it directly.`;
  }

  if (!result.resolvedAddress) {
    return "Tell me the token contract address or a known token name and I'll investigate it.";
  }

  const lines = [
    `Token investigation`,
    "",
    `Address: ${result.resolvedAddress}`,
  ];

  if (result.metadata?.name || result.metadata?.symbol) {
    lines.push(`Token: ${result.metadata?.name ?? "unknown"}${result.metadata?.symbol ? ` (${result.metadata.symbol})` : ""}`);
  }
  if (result.resolvedAlias) {
    lines.push(`Alias: ${result.resolvedAlias}`);
  }
  if (result.metadata?.decimals !== undefined) {
    lines.push(`Decimals: ${result.metadata.decimals}`);
  }
  if (result.metadata?.totalSupply) {
    lines.push(`Total supply (raw): ${result.metadata.totalSupply}`);
  }
  if (result.readiness) {
    lines.push(`Readiness: ${result.readiness.state}`);
  }
  if (result.onboarding) {
    lines.push(
      `Onboarding: imported ${result.onboarding.candidateName ?? "lookup candidate"} @ ${result.onboarding.candidateAddress} as ${result.onboarding.contractLabel} ${result.onboarding.contractVersion}`,
    );
  }

  if (result.concentration) {
    lines.push(
      `Top ${result.concentration.limit} concentration: ${result.concentration.concentrationPct} (${result.concentration.concentrationBps} bps)`,
    );
    lines.push(`Tracked holders: ${result.concentration.holderCount}`);
  }

  if (result.signals.length > 0) {
    lines.push("", "Signals");
    for (const signal of result.signals) {
      lines.push(`- [${signal.severity}] ${signal.summary}`);
    }
  }

  if (result.topHolders && result.topHolders.holders.length > 0) {
    lines.push("", `Top ${result.topHolders.limit} holders`);
    result.topHolders.holders.forEach((holder, index) => {
      lines.push(`${String(index + 1).padStart(2, " ")}. ${holder.address}  ${holder.rawBalance}`);
    });
  }

  return lines.join("\n");
}
