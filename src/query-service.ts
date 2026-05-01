import { requireTokenTarget, type TokenTargetInput } from "./token-target-service.js";
import { formatAnalyticalViewResult, getContractHolderConcentration, lookupBalance } from "./views.js";

export interface AddressBalanceRequest extends TokenTargetInput {
  address: string;
}

export interface HolderConcentrationRequest extends TokenTargetInput {
  limit: number;
}

export async function getAddressBalanceForTokenTarget(request: AddressBalanceRequest): Promise<string> {
  const target = await requireTokenTarget(request);
  return formatAnalyticalViewResult(await lookupBalance(request.address, target.balanceSource));
}

export async function getHolderConcentrationForTokenTarget(request: HolderConcentrationRequest): Promise<string> {
  const target = await requireTokenTarget(request);
  return formatAnalyticalViewResult(
    await getContractHolderConcentration(target.address, request.limit, target.balanceSource),
  );
}
