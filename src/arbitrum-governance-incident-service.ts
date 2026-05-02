import { getArbitrumDaoActiveTargets, type ArbitrumDaoTargetDefinition } from "./arbitrum-dao-service.js";
import { resolveConfigForProfile, type RuntimeConfig } from "./config.js";
import {
  buildArbitrumGovernorLifecycleEventViewSpec,
  buildArbitrumGovernorProposalCreatedEventViewSpec,
  buildArbitrumTimelockOperationEventViewSpec,
  buildArbitrumUpgradeExecutorActivityEventViewSpec,
  compileEventViewSpec,
  type ContractTargetReference,
} from "./event-view.js";
import { executeArbitraryEventQueryRows, normalizeAddress } from "./multibaas.js";

export const ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES = [
  "brief",
  "verify-freeze",
  "proposal-status",
  "monitor",
] as const;

export type ArbitrumGovernanceIncidentFocus = (typeof ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES)[number];

export interface IncidentProposalEvent {
  blockNumber?: string;
  calldatas?: string;
  description?: string;
  matchedMarkers: string[];
  proposalId?: string;
  proposer?: string;
  targetLabels: string[];
  targets?: string;
  title?: string;
  triggeredAt?: string;
  txHash?: string;
  values?: string;
}

export interface IncidentControlEvent {
  blockNumber?: string;
  calldataHex?: string;
  calldataSelector?: string;
  contractLabel?: string;
  delaySeconds?: string;
  eventSignature?: string;
  operationId?: string;
  target?: string;
  targetLabel?: string;
  triggeredAt?: string;
  txHash?: string;
  valueEth?: string;
  valueWei?: string;
}

export interface IncidentProposalStatus {
  matches: IncidentProposalEvent[];
  recent: IncidentProposalEvent[];
  searchedCount: number;
}

export interface IncidentMonitorPlan {
  agentSideFilters: string[];
  directDescriptionFilteringSupported: boolean;
  eventName: string;
  followUpAnalysis: string[];
  network: string;
  profileName: string;
  targetAddress: string;
  targetLabel: string;
}

export interface ArbitrumGovernanceIncidentAnalysis {
  evidenceBoundaries: string[];
  focus: ArbitrumGovernanceIncidentFocus;
  l1TimelockOperations?: IncidentControlEvent[];
  l1UpgradeExecutorEvents?: IncidentControlEvent[];
  limit: number;
  monitorPlan?: IncidentMonitorPlan;
  proposalStatus?: IncidentProposalStatus;
}

const DEFAULT_LIMIT = 5;
const EVENT_QUERY_PAGE_LIMIT = 20;
const PROPOSAL_SEARCH_LIMIT = 100;

const INCIDENT_MARKERS = [
  "Kelp",
  "rsETH",
  "frozen ETH",
  "DeFi United",
  "30765",
  "30,765",
  "0x0000000000000000000000000000000000000DA0",
] as const;

const FROZEN_ETH_ADDRESS = "0x0000000000000000000000000000000000000DA0";

function targetReference(address: string): ContractTargetReference {
  return { kind: "address", value: address };
}

function targetById(id: ArbitrumDaoTargetDefinition["id"]): ArbitrumDaoTargetDefinition {
  const target = getArbitrumDaoActiveTargets().find((candidate) => candidate.id === id);
  if (!target) {
    throw new Error(`Missing Arbitrum DAO target ${id}`);
  }
  return target;
}

function knownAddressLabels(): Map<string, string> {
  const labels = new Map<string, string>();
  for (const target of getArbitrumDaoActiveTargets()) {
    labels.set(normalizeAddress(target.contractAddress), target.roleLabel);
  }
  labels.set(normalizeAddress(FROZEN_ETH_ADDRESS), "Frozen ETH address");
  return labels;
}

function labelAddress(address: unknown, labels = knownAddressLabels()): string | undefined {
  if (typeof address !== "string" || !address.startsWith("0x")) {
    return undefined;
  }
  return labels.get(normalizeAddress(address));
}

function rowString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

function titleFromDescription(description?: string): string | undefined {
  if (!description) {
    return undefined;
  }
  const firstLine = description.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  return firstLine || undefined;
}

export function matchIncidentMarkers(text: string): string[] {
  const normalized = text.toLowerCase();
  return INCIDENT_MARKERS.filter((marker) => normalized.includes(marker.toLowerCase()));
}

function parseAddressList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return [...value.matchAll(/0x[0-9a-fA-F]{40}/g)].map((match) => normalizeAddress(match[0]));
}

function toProposalEvent(row: Record<string, unknown>): IncidentProposalEvent {
  const description = rowString(row, "description");
  const labels = knownAddressLabels();
  const targetLabels = parseAddressList(rowString(row, "targets"))
    .map((address) => labels.get(address))
    .filter((label): label is string => Boolean(label));

  return {
    blockNumber: rowString(row, "block_number"),
    calldatas: rowString(row, "calldatas"),
    description,
    matchedMarkers: matchIncidentMarkers([
      description,
      rowString(row, "targets"),
      rowString(row, "values"),
      rowString(row, "calldatas"),
    ].filter(Boolean).join("\n")),
    proposalId: rowString(row, "proposal_id"),
    proposer: rowString(row, "proposer"),
    targetLabels,
    targets: rowString(row, "targets"),
    title: titleFromDescription(description),
    triggeredAt: rowString(row, "triggered_at"),
    txHash: rowString(row, "tx_hash"),
    values: rowString(row, "values"),
  };
}

function parseByteArrayString(value: string): string | undefined {
  if (!value.startsWith("[") || !value.endsWith("]")) {
    return undefined;
  }

  const bytes = value.match(/-?\d+/g)?.map((part) => Number.parseInt(part, 10)) ?? [];
  if (bytes.length === 0 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    return undefined;
  }

  return `0x${Buffer.from(bytes).toString("hex")}`;
}

export function bytesValueToHex(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  if (/^0x[0-9a-fA-F]*$/.test(value)) {
    return value.toLowerCase();
  }

  const byteArrayHex = parseByteArrayString(value);
  if (byteArrayHex) {
    return byteArrayHex;
  }

  const compact = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    return undefined;
  }

  const decoded = Buffer.from(compact, "base64");
  if (decoded.length === 0) {
    return "0x";
  }
  return `0x${decoded.toString("hex")}`;
}

export function calldataSelector(calldataHex?: string): string | undefined {
  if (!calldataHex || !/^0x[0-9a-f]{8}/i.test(calldataHex)) {
    return undefined;
  }
  const selector = calldataHex.slice(0, 10).toLowerCase();
  return selector === "0x00000000" ? undefined : selector;
}

function formatWeiAsEth(valueWei?: string): string | undefined {
  if (!valueWei || !/^\d+$/.test(valueWei)) {
    return undefined;
  }

  const wei = BigInt(valueWei);
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = wei % 1_000_000_000_000_000_000n;
  if (fraction === 0n) {
    return `${whole.toString()} ETH`;
  }

  const fractionText = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText} ETH`;
}

function toControlEvent(row: Record<string, unknown>): IncidentControlEvent {
  const calldataHex = bytesValueToHex(rowString(row, "data"));
  const target = rowString(row, "target");
  const valueWei = rowString(row, "value");

  return {
    blockNumber: rowString(row, "block_number"),
    calldataHex,
    calldataSelector: calldataSelector(calldataHex),
    contractLabel: rowString(row, "contract_label"),
    delaySeconds: rowString(row, "delay"),
    eventSignature: rowString(row, "event_signature"),
    operationId: bytesValueToHex(rowString(row, "operation_id")),
    target,
    targetLabel: labelAddress(target),
    triggeredAt: rowString(row, "triggered_at"),
    txHash: rowString(row, "tx_hash"),
    valueEth: formatWeiAsEth(valueWei),
    valueWei,
  };
}

async function fetchEventRows(
  config: RuntimeConfig,
  query: ReturnType<typeof compileEventViewSpec>,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  while (rows.length < limit) {
    const pageLimit = Math.min(EVENT_QUERY_PAGE_LIMIT, limit - rows.length);
    const page = await executeArbitraryEventQueryRows(config, query, pageLimit, rows.length);
    rows.push(...page);
    if (page.length < pageLimit) {
      break;
    }
  }
  return rows;
}

async function getProposalStatus(limit: number): Promise<IncidentProposalStatus> {
  const coreGovernor = targetById("core_governor");
  const config = resolveConfigForProfile(coreGovernor.profileName);
  const rows = await fetchEventRows(
    config,
    compileEventViewSpec(buildArbitrumGovernorProposalCreatedEventViewSpec(targetReference(coreGovernor.contractAddress))),
    PROPOSAL_SEARCH_LIMIT,
  );
  const proposals = rows.map(toProposalEvent);

  return {
    matches: proposals.filter((proposal) => proposal.matchedMarkers.length > 0),
    recent: proposals.slice(0, limit),
    searchedCount: proposals.length,
  };
}

async function getL1UpgradeExecutorEvents(limit: number): Promise<IncidentControlEvent[]> {
  const upgradeExecutor = targetById("l1_upgrade_executor");
  const config = resolveConfigForProfile(upgradeExecutor.profileName);
  const rows = await fetchEventRows(
    config,
    compileEventViewSpec(buildArbitrumUpgradeExecutorActivityEventViewSpec(targetReference(upgradeExecutor.contractAddress))),
    limit,
  );
  return rows.map(toControlEvent);
}

async function getL1TimelockOperations(limit: number): Promise<IncidentControlEvent[]> {
  const timelock = targetById("l1_timelock");
  const config = resolveConfigForProfile(timelock.profileName);
  const rows = await fetchEventRows(
    config,
    compileEventViewSpec(buildArbitrumTimelockOperationEventViewSpec(targetReference(timelock.contractAddress))),
    limit,
  );
  return rows.map(toControlEvent);
}

export function parseArbitrumGovernanceIncidentFocus(value: string | undefined): ArbitrumGovernanceIncidentFocus {
  if (!value) {
    return "brief";
  }
  if ((ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES as readonly string[]).includes(value)) {
    return value as ArbitrumGovernanceIncidentFocus;
  }
  throw new Error(
    `Unsupported Arbitrum governance incident focus "${value}". Expected one of: ${ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES.join(", ")}`,
  );
}

function buildMonitorPlan(): IncidentMonitorPlan {
  const coreGovernor = targetById("core_governor");
  return {
    agentSideFilters: [...INCIDENT_MARKERS],
    directDescriptionFilteringSupported: false,
    eventName: "ProposalCreated",
    followUpAnalysis: [
      "inspect proposal ID, proposer, targets, values, calldata, and description",
      "label known Arbitrum DAO control contracts and the frozen ETH address",
      "watch for later ProposalQueued, CallScheduled, and CallExecuted events",
      "check whether L1 timelock or L1 upgrade executor activity appears",
    ],
    network: coreGovernor.chainLabel,
    profileName: coreGovernor.profileName,
    targetAddress: coreGovernor.contractAddress,
    targetLabel: coreGovernor.roleLabel,
  };
}

export async function analyzeArbitrumGovernanceIncident(
  input: {
    focus?: ArbitrumGovernanceIncidentFocus;
    limit?: number;
  } = {},
): Promise<ArbitrumGovernanceIncidentAnalysis> {
  const focus = input.focus ?? "brief";
  const limit = input.limit ?? DEFAULT_LIMIT;
  const result: ArbitrumGovernanceIncidentAnalysis = {
    evidenceBoundaries: [
      "This investigates the governance response and next onchain transition, not the full KelpDAO exploit.",
      "MultiBaas event queries can return decoded proposal, vote, timelock, and executor events; free-text incident matching is applied locally.",
      "Do not treat a public forum proposal as binding onchain evidence unless a matching Core Governor ProposalCreated event is found.",
    ],
    focus,
    limit,
  };

  if (focus === "brief" || focus === "proposal-status" || focus === "monitor") {
    result.proposalStatus = await getProposalStatus(limit);
  }

  if (focus === "verify-freeze") {
    const [l1UpgradeExecutorEvents, l1TimelockOperations] = await Promise.all([
      getL1UpgradeExecutorEvents(limit),
      getL1TimelockOperations(limit),
    ]);
    result.l1UpgradeExecutorEvents = l1UpgradeExecutorEvents;
    result.l1TimelockOperations = l1TimelockOperations;
  }

  if (focus === "monitor") {
    result.monitorPlan = buildMonitorPlan();
  }

  return result;
}

function shortId(value?: string, length = 24): string {
  if (!value) {
    return "unknown";
  }
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function formatProposal(proposal: IncidentProposalEvent): string {
  const details = [
    proposal.triggeredAt,
    proposal.title ?? "untitled proposal",
    `proposal=${shortId(proposal.proposalId)}`,
    proposal.txHash ? `tx=${proposal.txHash}` : undefined,
    proposal.matchedMarkers.length > 0 ? `markers=${proposal.matchedMarkers.join(", ")}` : undefined,
  ].filter(Boolean);
  return `- ${details.join(" | ")}`;
}

function formatControlEvent(event: IncidentControlEvent): string {
  const target = event.target
    ? `${event.target}${event.targetLabel ? ` (${event.targetLabel})` : ""}`
    : "unknown target";
  const details = [
    event.triggeredAt,
    event.eventSignature,
    `target=${target}`,
    event.calldataSelector ? `selector=${event.calldataSelector}` : undefined,
    event.valueEth ? `value=${event.valueEth}` : undefined,
    event.delaySeconds ? `delay=${event.delaySeconds}s` : undefined,
    event.txHash ? `tx=${event.txHash}` : undefined,
  ].filter(Boolean);
  return `- ${details.join(" | ")}`;
}

export function formatArbitrumGovernanceIncidentAnalysis(result: ArbitrumGovernanceIncidentAnalysis): string {
  const lines = [
    "Arbitrum governance incident analysis",
    "",
    `Focus: ${result.focus}`,
  ];

  if (result.focus === "brief") {
    lines.push(
      "",
      "Public incident context",
      `- Security Council action froze 30,765.667501709008927568 ETH connected to the KelpDAO / rsETH exploit.`,
      `- Frozen funds address: ${FROZEN_ETH_ADDRESS}.`,
      "- Releasing those funds requires Arbitrum governance action.",
      "",
      "Onchain control path to inspect",
      "- Core Governor ProposalCreated on Arbitrum One",
      "- L2 Core Timelock CallScheduled / CallExecuted",
      "- L2 and L1 Upgrade Executor activity if execution touches protocol-control paths",
    );
  }

  if (result.proposalStatus) {
    lines.push("", "Core Governor proposal status");
    if (result.proposalStatus.matches.length > 0) {
      lines.push(`Found ${result.proposalStatus.matches.length} matching ProposalCreated event(s):`);
      for (const proposal of result.proposalStatus.matches.slice(0, result.limit)) {
        lines.push(formatProposal(proposal));
      }
    } else {
      lines.push(
        `No matching Core Governor ProposalCreated event was found in ${result.proposalStatus.searchedCount} indexed proposal(s).`,
        "Next onchain signal to watch: ProposalCreated on the Core Governor with Kelp / rsETH / frozen-ETH markers.",
      );
    }

    if (result.proposalStatus.recent.length > 0 && result.focus !== "brief") {
      lines.push("", `Recent ProposalCreated events checked`);
      for (const proposal of result.proposalStatus.recent) {
        lines.push(formatProposal(proposal));
      }
    }
  }

  if (result.focus === "verify-freeze") {
    lines.push("", "L1 Upgrade Executor evidence");
    if (result.l1UpgradeExecutorEvents && result.l1UpgradeExecutorEvents.length > 0) {
      for (const event of result.l1UpgradeExecutorEvents) {
        lines.push(formatControlEvent(event));
      }
    } else {
      lines.push("- No L1 Upgrade Executor activity returned in the queried window.");
    }

    lines.push("", "L1 Timelock context");
    if (result.l1TimelockOperations && result.l1TimelockOperations.length > 0) {
      for (const event of result.l1TimelockOperations) {
        lines.push(formatControlEvent(event));
      }
    } else {
      lines.push("- No L1 Timelock operations returned in the queried window.");
    }
  }

  if (result.monitorPlan) {
    lines.push(
      "",
      "Monitor plan",
      `- Network: ${result.monitorPlan.profileName} (${result.monitorPlan.network})`,
      `- Contract: ${result.monitorPlan.targetLabel} ${result.monitorPlan.targetAddress}`,
      `- Event: ${result.monitorPlan.eventName}`,
      `- Direct description filtering in MultiBaas webhook: ${result.monitorPlan.directDescriptionFilteringSupported ? "yes" : "no"}`,
      `- Agent-side filters: ${result.monitorPlan.agentSideFilters.join(", ")}`,
      "- Follow-up analysis:",
    );
    for (const step of result.monitorPlan.followUpAnalysis) {
      lines.push(`  - ${step}`);
    }
  }

  lines.push("", "Evidence boundaries");
  for (const boundary of result.evidenceBoundaries) {
    lines.push(`- ${boundary}`);
  }

  return lines.join("\n");
}
