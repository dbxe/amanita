import type { RuntimeConfig } from "./config.js";
import { resolveConfig } from "./config.js";
import {
  executeArbitraryEventQueryRows,
  getAddressRegistration,
  getContractDefinition,
  getContractLookupCandidates,
  getErc20Metadata,
  resolveContractReadiness,
  type ContractDefinition,
  type ContractLookupCandidate,
  type ContractReadiness,
  type TokenMetadata,
} from "./multibaas.js";
import { selectBestContractLookupCandidateIndex } from "./contract-lookup-service.js";
import {
  buildAaveV3NetBorrowersEventViewSpec,
  buildAaveV3RecentActivityEventViewSpec,
  buildAaveV3TopLiquidatorsEventViewSpec,
  buildErc20BalanceEventViewSpec,
  buildStablecoinIssuerActivityEventViewSpec,
  buildTokenControlTimelineEventViewSpec,
  buildUniswapV3NetLiquidityEventViewSpec,
  buildUniswapV3RecentActivityEventViewSpec,
  compileEventViewSpec,
  type ContractTargetReference,
  type EventViewSpec,
} from "./event-view.js";
import type { TokenTargetInput } from "./token-target-service.js";
import { resolveTokenTarget } from "./token-target-service.js";

export type EventInvestigationLeadId =
  | "holder_distribution"
  | "token_control_timeline"
  | "stablecoin_issuer_activity"
  | "uniswap_v3_net_liquidity"
  | "uniswap_v3_recent_activity"
  | "aave_v3_net_borrowers"
  | "aave_v3_top_liquidators"
  | "aave_v3_recent_activity";

interface AbiSurface {
  contractLabel?: string;
  contractName?: string;
  eventNames: string[];
  methodNames: string[];
  source: "linked-contract" | "lookup-candidate";
}

export interface EventInvestigationLead {
  id: EventInvestigationLeadId;
  rationale: string;
  summary: string;
  title: string;
}

export interface EventCapabilityInspectionRequest extends TokenTargetInput {}

export interface EventCapabilityInspectionResult {
  eventNames: string[];
  leads: EventInvestigationLead[];
  metadata?: TokenMetadata;
  methodNames: string[];
  readiness?: ContractReadiness;
  resolvedAddress?: string;
  sourceContractLabel?: string;
  sourceContractName?: string;
  sourceKind?: AbiSurface["source"];
  unresolvedTokenName?: string;
}

export interface EventInvestigationRequest extends TokenTargetInput {
  leadId: EventInvestigationLeadId;
  limit?: number;
}

export interface EventInvestigationResult {
  lead?: EventInvestigationLead;
  limit: number;
  metadata?: TokenMetadata;
  readiness?: ContractReadiness;
  resolvedAddress?: string;
  rows: Array<Record<string, string>>;
  unresolvedTokenName?: string;
}

const LEAD_ORDER: EventInvestigationLeadId[] = [
  "stablecoin_issuer_activity",
  "token_control_timeline",
  "holder_distribution",
  "uniswap_v3_net_liquidity",
  "uniswap_v3_recent_activity",
  "aave_v3_net_borrowers",
  "aave_v3_top_liquidators",
  "aave_v3_recent_activity",
];

const EVENT_LEAD_LIBRARY: Record<EventInvestigationLeadId, {
  buildSpec: (target: ContractTargetReference) => EventViewSpec;
  predicate: (surface: { eventNames: Set<string>; methodNames: Set<string> }) => boolean;
  rationale: string;
  summary: string;
  title: string;
}> = {
  holder_distribution: {
    buildSpec: buildErc20BalanceEventViewSpec,
    predicate: ({ eventNames, methodNames }) => eventNames.has("Transfer") && methodNames.has("balanceOf"),
    rationale: "Transfer events plus balanceOf support event-sourced holder reconstruction instead of storage enumeration.",
    summary: "Reconstruct top holders from Transfer deltas.",
    title: "Holder distribution",
  },
  token_control_timeline: {
    buildSpec: buildTokenControlTimelineEventViewSpec,
    predicate: ({ eventNames }) =>
      ["Pause", "Unpause", "Paused", "Unpaused", "Blacklist", "UnBlacklist", "RoleGranted", "RoleRevoked", "OwnershipTransferred", "Upgraded", "AdminChanged"]
        .some((eventName) => eventNames.has(eventName)),
    rationale: "Control-surface changes are event-native and often not recoverable from current state alone.",
    summary: "Trace pauses, blacklist changes, upgrades, role grants, and ownership/admin changes.",
    title: "Control timeline",
  },
  stablecoin_issuer_activity: {
    buildSpec: buildStablecoinIssuerActivityEventViewSpec,
    predicate: ({ eventNames, methodNames }) =>
      eventNames.has("Mint")
      && eventNames.has("Burn")
      && (
        eventNames.has("Blacklist")
        || eventNames.has("UnBlacklist")
        || eventNames.has("Pause")
        || eventNames.has("Unpause")
        || methodNames.has("paused")
        || methodNames.has("isBlacklisted")
      ),
    rationale: "Mint and burn events expose issuer-side supply creation and redemption flows.",
    summary: "Inspect recent mint and burn activity by issuer-facing actors.",
    title: "Stablecoin issuer activity",
  },
  uniswap_v3_net_liquidity: {
    buildSpec: buildUniswapV3NetLiquidityEventViewSpec,
    predicate: ({ eventNames, methodNames }) =>
      eventNames.has("Mint") && eventNames.has("Burn") && eventNames.has("Swap") && methodNames.has("slot0"),
    rationale: "Mint/Burn deltas reveal who currently controls LP liquidity, even though positions are range-based.",
    summary: "Rank LP owners by net liquidity added minus removed.",
    title: "Uniswap v3 net liquidity",
  },
  uniswap_v3_recent_activity: {
    buildSpec: buildUniswapV3RecentActivityEventViewSpec,
    predicate: ({ eventNames, methodNames }) =>
      eventNames.has("Mint") && eventNames.has("Burn") && eventNames.has("Collect") && eventNames.has("Swap") && methodNames.has("slot0"),
    rationale: "Pool events show swaps, LP adds/removes, and fee collections without relying on NFT-manager joins.",
    summary: "Inspect the latest swaps, liquidity changes, and fee collections.",
    title: "Uniswap v3 recent activity",
  },
  aave_v3_net_borrowers: {
    buildSpec: buildAaveV3NetBorrowersEventViewSpec,
    predicate: ({ eventNames }) => eventNames.has("Borrow") && eventNames.has("Repay"),
    rationale: "Borrow and repay flows expose active borrower cohorts without reconstructing indexed debt balances.",
    summary: "Rank addresses by net borrow flow from Borrow minus Repay events.",
    title: "Aave v3 net borrowers",
  },
  aave_v3_top_liquidators: {
    buildSpec: buildAaveV3TopLiquidatorsEventViewSpec,
    predicate: ({ eventNames }) => eventNames.has("LiquidationCall"),
    rationale: "LiquidationCall exposes which actors are actually covering debt during stress episodes.",
    summary: "Rank liquidators by debt covered.",
    title: "Aave v3 top liquidators",
  },
  aave_v3_recent_activity: {
    buildSpec: buildAaveV3RecentActivityEventViewSpec,
    predicate: ({ eventNames }) =>
      ["Supply", "Withdraw", "Borrow", "Repay", "LiquidationCall"].every((eventName) => eventNames.has(eventName)),
    rationale: "Pool flow events expose recent supply, withdrawal, borrow, repay, and liquidation behavior.",
    summary: "Inspect the latest borrow/lend/liquidation flow events.",
    title: "Aave v3 recent activity",
  },
};

function toContractTargetReference(address: string): ContractTargetReference {
  return { kind: "address", value: address };
}

function stripSignatureName(signature: string): string {
  const trimmed = signature.trim();
  const openParen = trimmed.indexOf("(");
  return openParen === -1 ? trimmed : trimmed.slice(0, openParen);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}

function eventNamesFromDefinition(definition: ContractDefinition): string[] {
  return uniqueSorted(Object.keys(definition.abi?.events ?? {}).map((signature) => stripSignatureName(signature)));
}

function methodNamesFromDefinition(definition: ContractDefinition): string[] {
  return uniqueSorted(Object.keys(definition.abi?.methods ?? {}).map((signature) => stripSignatureName(signature)));
}

function eventNamesFromLookupCandidate(candidate: ContractLookupCandidate): string[] {
  try {
    const parsed = JSON.parse(candidate.abi) as Array<{ type?: unknown; name?: unknown }>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return uniqueSorted(
      parsed
        .filter((entry) => entry?.type === "event" && typeof entry.name === "string")
        .map((entry) => String(entry.name)),
    );
  } catch {
    return [];
  }
}

function methodNamesFromLookupCandidate(candidate: ContractLookupCandidate): string[] {
  try {
    const parsed = JSON.parse(candidate.abi) as Array<{ type?: unknown; name?: unknown }>;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return uniqueSorted(
      parsed
        .filter((entry) => entry?.type === "function" && typeof entry.name === "string")
        .map((entry) => String(entry.name)),
    );
  } catch {
    return [];
  }
}

async function resolveAbiSurface(address: string, config: RuntimeConfig): Promise<AbiSurface | undefined> {
  const registration = await getAddressRegistration(config, address);

  if (registration.contracts.length > 0) {
    const definitions = await Promise.all(
      registration.contracts.map((linkedContract) => getContractDefinition(config, linkedContract.label)),
    );

    return {
      contractLabel: registration.contracts.map((linkedContract) => linkedContract.label).join(", "),
      contractName: registration.contracts.map((linkedContract) => linkedContract.name).filter(Boolean).join(", ") || undefined,
      eventNames: uniqueSorted(definitions.flatMap((definition) => eventNamesFromDefinition(definition))),
      methodNames: uniqueSorted(definitions.flatMap((definition) => methodNamesFromDefinition(definition))),
      source: "linked-contract",
    };
  }

  const candidates = await getContractLookupCandidates(config, address);
  if (candidates.length === 0) {
    return undefined;
  }

  const preferredCandidate = candidates[selectBestContractLookupCandidateIndex(candidates)];
  return {
    contractName: preferredCandidate.name,
    eventNames: eventNamesFromLookupCandidate(preferredCandidate),
    methodNames: methodNamesFromLookupCandidate(preferredCandidate),
    source: "lookup-candidate",
  };
}

export function deriveEventInvestigationLeads(surface: {
  eventNames: Iterable<string>;
  methodNames: Iterable<string>;
}): EventInvestigationLead[] {
  const eventNames = new Set(uniqueSorted(surface.eventNames));
  const methodNames = new Set(uniqueSorted(surface.methodNames));

  return LEAD_ORDER.flatMap((id) => {
    const definition = EVENT_LEAD_LIBRARY[id];
    if (!definition.predicate({ eventNames, methodNames })) {
      return [];
    }

    return [{
      id,
      rationale: definition.rationale,
      summary: definition.summary,
      title: definition.title,
    }];
  });
}

function readinessBlocksHistoricalInvestigation(readiness?: ContractReadiness): boolean {
  return readiness?.state === "needs-link" || readiness?.state === "syncing";
}

function stringifyRowValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function normalizeRow(row: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const stringValue = stringifyRowValue(value);
    if (stringValue !== undefined) {
      normalized[key] = stringValue;
    }
  }
  return normalized;
}

function formatAggregatedLeaderboardRows(rows: Array<Record<string, string>>, valueKey: string): string[] {
  return rows.map((row, index) =>
    `${String(index + 1).padStart(2, " ")}. ${row.address ?? row.actor ?? "unknown"}  ${row[valueKey] ?? "0"}`,
  );
}

function formatActivityRows(rows: Array<Record<string, string>>, detailKeys: string[]): string[] {
  const lines: string[] = [];
  for (const row of rows) {
    const headline = `- ${row.event_signature ?? "unknown"}${row.block_number ? ` @ block ${row.block_number}` : ""}${row.triggered_at ? ` (${row.triggered_at})` : ""}`;
    const details = detailKeys
      .flatMap((key) => row[key] ? [`${key}=${row[key]}`] : [])
      .join("  ");
    lines.push(headline);
    if (details.length > 0) {
      lines.push(`  ${details}`);
    }
  }
  return lines;
}

export async function inspectEventCapabilities(
  request: EventCapabilityInspectionRequest,
  config: RuntimeConfig = resolveConfig(),
): Promise<EventCapabilityInspectionResult> {
  const resolved = await resolveTokenTarget(request, config);
  if (resolved.unresolved) {
    return {
      eventNames: [],
      leads: [],
      methodNames: [],
      unresolvedTokenName: resolved.tokenNameInput,
    };
  }

  if (!resolved.address) {
    return {
      eventNames: [],
      leads: [],
      methodNames: [],
    };
  }

  const [readiness, surface, metadata] = await Promise.all([
    resolveContractReadiness(config, resolved.address),
    resolveAbiSurface(resolved.address, config),
    getErc20Metadata(config, resolved.address).catch(() => undefined),
  ]);

  const leads = surface ? deriveEventInvestigationLeads(surface) : [];
  return {
    eventNames: surface?.eventNames ?? [],
    leads,
    metadata,
    methodNames: surface?.methodNames ?? [],
    readiness,
    resolvedAddress: resolved.address,
    sourceContractLabel: surface?.contractLabel,
    sourceContractName: surface?.contractName,
    sourceKind: surface?.source,
  };
}

export async function runEventInvestigation(
  request: EventInvestigationRequest,
  config: RuntimeConfig = resolveConfig(),
): Promise<EventInvestigationResult> {
  const limit = request.limit ?? 10;
  const resolved = await resolveTokenTarget(request, config);

  if (resolved.unresolved) {
    return {
      limit,
      rows: [],
      unresolvedTokenName: resolved.tokenNameInput,
    };
  }

  if (!resolved.address) {
    return {
      limit,
      rows: [],
    };
  }

  const [readiness, metadata, surface] = await Promise.all([
    resolveContractReadiness(config, resolved.address),
    getErc20Metadata(config, resolved.address).catch(() => undefined),
    resolveAbiSurface(resolved.address, config),
  ]);

  const lead = deriveEventInvestigationLeads({
    eventNames: surface?.eventNames ?? [],
    methodNames: surface?.methodNames ?? [],
  }).find((candidate) => candidate.id === request.leadId);

  if (!lead || readinessBlocksHistoricalInvestigation(readiness)) {
    return {
      lead,
      limit,
      metadata,
      readiness,
      resolvedAddress: resolved.address,
      rows: [],
    };
  }

  const rows = await executeArbitraryEventQueryRows(
    config,
    compileEventViewSpec(EVENT_LEAD_LIBRARY[request.leadId].buildSpec(toContractTargetReference(resolved.address))),
    limit,
  );

  return {
    lead,
    limit,
    metadata,
    readiness,
    resolvedAddress: resolved.address,
    rows: rows.map((row) => normalizeRow(row)),
  };
}

export function formatEventCapabilityInspection(result: EventCapabilityInspectionResult): string {
  if (result.unresolvedTokenName) {
    return `I don't know the contract address for ${result.unresolvedTokenName} yet. Tell me the contract address and I'll inspect its event capabilities directly.`;
  }

  if (!result.resolvedAddress) {
    return "Tell me the contract address or a known token name and I'll inspect its event capabilities.";
  }

  const lines = [
    "Event capability inspection",
    "",
    `Address: ${result.resolvedAddress}`,
  ];

  if (result.metadata?.name || result.metadata?.symbol) {
    lines.push(`Token: ${result.metadata?.name ?? "unknown"}${result.metadata?.symbol ? ` (${result.metadata.symbol})` : ""}`);
  }
  if (result.readiness) {
    lines.push(`Readiness: ${result.readiness.state}`);
  }
  if (result.sourceKind) {
    lines.push(`ABI source: ${result.sourceKind}`);
  }
  if (result.sourceContractName || result.sourceContractLabel) {
    lines.push(`Surface: ${result.sourceContractName ?? "unknown"}${result.sourceContractLabel ? ` (${result.sourceContractLabel})` : ""}`);
  }

  lines.push("", `Detected events: ${result.eventNames.length}`);
  if (result.eventNames.length > 0) {
    lines.push(`  ${result.eventNames.join(", ")}`);
  }

  lines.push("", `Detected methods: ${result.methodNames.length}`);
  if (result.methodNames.length > 0) {
    lines.push(`  ${result.methodNames.join(", ")}`);
  }

  lines.push("", "Supported investigation leads");
  if (result.leads.length === 0) {
    lines.push("- none");
  } else {
    for (const lead of result.leads) {
      lines.push(`- ${lead.id}: ${lead.summary}`);
      lines.push(`  Why: ${lead.rationale}`);
    }
    lines.push("No other bounded event investigation leads are supported for the currently detected ABI surface.");
  }

  return lines.join("\n");
}

export function formatEventInvestigation(result: EventInvestigationResult): string {
  if (result.unresolvedTokenName) {
    return `I don't know the contract address for ${result.unresolvedTokenName} yet. Tell me the contract address and I'll run the event investigation directly.`;
  }

  if (!result.resolvedAddress) {
    return "Tell me the contract address or a known token name and I'll run the event investigation.";
  }

  const title = result.lead?.title ?? result.lead?.id ?? "Event investigation";
  const lines = [
    title,
    "",
    `Address: ${result.resolvedAddress}`,
  ];

  if (result.metadata?.name || result.metadata?.symbol) {
    lines.push(`Token: ${result.metadata?.name ?? "unknown"}${result.metadata?.symbol ? ` (${result.metadata.symbol})` : ""}`);
  }
  if (result.readiness) {
    lines.push(`Readiness: ${result.readiness.state}`);
  }

  if (result.readiness?.state === "syncing") {
    lines.push("", "MultiBaas is still syncing historical events for this contract, so the event investigation is not complete yet.");
    return lines.join("\n");
  }

  if (result.readiness?.state === "needs-link") {
    lines.push("", "This contract is not linked in MultiBaas yet, so the event investigation is not ready.");
    return lines.join("\n");
  }

  if (!result.lead) {
    lines.push("", "The currently linked or discovered ABI surface does not support that investigation lead.");
    return lines.join("\n");
  }

  lines.push("", `Lead: ${result.lead.id}`);
  lines.push(`Why this matters: ${result.lead.rationale}`);

  if (result.rows.length === 0) {
    lines.push("", "No matching events were found in the queried window.");
    return lines.join("\n");
  }

  lines.push("", `Rows returned: ${result.rows.length}`);

  switch (result.lead.id) {
    case "holder_distribution":
      lines.push(...formatAggregatedLeaderboardRows(result.rows, "balance"));
      break;
    case "uniswap_v3_net_liquidity":
      lines.push(...formatAggregatedLeaderboardRows(result.rows, "liquidity"));
      break;
    case "aave_v3_net_borrowers":
      lines.push(...formatAggregatedLeaderboardRows(result.rows, "borrow_amount"));
      break;
    case "aave_v3_top_liquidators":
      lines.push(...formatAggregatedLeaderboardRows(result.rows, "debt_covered"));
      break;
    case "stablecoin_issuer_activity":
      lines.push(...formatActivityRows(result.rows, ["actor", "counterparty", "amount", "tx_hash"]));
      break;
    case "token_control_timeline":
      lines.push(...formatActivityRows(result.rows, ["account", "role", "sender", "new_owner", "new_admin", "implementation", "tx_hash"]));
      break;
    case "uniswap_v3_recent_activity":
      lines.push(...formatActivityRows(result.rows, ["actor", "counterparty", "amount0", "amount1", "liquidity", "tick", "tick_lower", "tick_upper", "tx_hash"]));
      break;
    case "aave_v3_recent_activity":
      lines.push(...formatActivityRows(result.rows, ["reserve", "actor", "counterparty", "amount", "tx_hash"]));
      break;
  }

  return lines.join("\n");
}
