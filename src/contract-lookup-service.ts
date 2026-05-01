import { resolveConfig } from "./config.js";
import { inspectContractInterfaces, type ContractInterfaceInspection } from "./contract-interface-service.js";
import {
  createContractDefinition,
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
  searchedAddress: string;
}

export interface ImportContractLookupCandidateResult {
  candidate: ContractLookupCandidateSummary;
  contractLabel: string;
  contractVersion: string;
  inspection: ContractInterfaceInspection;
  searchedAddress: string;
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
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("(409)")) {
      throw error;
    }

    const existing = await getContractDefinition(config, input.contractLabel);
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
      `- [${candidate.index}] ${candidate.name ?? "unnamed"} @ ${candidate.address}`,
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
