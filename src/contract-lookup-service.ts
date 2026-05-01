import { resolveConfig } from "./config.js";
import { inspectContractInterfaces, type ContractInterfaceInspection } from "./contract-interface-service.js";
import {
  createContractDefinition,
  getErc20Metadata,
  getContractDefinition,
  getContractLookupCandidates,
  linkAddressToContract,
  normalizeAddress,
  normalizeTokenIdentifier,
  type ContractLookupCandidate,
} from "./multibaas.js";

export interface ContractLookupCandidateSummary {
  abiEventCount: number;
  abiFunctionCount: number;
  address: string;
  hasBytecode: boolean;
  index: number;
  name?: string;
  proxy: boolean;
  sourceLength: number;
  verified: boolean;
  verifiedLink?: string;
  verifiedSource?: string;
}

export interface ContractLookupResult {
  candidates: ContractLookupCandidateSummary[];
  preferredCandidateIndex?: number;
  searchedAddress: string;
}

export interface ImportContractLookupCandidateResult {
  candidate: ContractLookupCandidateSummary;
  contractLabel: string;
  contractVersion: string;
  inspection: ContractInterfaceInspection;
  searchedAddress: string;
}

export interface ContractAddressInvestigationResult {
  importAttempted: boolean;
  importError?: string;
  importedCandidate?: ContractLookupCandidateSummary;
  importedContractLabel?: string;
  importedContractVersion?: string;
  inspection: ContractInterfaceInspection;
  lookup: ContractLookupResult;
  metadata?: Awaited<ReturnType<typeof getErc20Metadata>>;
}

function scoreLookupCandidate(candidate: ContractLookupCandidate): number {
  const functionCount = countAbiEntries(candidate.abi, "function");
  const eventCount = countAbiEntries(candidate.abi, "event");
  const proxyNamePenalty = /proxy/i.test(candidate.name ?? "") ? 5_000 : 0;

  return (
    (candidate.verified ? 100_000 : 0)
    + (functionCount * 100)
    + eventCount
    + (candidate.bytecode && candidate.bytecode !== "0x" ? 10 : 0)
    - proxyNamePenalty
  );
}

export function selectBestContractLookupCandidateIndex(candidates: ContractLookupCandidate[]): number {
  if (candidates.length === 0) {
    throw new Error("No contract lookup candidates were provided.");
  }

  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreLookupCandidate(candidate),
    }))
    .sort((left, right) => right.score - left.score)[0].index;
}

function countAbiEntries(abi: string, fragmentType: "event" | "function"): number {
  try {
    const parsed = JSON.parse(abi) as Array<{ type?: unknown }>;
    if (!Array.isArray(parsed)) {
      return 0;
    }
    return parsed.filter((entry) => entry?.type === fragmentType).length;
  } catch {
    return 0;
  }
}

function summarizeLookupCandidate(
  candidate: ContractLookupCandidate,
  index: number,
): ContractLookupCandidateSummary {
  return {
    abiEventCount: countAbiEntries(candidate.abi, "event"),
    abiFunctionCount: countAbiEntries(candidate.abi, "function"),
    address: candidate.address,
    hasBytecode: Boolean(candidate.bytecode && candidate.bytecode !== "0x"),
    index,
    name: candidate.name,
    proxy: candidate.proxy,
    sourceLength: candidate.source?.length ?? 0,
    verified: candidate.verified,
    verifiedLink: candidate.verifiedLink,
    verifiedSource: candidate.verifiedSource,
  };
}

function normalizeLookupLabel(value: string): string {
  const normalized = normalizeTokenIdentifier(value);
  if (!normalized) {
    throw new Error(`Unable to derive a contract label from "${value}"`);
  }
  return normalized;
}

async function chooseLookupImportLabel(
  candidate: ContractLookupCandidate,
  requestedLabel?: string,
): Promise<string> {
  const config = resolveConfig();

  if (requestedLabel?.trim()) {
    return normalizeLookupLabel(requestedLabel);
  }

  const baseLabel = normalizeLookupLabel(candidate.name ?? "contract");
  try {
    const existing = await getContractDefinition(config, baseLabel);
    if (
      candidate.name
      && existing.contractName
      && normalizeTokenIdentifier(existing.contractName) === normalizeTokenIdentifier(candidate.name)
    ) {
      return baseLabel;
    }
  } catch {
    return baseLabel;
  }

  return `${baseLabel}-${normalizeAddress(candidate.address).slice(2, 10)}`;
}

async function ensureLookupDefinition(input: {
  candidate: ContractLookupCandidate;
  contractLabel: string;
  contractVersion: string;
}): Promise<void> {
  const config = resolveConfig();

  try {
    await createContractDefinition(config, {
      bin: input.candidate.bytecode?.trim() || "0x",
      contractName: input.candidate.name ?? input.contractLabel,
      developerDoc: input.candidate.devdoc,
      label: input.contractLabel,
      metadata: input.candidate.source,
      rawAbi: input.candidate.abi,
      userDoc: input.candidate.userdoc,
      version: input.contractVersion,
    });
  } catch (error) {
    let existing;
    try {
      existing = await getContractDefinition(config, input.contractLabel);
    } catch {
      throw error;
    }

    if (
      input.candidate.name
      && existing.contractName
      && normalizeTokenIdentifier(existing.contractName) !== normalizeTokenIdentifier(input.candidate.name)
    ) {
      throw new Error(
        `Contract label ${input.contractLabel} already exists with a different contract name (${existing.contractName}).`,
      );
    }
  }
}

export async function lookupContractCandidatesForAddress(address: string): Promise<ContractLookupResult> {
  const normalizedAddress = normalizeAddress(address);
  const candidates = await getContractLookupCandidates(resolveConfig(), normalizedAddress);

  return {
    candidates: candidates.map((candidate, index) => summarizeLookupCandidate(candidate, index)),
    preferredCandidateIndex: candidates.length > 0 ? selectBestContractLookupCandidateIndex(candidates) : undefined,
    searchedAddress: normalizedAddress,
  };
}

export async function importContractLookupCandidateForAddress(input: {
  address: string;
  candidateIndex: number;
  contractLabel?: string;
  contractVersion?: string;
  startingBlock?: string;
}): Promise<ImportContractLookupCandidateResult> {
  const normalizedAddress = normalizeAddress(input.address);
  const candidates = await getContractLookupCandidates(resolveConfig(), normalizedAddress);
  const candidate = candidates[input.candidateIndex];
  if (!candidate) {
    throw new Error(`No contract lookup candidate at index ${input.candidateIndex} for ${normalizedAddress}.`);
  }

  const contractLabel = await chooseLookupImportLabel(candidate, input.contractLabel);
  const contractVersion = input.contractVersion?.trim() || "1.0";

  await ensureLookupDefinition({
    candidate,
    contractLabel,
    contractVersion,
  });

  try {
    await linkAddressToContract(resolveConfig(), normalizedAddress, {
      label: contractLabel,
      startingBlock: input.startingBlock?.trim() || "0",
      version: contractVersion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("(409)")) {
      throw error;
    }
  }

  return {
    candidate: summarizeLookupCandidate(candidate, input.candidateIndex),
    contractLabel,
    contractVersion,
    inspection: await inspectContractInterfaces(normalizedAddress),
    searchedAddress: normalizedAddress,
  };
}

export async function importBestContractLookupCandidateForAddress(input: {
  address: string;
  contractLabel?: string;
  contractVersion?: string;
  startingBlock?: string;
}): Promise<ImportContractLookupCandidateResult> {
  const normalizedAddress = normalizeAddress(input.address);
  const candidates = await getContractLookupCandidates(resolveConfig(), normalizedAddress);
  if (candidates.length === 0) {
    throw new Error(`No contract lookup candidates were returned for ${normalizedAddress}.`);
  }
  return importContractLookupCandidateForAddress({
    address: normalizedAddress,
    candidateIndex: selectBestContractLookupCandidateIndex(candidates),
    contractLabel: input.contractLabel,
    contractVersion: input.contractVersion,
    startingBlock: input.startingBlock,
  });
}

export async function investigateContractAddress(address: string): Promise<ContractAddressInvestigationResult> {
  const normalizedAddress = normalizeAddress(address);
  const [lookup, initialInspection] = await Promise.all([
    lookupContractCandidatesForAddress(normalizedAddress),
    inspectContractInterfaces(normalizedAddress),
  ]);

  let inspection = initialInspection;
  let importAttempted = false;
  let importError: string | undefined;
  let importedCandidate: ContractLookupCandidateSummary | undefined;
  let importedContractLabel: string | undefined;
  let importedContractVersion: string | undefined;

  if (inspection.readiness.state === "needs-link" && lookup.preferredCandidateIndex !== undefined) {
    importAttempted = true;
    try {
      const imported = await importContractLookupCandidateForAddress({
        address: normalizedAddress,
        candidateIndex: lookup.preferredCandidateIndex,
      });
      inspection = imported.inspection;
      importedCandidate = imported.candidate;
      importedContractLabel = imported.contractLabel;
      importedContractVersion = imported.contractVersion;
    } catch (error) {
      importError = error instanceof Error ? error.message : String(error);
    }
  }

  const metadata = inspection.readiness.state !== "needs-link"
    ? await getErc20Metadata(resolveConfig(), normalizedAddress).catch(() => undefined)
    : undefined;

  return {
    importAttempted,
    importError,
    importedCandidate,
    importedContractLabel,
    importedContractVersion,
    inspection,
    lookup,
    metadata,
  };
}

export function formatContractLookupResult(result: ContractLookupResult): string {
  const lines = [
    "Contract lookup candidates",
    "",
    `Address: ${result.searchedAddress}`,
  ];

  if (result.candidates.length === 0) {
    lines.push("", "No contract lookup candidates were returned for this address.");
    return lines.join("\n");
  }

  lines.push("", "Candidates");
  for (const candidate of result.candidates) {
    lines.push(
      `- [${candidate.index}] ${candidate.name ?? "unnamed"} @ ${candidate.address}${candidate.index === result.preferredCandidateIndex ? " [preferred]" : ""}`,
    );
    lines.push(
      `  verified=${candidate.verified ? "yes" : "no"}${candidate.verifiedSource ? ` source=${candidate.verifiedSource}` : ""} proxy=${candidate.proxy ? "yes" : "no"} functions=${candidate.abiFunctionCount} events=${candidate.abiEventCount}`,
    );
    if (candidate.verifiedLink) {
      lines.push(`  verifiedLink=${candidate.verifiedLink}`);
    }
  }

  return lines.join("\n");
}

export function formatImportContractLookupCandidateResult(result: ImportContractLookupCandidateResult): string {
  const lines = [
    "Imported contract lookup candidate",
    "",
    `Address: ${result.searchedAddress}`,
    `Candidate: [${result.candidate.index}] ${result.candidate.name ?? "unnamed"} @ ${result.candidate.address}`,
    `Contract label: ${result.contractLabel}`,
    `Contract version: ${result.contractVersion}`,
    `Readiness: ${result.inspection.readiness.state}`,
  ];

  if (result.inspection.linkedContracts.length > 0) {
    lines.push("", "Linked contracts");
    for (const linked of result.inspection.linkedContracts) {
      lines.push(`- ${linked.contractLabel}${linked.contractVersion ? ` ${linked.contractVersion}` : ""}`);
    }
  }

  return lines.join("\n");
}

export function formatContractAddressInvestigationResult(result: ContractAddressInvestigationResult): string {
  const lines = [
    "Contract address investigation",
    "",
    `Address: ${result.inspection.address}`,
    `Readiness: ${result.inspection.readiness.state}`,
  ];

  if (result.lookup.candidates.length > 0) {
    lines.push("", "Lookup candidates");
    for (const candidate of result.lookup.candidates) {
      lines.push(
        `- [${candidate.index}] ${candidate.name ?? "unnamed"} @ ${candidate.address}${candidate.index === result.lookup.preferredCandidateIndex ? " [preferred]" : ""}`,
      );
      lines.push(
        `  verified=${candidate.verified ? "yes" : "no"}${candidate.verifiedSource ? ` source=${candidate.verifiedSource}` : ""} proxy=${candidate.proxy ? "yes" : "no"} functions=${candidate.abiFunctionCount} events=${candidate.abiEventCount}`,
      );
    }
  } else {
    lines.push("", "Lookup candidates", "- none");
  }

  if (result.importAttempted) {
    if (result.importedCandidate && result.importedContractLabel && result.importedContractVersion) {
      lines.push(
        "",
        `Imported: [${result.importedCandidate.index}] ${result.importedCandidate.name ?? "unnamed"} as ${result.importedContractLabel} ${result.importedContractVersion}`,
      );
    } else if (result.importError) {
      lines.push("", `Import failed: ${result.importError}`);
    }
  }

  if (result.metadata?.name || result.metadata?.symbol) {
    lines.push(
      "",
      `Token: ${result.metadata?.name ?? "unknown"}${result.metadata?.symbol ? ` (${result.metadata.symbol})` : ""}`,
    );
    if (result.metadata?.decimals !== undefined) {
      lines.push(`Decimals: ${result.metadata.decimals}`);
    }
    if (result.metadata?.totalSupply) {
      lines.push(`Total supply (raw): ${result.metadata.totalSupply}`);
    }
  }

  if (result.inspection.linkedContracts.length > 0) {
    lines.push("", "Linked contracts");
    for (const linked of result.inspection.linkedContracts) {
      lines.push(`- ${linked.contractLabel}${linked.contractVersion ? ` ${linked.contractVersion}` : ""}`);
    }
  }

  return lines.join("\n");
}
