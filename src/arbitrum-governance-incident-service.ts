import { getArbitrumDaoActiveTargets, type ArbitrumDaoTargetDefinition } from "./arbitrum-dao-service.js";
import { resolveConfigForProfile, type RuntimeConfig } from "./config.js";
import {
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

export interface IncidentQueryTarget {
  network: string;
  profileName: string;
  targetAddress: string;
  targetLabel: string;
}

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
  operationIndex?: string;
  source?: IncidentQueryTarget;
  target?: string;
  targetLabel?: string;
  triggeredAt?: string;
  txHash?: string;
  valueEth?: string;
  valueWei?: string;
}

export interface IncidentProposalStatus {
  matches: IncidentProposalEvent[];
  queryTarget: IncidentQueryTarget;
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
  l2TimelockOperations?: IncidentControlEvent[];
  l2UpgradeExecutorEvents?: IncidentControlEvent[];
  limit: number;
  monitorPlan?: IncidentMonitorPlan;
  proposalStatus?: IncidentProposalStatus;
}

const DEFAULT_LIMIT = 3;
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

function toQueryTarget(target: ArbitrumDaoTargetDefinition): IncidentQueryTarget {
  return {
    network: target.chainLabel,
    profileName: target.profileName,
    targetAddress: target.contractAddress,
    targetLabel: target.roleLabel,
  };
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

function toControlEvent(row: Record<string, unknown>, source: ArbitrumDaoTargetDefinition): IncidentControlEvent {
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
    operationIndex: rowString(row, "index"),
    source: toQueryTarget(source),
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
    queryTarget: toQueryTarget(coreGovernor),
    recent: proposals.slice(0, limit),
    searchedCount: proposals.length,
  };
}

async function getUpgradeExecutorEvents(
  targetId: "l1_upgrade_executor" | "l2_upgrade_executor",
  limit: number,
): Promise<IncidentControlEvent[]> {
  const upgradeExecutor = targetById(targetId);
  const config = resolveConfigForProfile(upgradeExecutor.profileName);
  const rows = await fetchEventRows(
    config,
    compileEventViewSpec(buildArbitrumUpgradeExecutorActivityEventViewSpec(targetReference(upgradeExecutor.contractAddress))),
    limit,
  );
  return rows.map((row) => toControlEvent(row, upgradeExecutor));
}

async function getTimelockOperations(
  targetId: "l1_timelock" | "l2_core_timelock",
  limit: number,
): Promise<IncidentControlEvent[]> {
  const timelock = targetById(targetId);
  const config = resolveConfigForProfile(timelock.profileName);
  const rows = await fetchEventRows(
    config,
    compileEventViewSpec(buildArbitrumTimelockOperationEventViewSpec(targetReference(timelock.contractAddress))),
    limit,
  );
  return rows.map((row) => toControlEvent(row, timelock));
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
      "watch for later ProposalQueued, ProposalExecuted, CallScheduled, and CallExecuted events",
      "check whether L2 or L1 timelock / upgrade executor activity appears",
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
    const [
      l1UpgradeExecutorEvents,
      l1TimelockOperations,
      l2UpgradeExecutorEvents,
      l2TimelockOperations,
    ] = await Promise.all([
      getUpgradeExecutorEvents("l1_upgrade_executor", limit),
      getTimelockOperations("l1_timelock", limit),
      getUpgradeExecutorEvents("l2_upgrade_executor", limit),
      getTimelockOperations("l2_core_timelock", limit),
    ]);
    result.l1UpgradeExecutorEvents = l1UpgradeExecutorEvents;
    result.l1TimelockOperations = l1TimelockOperations;
    result.l2UpgradeExecutorEvents = l2UpgradeExecutorEvents;
    result.l2TimelockOperations = l2TimelockOperations;
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

function formatQueryTarget(target: IncidentQueryTarget): string {
  return `${target.profileName} (${target.network}) | ${target.targetLabel} ${target.targetAddress}`;
}

function appendEventQueryBlock(lines: string[], entries: string[]): void {
  lines.push("", "Tool check", "```event_query", ...entries, "```");
}

function appendProposalQuerySummary(lines: string[], proposalStatus: IncidentProposalStatus): void {
  appendEventQueryBlock(lines, [
    "tool: analyze_arbitrum_governance_incident",
    "query: multibaas.eventQuery",
    `stream: ${formatQueryTarget(proposalStatus.queryTarget)} / ProposalCreated`,
    "order: newest first",
    "decoded_fields: proposalId, proposer, targets, values, calldatas, description",
    `match: ${INCIDENT_MARKERS.join(" | ")}`,
  ]);
}

function appendControlQuerySummary(lines: string[]): void {
  const l1UpgradeExecutor = toQueryTarget(targetById("l1_upgrade_executor"));
  const l1Timelock = toQueryTarget(targetById("l1_timelock"));
  const l2CoreTimelock = toQueryTarget(targetById("l2_core_timelock"));
  const l2UpgradeExecutor = toQueryTarget(targetById("l2_upgrade_executor"));

  appendEventQueryBlock(lines, [
    "tool: analyze_arbitrum_governance_incident",
    "query: multibaas.eventQuery",
    `stream: ${formatQueryTarget(l1UpgradeExecutor)} / UpgradeExecuted, TargetCallExecuted`,
    `stream: ${formatQueryTarget(l1Timelock)} / CallScheduled, CallExecuted, Cancelled`,
    `stream: ${formatQueryTarget(l2CoreTimelock)} / CallScheduled, CallExecuted, Cancelled`,
    `stream: ${formatQueryTarget(l2UpgradeExecutor)} / UpgradeExecuted, TargetCallExecuted`,
    "decoded_fields: target, value, data, operation_id, delay, tx_hash, triggered_at",
  ]);
}

function formatControlEvent(event: IncidentControlEvent): string {
  const target = event.target
    ? `${event.target}${event.targetLabel ? ` (${event.targetLabel})` : ""}`
    : "unknown target";
  const details = [
    event.triggeredAt,
    event.eventSignature,
    `target=${target}`,
    event.operationId ? `op=${shortId(event.operationId, 14)}` : undefined,
    event.operationIndex ? `index=${event.operationIndex}` : undefined,
    event.calldataSelector ? `selector=${event.calldataSelector}` : undefined,
    event.valueEth ? `value=${event.valueEth}` : undefined,
    event.delaySeconds ? `delay=${event.delaySeconds}s` : undefined,
    event.txHash ? `tx=${event.txHash}` : undefined,
  ].filter(Boolean);
  return `- ${details.join(" | ")}`;
}

function appendControlEvents(lines: string[], heading: string, events: IncidentControlEvent[] | undefined): void {
  lines.push("", heading);
  const source = events?.[0]?.source;
  if (source) {
    lines.push(`Source: ${formatQueryTarget(source)}`);
  }

  if (events && events.length > 0) {
    for (const event of events) {
      lines.push(formatControlEvent(event));
    }
    return;
  }

  lines.push("- No matching activity returned in the queried window.");
}

export function formatArbitrumGovernanceIncidentAnalysis(result: ArbitrumGovernanceIncidentAnalysis): string {
  const lines = [
    "Arbitrum frozen-ETH governance brief",
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
      "Onchain control path",
      "- Core Governor emits ProposalCreated on Arbitrum One.",
      "- Delegates vote through VoteCast / VoteCastWithParams.",
      "- A successful proposal is queued and executed through the L2 Core Timelock.",
      "- L2 or L1 upgrade executors may appear if execution touches protocol-control paths.",
    );
  }

  if (result.proposalStatus) {
    appendProposalQuerySummary(lines, result.proposalStatus);
    lines.push(
      "",
      "Core Governor proposal status",
      `Source: ${formatQueryTarget(result.proposalStatus.queryTarget)}`,
    );
    if (result.proposalStatus.matches.length > 0) {
      lines.push(`Verdict: found ${result.proposalStatus.matches.length} matching ProposalCreated event(s).`);
      for (const proposal of result.proposalStatus.matches.slice(0, result.limit)) {
        lines.push(formatProposal(proposal));
      }
    } else {
      lines.push(
        `Verdict: not onchain yet in the checked Core Governor ProposalCreated stream.`,
        `Checked: ${result.proposalStatus.searchedCount} indexed ProposalCreated event(s).`,
        "Next binding signal: ProposalCreated on the Core Governor with Kelp / rsETH / frozen-ETH markers.",
      );
    }

    if (result.proposalStatus.recent.length > 0 && result.focus === "proposal-status") {
      lines.push("", "Recent ProposalCreated events checked");
      for (const proposal of result.proposalStatus.recent) {
        lines.push(formatProposal(proposal));
      }
    }
  }

  if (result.focus === "verify-freeze") {
    appendControlQuerySummary(lines);
    lines.push(
      "",
      "What the live event data verifies",
      "- MultiBaas returned decoded governance-control events from the configured Arbitrum DAO contracts.",
      "- This verifies control-plane activity through emitted events; it does not reconstruct the exploit or trace all funds.",
    );

    appendControlEvents(lines, "Primary emergency-response evidence: L1 Upgrade Executor", result.l1UpgradeExecutorEvents);
    appendControlEvents(lines, "L1 Timelock context", result.l1TimelockOperations);
    appendControlEvents(lines, "L2 Core Timelock context", result.l2TimelockOperations);
    appendControlEvents(lines, "L2 Upgrade Executor context", result.l2UpgradeExecutorEvents);
  }

  if (result.monitorPlan) {
    lines.push(
      "",
      "Monitor plan",
      `- Network: ${result.monitorPlan.profileName} (${result.monitorPlan.network})`,
      `- Contract: ${result.monitorPlan.targetLabel} ${result.monitorPlan.targetAddress}`,
      `- Event: ${result.monitorPlan.eventName}`,
      `- Direct description filtering in the webhook: ${result.monitorPlan.directDescriptionFilteringSupported ? "yes" : "no"}`,
      `- Agent-side filters: ${result.monitorPlan.agentSideFilters.join(", ")}`,
      "- Payoff: wake up when the public proposal becomes a binding onchain ProposalCreated event.",
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

export function formatArbitrumGovernanceIncidentMonitorSetup(result: ArbitrumGovernanceIncidentAnalysis): string {
  if (!result.monitorPlan) {
    return formatArbitrumGovernanceIncidentAnalysis(result);
  }

  const proposalStatus = result.proposalStatus;
  const status = proposalStatus && proposalStatus.matches.length > 0
    ? `Current verdict: found ${proposalStatus.matches.length} matching ProposalCreated event(s).`
    : `Current verdict: no matching release ProposalCreated event found in ${proposalStatus?.searchedCount ?? 0} checked Core Governor event(s).`;
  const filters = result.monitorPlan.agentSideFilters.join(", ");
  const followUp = result.monitorPlan.followUpAnalysis.join("; ");

  const lines = [
    "Arbitrum frozen-ETH release monitor",
    "",
    status,
    "",
    "Status check before setting the monitor",
    "```event_query",
    "tool: analyze_arbitrum_governance_incident",
    "query: multibaas.eventQuery",
    `stream: ${formatQueryTarget(result.monitorPlan)} / ProposalCreated`,
    "order: newest first",
    "decoded_fields: proposalId, proposer, targets, values, calldatas, description",
    `match: ${filters}`,
    "```",
    "",
    "User-facing acknowledgement",
    `I will watch ${result.monitorPlan.profileName} (${result.monitorPlan.network}) on ${result.monitorPlan.targetLabel} ${result.monitorPlan.targetAddress} for ${result.monitorPlan.eventName}. I will match decoded proposal fields against: ${filters}. After a match, I will ${followUp}.`,
    "",
    "Monitor target",
    `- Network: ${result.monitorPlan.profileName} (${result.monitorPlan.network})`,
    `- Contract: ${result.monitorPlan.targetLabel} ${result.monitorPlan.targetAddress}`,
    `- Event: ${result.monitorPlan.eventName}`,
    `- Trigger rule: read ${result.monitorPlan.eventName} events, then apply agent-side text/address matching to the decoded proposal fields.`,
    `- Agent-side filters: ${filters}`,
    `- Follow-up after trigger: ${followUp}.`,
    "",
    "Follow-up analysis after trigger",
  ];

  for (const step of result.monitorPlan.followUpAnalysis) {
    lines.push(`- ${step}`);
  }

  lines.push(
    "",
    "Evidence boundary",
    "- This monitor watches for the binding onchain proposal event; it does not claim the release proposal exists until a matching ProposalCreated event is returned.",
  );

  return lines.join("\n");
}
