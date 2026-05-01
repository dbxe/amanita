import { resolveConfig } from "./config.js";
import { resolveContractReadiness } from "./multibaas.js";
import { resolveTokenTarget, type TokenTargetInput } from "./token-target-service.js";
import { formatAnalyticalViewResult, getContractHolderConcentration, lookupBalance } from "./views.js";

export interface AddressBalanceRequest extends TokenTargetInput {
  address: string;
}

export interface HolderConcentrationRequest extends TokenTargetInput {
  limit: number;
}

function formatMissingTokenTarget(tokenName?: string): string {
  return tokenName
    ? `I don't know the contract address for ${tokenName} yet. Tell me the token contract address and I'll query it directly.`
    : "Tell me the token contract address or a known token name and I'll query it directly.";
}

function formatHistoricalReadinessBlock(params: {
  address: string;
  capability: "balance" | "holder concentration";
  state: "needs-link" | "syncing";
}): string {
  if (params.state === "needs-link") {
    return `This token is not linked in MultiBaas yet, so ${params.capability} analytics are not ready for ${params.address}.`;
  }

  return `MultiBaas is still syncing historical events for ${params.address}, so ${params.capability} analytics may still move.`;
}

export async function getAddressBalanceForTokenTarget(request: AddressBalanceRequest): Promise<string> {
  const target = await resolveTokenTarget(request);
  if (!target.address || !target.balanceSource) {
    return formatMissingTokenTarget(target.tokenNameInput);
  }

  const readiness = await resolveContractReadiness(resolveConfig(), target.address);
  if (readiness.state === "needs-link" || readiness.state === "syncing") {
    return formatHistoricalReadinessBlock({
      address: target.address,
      capability: "balance",
      state: readiness.state,
    });
  }

  return formatAnalyticalViewResult(await lookupBalance(request.address, target.balanceSource));
}

export async function getHolderConcentrationForTokenTarget(request: HolderConcentrationRequest): Promise<string> {
  const target = await resolveTokenTarget(request);
  if (!target.address || !target.balanceSource) {
    return formatMissingTokenTarget(target.tokenNameInput);
  }

  const readiness = await resolveContractReadiness(resolveConfig(), target.address);
  if (readiness.state === "needs-link" || readiness.state === "syncing") {
    return formatHistoricalReadinessBlock({
      address: target.address,
      capability: "holder concentration",
      state: readiness.state,
    });
  }

  return formatAnalyticalViewResult(
    await getContractHolderConcentration(target.address, request.limit, target.balanceSource),
  );
}
