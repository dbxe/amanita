import { resolveConfig } from "./config.js";
import { evaluatePendingHolderQueries as evaluateStoredHolderQueries, requestTopHolders as requestStoredTopHolders } from "./holder-tasks.js";
import {
  getAddressRegistration,
  getContractDefinition,
  getErc20TokenName,
  getEventIndexingStatus,
  linkAddressToContract,
  listContractCatalog,
  listKnownAddresses,
  resolveBalanceSource,
  resolveKnownAddress,
  setAddressAlias,
} from "./multibaas.js";
import { ensureErc20HolderQueryReady } from "./onboarding.js";
import type { LocalState } from "./state.js";
import type { HolderQueryTaskRecord } from "./tasks.js";
import { executeAnalyticalView, formatAnalyticalViewResult } from "./views.js";

export interface HolderRequestInput {
  contractAddress?: string;
  limit: number;
  needsInterfaceClarification?: boolean;
  rawText: string;
  tokenName?: string;
}

export interface HolderRequestResult {
  responseText: string;
  task?: HolderQueryTaskRecord;
}

export interface HolderTaskEvaluationResult {
  messages: string[];
  state: LocalState;
}

async function executeAnalyticalViewFromTask(task: HolderQueryTaskRecord): Promise<string> {
  return formatAnalyticalViewResult(
    await executeAnalyticalView({
      executionPlan: task.executionPlan,
      intent: {
        contractAddress: task.viewSpec.contractAddress,
        kind: "top-holders",
        limit: task.viewSpec.limit,
        rawText: task.intent,
      },
      kind: "holder-list",
      readiness: {
        contractAddress: task.viewSpec.contractAddress,
        contractLabel: task.contractLabel,
        state: "ready",
      },
      title: task.title,
      viewSpec: task.viewSpec,
    }),
  );
}

export async function requestTopHolders(params: HolderRequestInput): Promise<HolderRequestResult> {
  const config = resolveConfig();
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
    resolveBalanceSource(config),
  );
}

export async function evaluatePendingHolderQueries(queryName?: string): Promise<HolderTaskEvaluationResult> {
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
    resolveBalanceSource(config, queryName),
  );
}
