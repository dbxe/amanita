import { listConfiguredBackends, resolveConfigForProfile, type ConfiguredBackendSummary, type RuntimeConfig } from "./config.js";
import { inspectContractInterfaces } from "./contract-interface-service.js";
import { inspectEventCapabilities, type EventInvestigationLead } from "./event-intelligence-service.js";
import { getErc20Metadata, resolveContractReadiness, type TokenMetadata } from "./multibaas.js";
import type { TaskState } from "./runtime-types.js";
import { resolveTokenTarget, type TokenTargetInput } from "./token-target-service.js";

export interface MultichainTargetInput extends TokenTargetInput {
  profileName: string;
  role?: string;
}

export interface MultichainTargetInspection {
  alias?: string;
  configuredBackend: ConfiguredBackendSummary;
  eventLeads: EventInvestigationLead[];
  linkedContracts: string[];
  metadata?: TokenMetadata;
  profileName: string;
  readinessState?: TaskState;
  resolvedAddress?: string;
  role?: string;
  unresolvedTokenName?: string;
}

export interface MultichainInspectionResult {
  backends: ConfiguredBackendSummary[];
  signals: string[];
  targets: MultichainTargetInspection[];
}

function summarizeLinkedContracts(inspection: Awaited<ReturnType<typeof inspectContractInterfaces>>): string[] {
  return inspection.linkedContracts.map((linked) =>
    `${linked.contractLabel}${linked.contractVersion ? ` ${linked.contractVersion}` : ""}`,
  );
}

function readinessSignal(profileName: string, readinessState?: TaskState): string | undefined {
  if (readinessState === "syncing") {
    return `${profileName} is still syncing historical events. Cross-chain comparisons may still move.`;
  }
  if (readinessState === "needs-link") {
    return `${profileName} is not linked yet. MultiBaas cannot answer historical questions there until onboarding completes.`;
  }
  if (readinessState === "needs-abi") {
    return `${profileName} still needs ABI/interface coverage before deeper inspection is possible.`;
  }
  return undefined;
}

function buildSignals(targets: MultichainTargetInspection[]): string[] {
  const signals = new Set<string>();

  for (const target of targets) {
    const signal = readinessSignal(target.profileName, target.readinessState);
    if (signal) {
      signals.add(signal);
    }
  }

  const resolvedMetadata = targets.filter((target) => target.metadata?.symbol);
  if (resolvedMetadata.length > 1) {
    const symbols = new Set(resolvedMetadata.map((target) => target.metadata?.symbol));
    if (symbols.size > 1) {
      signals.add("The selected targets do not share the same token symbol. Verify that the bridge-side contracts you chose are actually the intended pair.");
    }
  }

  const readyProfiles = targets.filter((target) => target.readinessState === "ready").map((target) => target.profileName);
  const waitingProfiles = targets.filter((target) => target.readinessState && target.readinessState !== "ready").map((target) => target.profileName);
  if (readyProfiles.length > 0 && waitingProfiles.length > 0) {
    signals.add(`Readiness is uneven across backends. Ready: ${readyProfiles.join(", ")}. Waiting: ${waitingProfiles.join(", ")}.`);
  }

  return [...signals];
}

async function inspectTargetOnBackend(
  target: MultichainTargetInput,
  config: RuntimeConfig,
): Promise<MultichainTargetInspection> {
  const configuredBackend = listConfiguredBackends().find((backend) => backend.profileName === target.profileName);
  if (!configuredBackend) {
    throw new Error(`Unknown backend profile: ${target.profileName}`);
  }

  const resolved = await resolveTokenTarget(target, config);
  if (resolved.unresolved) {
    return {
      configuredBackend,
      eventLeads: [],
      linkedContracts: [],
      profileName: target.profileName,
      role: target.role,
      unresolvedTokenName: resolved.tokenNameInput,
    };
  }

  if (!resolved.address) {
    return {
      configuredBackend,
      eventLeads: [],
      linkedContracts: [],
      profileName: target.profileName,
      role: target.role,
    };
  }

  const [readiness, metadata, interfaceInspection, eventCapabilities] = await Promise.all([
    resolveContractReadiness(config, resolved.address),
    getErc20Metadata(config, resolved.address).catch(() => undefined),
    inspectContractInterfaces(resolved.address, config),
    inspectEventCapabilities({ contractAddress: resolved.address }, config),
  ]);

  return {
    alias: resolved.alias ?? interfaceInspection.alias ?? readiness.alias,
    configuredBackend,
    eventLeads: eventCapabilities.leads,
    linkedContracts: summarizeLinkedContracts(interfaceInspection),
    metadata,
    profileName: target.profileName,
    readinessState: readiness.state,
    resolvedAddress: resolved.address,
    role: target.role,
  };
}

export async function inspectTargetsAcrossBackends(targets: MultichainTargetInput[]): Promise<MultichainInspectionResult> {
  if (targets.length === 0) {
    return {
      backends: listConfiguredBackends(),
      signals: [],
      targets: [],
    };
  }

  const backendMap = new Map<string, RuntimeConfig>();
  for (const target of targets) {
    if (!backendMap.has(target.profileName)) {
      backendMap.set(target.profileName, resolveConfigForProfile(target.profileName));
    }
  }

  const inspections = await Promise.all(
    targets.map((target) => inspectTargetOnBackend(target, backendMap.get(target.profileName)!)),
  );

  return {
    backends: listConfiguredBackends(),
    signals: buildSignals(inspections),
    targets: inspections,
  };
}

export function formatConfiguredBackends(backends: ConfiguredBackendSummary[]): string {
  if (backends.length === 0) {
    return "No MultiBaas backends are configured.";
  }

  return [
    "Configured backends",
    "",
    ...backends.map((backend) =>
      [
        `- ${backend.profileName}`,
        `  network=${backend.hardhatNetwork}`,
        ...(backend.chainName ? [`  chain=${backend.chainName}${backend.chainId !== undefined ? ` (${backend.chainId})` : ""}`] : []),
        `  baseUrl=${backend.baseUrl ?? "missing"}`,
        `  apiKey=${backend.hasApiKey ? "configured" : "missing"}`,
        `  stateDir=${backend.stateDir}`,
      ].join("\n"),
    ),
  ].join("\n");
}

export function formatMultichainInspection(result: MultichainInspectionResult): string {
  const lines = [
    "Multichain inspection",
    "",
    `Configured backends: ${result.backends.map((backend) => backend.profileName).join(", ") || "none"}`,
  ];

  if (result.targets.length === 0) {
    lines.push("", "No multichain targets were provided.");
    return lines.join("\n");
  }

  for (const target of result.targets) {
    lines.push("", `${target.role ? `${target.role}: ` : ""}${target.profileName}`);
    lines.push(`  network: ${target.configuredBackend.hardhatNetwork}`);
    if (target.resolvedAddress) {
      lines.push(`  address: ${target.resolvedAddress}`);
    }
    if (target.alias) {
      lines.push(`  alias: ${target.alias}`);
    }
    if (target.metadata?.name || target.metadata?.symbol) {
      lines.push(`  token: ${target.metadata?.name ?? "unknown"}${target.metadata?.symbol ? ` (${target.metadata.symbol})` : ""}`);
    }
    if (target.readinessState) {
      lines.push(`  readiness: ${target.readinessState}`);
    }
    if (target.linkedContracts.length > 0) {
      lines.push(`  linked: ${target.linkedContracts.join(", ")}`);
    }
    if (target.eventLeads.length > 0) {
      lines.push(`  event leads: ${target.eventLeads.map((lead) => lead.id).join(", ")}`);
    }
    if (target.unresolvedTokenName) {
      lines.push(`  unresolved token name: ${target.unresolvedTokenName}`);
    }
  }

  if (result.signals.length > 0) {
    lines.push("", "Signals");
    for (const signal of result.signals) {
      lines.push(`- ${signal}`);
    }
  }

  return lines.join("\n");
}
