import { resolveConfig } from "./config.js";
import { evaluatePendingHolderQueries as evaluateStoredHolderQueries, requestTopHolders as requestStoredTopHolders } from "./holder-tasks.js";
import {
  createContractBalanceSource,
  getAddressRegistration,
  getContractDefinition,
  getErc20TokenName,
  getEventIndexingStatus,
  linkAddressToContract,
  listContractCatalog,
  listKnownAddresses,
  resolveKnownAddress,
  setAddressAlias,
} from "./multibaas.js";
import { ensureErc20HolderQueryReady } from "./onboarding.js";
import type { LocalState } from "./state.js";
import type { HolderAnalysisTaskRecord } from "./tasks.js";
import { formatAnalyticalViewResult, formatTopHoldersEvidence, getContractTopHolders, getTopHolders } from "./views.js";

export interface HolderRequestInput {
  contractAddress?: string;
  limit: number;
  needsInterfaceClarification?: boolean;
  rawText: string;
  tokenName?: string;
}

export interface HolderRequestResult {
  responseText: string;
  task?: HolderAnalysisTaskRecord;
}

export interface HolderTaskEvaluationResult {
  messages: string[];
  state: LocalState;
}

export interface TopHoldersTargetRequest {
  contractAddress?: string;
  limit: number;
  tokenName?: string;
}

async function executeAnalyticalViewFromTask(task: HolderAnalysisTaskRecord): Promise<string> {
  if (task.viewSpec.contractAddress) {
    return formatTopHoldersEvidence(
      await getContractTopHolders(task.viewSpec.contractAddress, task.viewSpec.limit, task.viewSpec.queryName),
      {
        contractLabel: task.contractLabel,
        status: task.state === "syncing" ? "partial" : "ready",
        statusReason: task.waitCondition?.reason,
      },
    );
  }

  return formatAnalyticalViewResult(await getTopHolders(task.viewSpec.limit, task.viewSpec.queryName));
}

export async function requestTopHolders(params: HolderRequestInput): Promise<HolderRequestResult> {
  const config = resolveConfig();
  const effectiveQueryName =
    params.contractAddress?.trim()
      ? createContractBalanceSource(params.contractAddress)
      : undefined;
  return requestStoredTopHolders(
    config.stateDir,
    params,
    {
      ensureReady: (contractAddress) =>
        ensureErc20HolderQueryReady(contractAddress, {
          getAddress: (addressOrAlias) => getAddressRegistration(config, addressOrAlias),
          getContract: (label) => getContractDefinition(config, label),
          getContractName: (addressOrAlias, contract) => getErc20TokenName(config, addressOrAlias),
          getEventIndexingStatus: (addressOrAlias, contract) => getEventIndexingStatus(config, addressOrAlias, contract),
          linkAddressContract: (addressOrAlias, request) => linkAddressToContract(config, addressOrAlias, request),
          listContracts: () => listContractCatalog(config),
          listKnownAddresses: () => listKnownAddresses(config),
          setAddressAlias: (address, alias) => setAddressAlias(config, address, alias),
        }),
      executeHolderQuery: async (task) => executeAnalyticalViewFromTask(task),
      resolveTokenName: (tokenName) => resolveKnownAddress(config, tokenName),
    },
    effectiveQueryName,
  );
}

export async function getTopHoldersForTokenTarget(params: TopHoldersTargetRequest): Promise<string> {
  const rawText = params.contractAddress
    ? `Give me the top ${params.limit} holders for token ${params.contractAddress}`
    : params.tokenName
      ? `Give me the top ${params.limit} holders for token ${params.tokenName}`
      : "";

  return (
    await requestTopHolders({
      contractAddress: params.contractAddress,
      limit: params.limit,
      rawText,
      tokenName: params.tokenName,
    })
  ).responseText;
}

export async function evaluatePendingHolderQueries(): Promise<HolderTaskEvaluationResult> {
  const config = resolveConfig();
  return evaluateStoredHolderQueries(
    config.stateDir,
    {
      ensureReady: (contractAddress) =>
        ensureErc20HolderQueryReady(contractAddress, {
          getAddress: (addressOrAlias) => getAddressRegistration(config, addressOrAlias),
          getContract: (label) => getContractDefinition(config, label),
          getContractName: (addressOrAlias, contract) => getErc20TokenName(config, addressOrAlias),
          getEventIndexingStatus: (addressOrAlias, contract) => getEventIndexingStatus(config, addressOrAlias, contract),
          linkAddressContract: (addressOrAlias, request) => linkAddressToContract(config, addressOrAlias, request),
          listContracts: () => listContractCatalog(config),
          listKnownAddresses: () => listKnownAddresses(config),
          setAddressAlias: (address, alias) => setAddressAlias(config, address, alias),
        }),
      executeHolderQuery: async (task) => executeAnalyticalViewFromTask(task),
    },
  );
}
