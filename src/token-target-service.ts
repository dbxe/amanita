import type { RuntimeConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import { createContractBalanceSource, resolveKnownAddress } from "./multibaas.js";

export interface TokenTargetInput {
  contractAddress?: string;
  tokenName?: string;
}

export interface ResolvedTokenTarget {
  address?: string;
  alias?: string;
  balanceSource?: string;
  tokenNameInput?: string;
  unresolved?: boolean;
}

export async function resolveTokenTarget(
  input: TokenTargetInput,
  config: RuntimeConfig = resolveConfig(),
): Promise<ResolvedTokenTarget> {
  if (input.contractAddress) {
    return {
      address: input.contractAddress,
      balanceSource: createContractBalanceSource(input.contractAddress),
    };
  }

  if (!input.tokenName) {
    return {};
  }

  const resolved = await resolveKnownAddress(config, input.tokenName);
  if (!resolved) {
    return {
      tokenNameInput: input.tokenName,
      unresolved: true,
    };
  }

  return {
    address: resolved.address,
    alias: resolved.alias,
    balanceSource: createContractBalanceSource(resolved.address),
    tokenNameInput: input.tokenName,
  };
}

export async function requireTokenTarget(
  input: TokenTargetInput,
  config: RuntimeConfig = resolveConfig(),
): Promise<{
  address: string;
  alias?: string;
  balanceSource: string;
}> {
  const resolved = await resolveTokenTarget(input, config);
  if (resolved.unresolved) {
    throw new Error(`Unknown token target: ${resolved.tokenNameInput}`);
  }

  if (!resolved.address || !resolved.balanceSource) {
    throw new Error("token contract address or known token name is required");
  }

  return {
    address: resolved.address,
    alias: resolved.alias,
    balanceSource: resolved.balanceSource,
  };
}
