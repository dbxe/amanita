import { normalizeAddress, normalizeTokenIdentifier, type KnownAddress } from "./multibaas.js";
import type { TaskState, WaitCondition } from "./runtime-types.js";

export interface AddressContractLink {
  label: string;
  name?: string;
  version?: string;
}

export interface AddressRecord {
  address: string;
  alias?: string;
  contracts: AddressContractLink[];
}

export interface ContractCatalogEntry {
  contractName?: string;
  label: string;
  version?: string;
}

export interface ContractDefinition {
  abi?: {
    events?: Record<string, unknown>;
    methods?: Record<string, unknown>;
  };
  label: string;
  version?: string;
}

export interface Erc20HolderOnboardingDeps {
  getAddress: (addressOrAlias: string) => Promise<AddressRecord>;
  getContract: (label: string) => Promise<ContractDefinition>;
  getContractName: (addressOrAlias: string, contract: string) => Promise<string | undefined>;
  getEventIndexingStatus: (addressOrAlias: string, contract: string) => Promise<{ isProcessingPastLogs: boolean }>;
  linkAddressContract: (
    addressOrAlias: string,
    request: { label: string; startingBlock: string; version?: string },
  ) => Promise<void>;
  listContracts: () => Promise<ContractCatalogEntry[]>;
  listKnownAddresses: () => Promise<KnownAddress[]>;
  setAddressAlias: (address: string, alias: string) => Promise<void>;
}

export interface Erc20HolderOnboardingResult {
  addressAlias?: string;
  contractAddress: string;
  contractLabel?: string;
  contractVersion?: string;
  state: Exclude<TaskState, "monitoring">;
  waitCondition?: WaitCondition;
}

export function createDeterministicAddressAlias(address: string): string {
  return `erc20-${normalizeAddress(address).slice(2)}`;
}

export function createContractNameAlias(tokenName: string): string | undefined {
  const alias = normalizeTokenIdentifier(tokenName);
  return alias.length > 0 ? alias : undefined;
}

export function contractSupportsErc20HolderView(contract: ContractDefinition): boolean {
  const events = contract.abi?.events ?? {};
  const methods = contract.abi?.methods ?? {};
  return (
    "Transfer(address,address,uint256)" in events &&
    "balanceOf(address)" in methods &&
    "totalSupply()" in methods
  );
}

function wait(state: WaitCondition["state"], reason: string): Erc20HolderOnboardingResult {
  return {
    contractAddress: "",
    state,
    waitCondition: { reason, state },
  };
}

function chooseAddressAlias(params: {
  address: string;
  knownAddresses: KnownAddress[];
  tokenName?: string;
}): string {
  const namedAlias = params.tokenName ? createContractNameAlias(params.tokenName) : undefined;
  if (namedAlias) {
    const collision = params.knownAddresses.some(
      (entry) =>
        normalizeTokenIdentifier(entry.alias) === namedAlias &&
        normalizeAddress(entry.address) !== normalizeAddress(params.address),
    );
    if (!collision) {
      return namedAlias;
    }
  }

  return createDeterministicAddressAlias(params.address);
}

export async function ensureErc20HolderQueryReady(
  contractAddress: string,
  deps: Erc20HolderOnboardingDeps,
): Promise<Erc20HolderOnboardingResult> {
  const normalizedAddress = normalizeAddress(contractAddress);
  const catalog = await deps.listContracts();
  const erc20Interface = catalog.find((entry) => entry.label === "erc20interface");
  let address = await deps.getAddress(normalizedAddress);
  const linkedContracts = [...address.contracts];

  for (const linkedContract of linkedContracts) {
    const definition = await deps.getContract(linkedContract.label);
    if (contractSupportsErc20HolderView(definition)) {
      const addressOrAlias = address.alias?.trim() ? address.alias : normalizedAddress;
      const status = await deps.getEventIndexingStatus(addressOrAlias, linkedContract.label);
      return {
        addressAlias: address.alias?.trim() || undefined,
        contractAddress: normalizedAddress,
        contractLabel: linkedContract.label,
        contractVersion: linkedContract.version ?? definition.version,
        state: status.isProcessingPastLogs ? "syncing" : "ready",
        waitCondition: status.isProcessingPastLogs
          ? {
              reason: `Contract ${normalizedAddress} is still syncing historical events.`,
              state: "syncing",
            }
          : undefined,
      };
    }
  }

  if (!erc20Interface) {
    const result = wait("needs-abi", "MultiBaas does not have an erc20interface contract definition yet.");
    return {
      ...result,
      contractAddress: normalizedAddress,
    };
  }

  const alias = address.alias?.trim()
    ? address.alias.trim()
    : chooseAddressAlias({
        address: normalizedAddress,
        knownAddresses: await deps.listKnownAddresses(),
        tokenName: await deps.getContractName(normalizedAddress, erc20Interface.label),
      });
  if (!address.alias?.trim()) {
    await deps.setAddressAlias(normalizedAddress, alias);
    address = await deps.getAddress(normalizedAddress);
  }

  const hasLinkedErc20Interface = address.contracts.some((contract) => contract.label === erc20Interface.label);
  if (!hasLinkedErc20Interface) {
    await deps.linkAddressContract(address.alias?.trim() || normalizedAddress, {
      label: erc20Interface.label,
      startingBlock: "0",
      version: erc20Interface.version,
    });
    address = await deps.getAddress(address.alias?.trim() || normalizedAddress);
  }

  const status = await deps.getEventIndexingStatus(address.alias?.trim() || normalizedAddress, erc20Interface.label);
  return {
    addressAlias: address.alias?.trim() || alias,
    contractAddress: normalizedAddress,
    contractLabel: erc20Interface.label,
    contractVersion: erc20Interface.version,
    state: status.isProcessingPastLogs ? "syncing" : "ready",
    waitCondition: status.isProcessingPastLogs
      ? {
          reason: `Contract ${normalizedAddress} is still syncing historical events.`,
          state: "syncing",
        }
      : undefined,
  };
}
