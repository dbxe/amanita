import type { RuntimeConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import {
  createContractDefinition,
  getAddressRegistration,
  getContractDefinition,
  linkAddressToContract,
  listContractCatalog,
  resolveContractReadiness,
  type AddressRegistration,
  type ContractCatalogEntry,
  type ContractDefinition,
} from "./multibaas.js";
import {
  contractDefinitionMatchesPreloadedInterface,
  getPreloadedInterface,
  listPreloadedInterfaces,
  type PreloadedInterfaceDefinition,
} from "./preloaded-interfaces.js";

export interface PreloadedInterfaceStatus {
  capabilityTags: string[];
  contractName: string;
  inCatalog: boolean;
  label: string;
  summary: string;
  version: string;
}

export interface LinkedInterfaceMatch {
  capabilityTags: string[];
  contractLabel: string;
  contractName?: string;
  contractVersion?: string;
  matchedPreloadedLabels: string[];
}

export interface ContractInterfaceInspection {
  address: string;
  alias?: string;
  linkedContracts: LinkedInterfaceMatch[];
  preloadedInterfaces: PreloadedInterfaceStatus[];
  readiness: Awaited<ReturnType<typeof resolveContractReadiness>>;
}

function toPreloadedStatus(
  preloaded: PreloadedInterfaceDefinition,
  catalog: ContractCatalogEntry[],
): PreloadedInterfaceStatus {
  const inCatalog = catalog.some(
    (entry) => entry.label === preloaded.label && (!preloaded.version || entry.version === preloaded.version),
  );
  return {
    capabilityTags: [...preloaded.capabilityTags],
    contractName: preloaded.contractName,
    inCatalog,
    label: preloaded.label,
    summary: preloaded.summary,
    version: preloaded.version,
  };
}

function matchLinkedDefinition(
  linkedContract: AddressRegistration["contracts"][number],
  definition: ContractDefinition,
  preloadedInterfaces: PreloadedInterfaceDefinition[],
): LinkedInterfaceMatch {
  return {
    capabilityTags: [
      ...new Set(
        preloadedInterfaces
          .filter((preloaded) => contractDefinitionMatchesPreloadedInterface(definition, preloaded))
          .flatMap((preloaded) => preloaded.capabilityTags),
      ),
    ],
    contractLabel: linkedContract.label,
    contractName: linkedContract.name ?? definition.contractName,
    contractVersion: linkedContract.version ?? definition.version,
    matchedPreloadedLabels: preloadedInterfaces
      .filter((preloaded) => contractDefinitionMatchesPreloadedInterface(definition, preloaded))
      .map((preloaded) => preloaded.label),
  };
}

export async function inspectContractInterfaces(
  addressOrAlias: string,
  config: RuntimeConfig = resolveConfig(),
): Promise<ContractInterfaceInspection> {
  const [registration, catalog, readiness] = await Promise.all([
    getAddressRegistration(config, addressOrAlias),
    listContractCatalog(config),
    resolveContractReadiness(config, addressOrAlias),
  ]);
  const preloadedInterfaces = listPreloadedInterfaces();
  const linkedDefinitions = await Promise.all(
    registration.contracts.map(async (linkedContract) => ({
      definition: await getContractDefinition(config, linkedContract.label),
      linkedContract,
    })),
  );

  return {
    address: registration.address,
    alias: registration.alias,
    linkedContracts: linkedDefinitions.map(({ definition, linkedContract }) =>
      matchLinkedDefinition(linkedContract, definition, preloadedInterfaces)),
    preloadedInterfaces: preloadedInterfaces.map((preloaded) => toPreloadedStatus(preloaded, catalog)),
    readiness,
  };
}

export async function getPreloadedInterfaceCatalogStatus(): Promise<PreloadedInterfaceStatus[]> {
  const config = resolveConfig();
  const catalog = await listContractCatalog(config);
  return listPreloadedInterfaces().map((preloaded) => toPreloadedStatus(preloaded, catalog));
}

export async function ensureContractInterfaceLink(input: {
  addressOrAlias: string;
  label: string;
  startingBlock?: string;
}, config: RuntimeConfig = resolveConfig()): Promise<ContractInterfaceInspection> {
  const preloaded = getPreloadedInterface(input.label);
  if (!preloaded) {
    throw new Error(`Unknown preloaded interface label: ${input.label}`);
  }

  const catalog = await listContractCatalog(config);
  const existsInCatalog = catalog.some((entry) => entry.label === preloaded.label);
  if (!existsInCatalog) {
    throw new Error(`MultiBaas does not have the preloaded interface definition ${preloaded.label} yet.`);
  }

  await linkAddressToContract(config, input.addressOrAlias, {
    label: preloaded.label,
    startingBlock: input.startingBlock ?? "0",
    version: preloaded.version,
  });

  return inspectContractInterfaces(input.addressOrAlias, config);
}

export async function preloadKnownInterfaces(labels?: string[]): Promise<PreloadedInterfaceStatus[]> {
  const config = resolveConfig();
  const selectedInterfaces = labels && labels.length > 0
    ? labels.map((label) => {
        const preloaded = getPreloadedInterface(label);
        if (!preloaded) {
          throw new Error(`Unknown preloaded interface label: ${label}`);
        }
        return preloaded;
      })
    : listPreloadedInterfaces();

  for (const preloaded of selectedInterfaces) {
    await createContractDefinition(config, {
      contractName: preloaded.contractName,
      label: preloaded.label,
      rawAbi: JSON.stringify(preloaded.abi),
      version: preloaded.version,
    });
  }

  const catalog = await listContractCatalog(config);
  return selectedInterfaces.map((preloaded) => toPreloadedStatus(preloaded, catalog));
}

export function formatPreloadedInterfaceStatuses(statuses: PreloadedInterfaceStatus[]): string {
  if (statuses.length === 0) {
    return "No preloaded interfaces selected.";
  }

  return statuses
    .map((status) =>
      [
        `${status.label} ${status.version}`,
        `  Contract: ${status.contractName}`,
        `  Present in catalog: ${status.inCatalog ? "yes" : "no"}`,
        `  Tags: ${status.capabilityTags.join(", ")}`,
        `  Summary: ${status.summary}`,
      ].join("\n"))
    .join("\n\n");
}

export function formatContractInterfaceInspection(inspection: ContractInterfaceInspection): string {
  const lines = [
    `Contract interface inspection`,
    "",
    `Address: ${inspection.address}`,
    ...(inspection.alias ? [`Alias: ${inspection.alias}`] : []),
    `Readiness: ${inspection.readiness.state}`,
  ];

  lines.push("", "Preloaded interfaces");
  for (const preloaded of inspection.preloadedInterfaces) {
    lines.push(`- ${preloaded.label} ${preloaded.version} [${preloaded.inCatalog ? "catalog" : "missing"}]`);
  }

  lines.push("", "Linked contracts");
  if (inspection.linkedContracts.length === 0) {
    lines.push("- none");
  } else {
    for (const linked of inspection.linkedContracts) {
      lines.push(`- ${linked.contractLabel}${linked.contractVersion ? ` ${linked.contractVersion}` : ""}`);
      if (linked.contractName) {
        lines.push(`  name: ${linked.contractName}`);
      }
      if (linked.matchedPreloadedLabels.length > 0) {
        lines.push(`  matches: ${linked.matchedPreloadedLabels.join(", ")}`);
      }
      if (linked.capabilityTags.length > 0) {
        lines.push(`  tags: ${linked.capabilityTags.join(", ")}`);
      }
    }
  }

  return lines.join("\n");
}
