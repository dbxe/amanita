import { createHash, randomUUID } from "node:crypto";

import {
  analyzeArbitrumGovernanceIncident,
  buildArbitrumFrozenEthReleaseMonitorPlan,
  formatArbitrumGovernanceIncidentMonitorSetup,
  matchIncidentMarkers,
  type ArbitrumGovernanceIncidentAnalysis,
  type IncidentMonitorPlan,
} from "./arbitrum-governance-incident-service.js";
import { listConfiguredBackends, resolveConfig, resolveConfigForProfile, type RuntimeConfig } from "./config.js";
import { ensureEventWebhook, findEventWebhook, normalizeAddress } from "./multibaas.js";
import {
  appendEventMonitorAlerts,
  loadState,
  saveState,
  type EventMonitor,
  type EventMonitorAlertRecord,
  type LocalState,
  type StoredWebhook,
} from "./state.js";
import {
  DEFAULT_WEBHOOK_LABEL,
  deriveDefaultWebhookUrl,
} from "./webhook-url.js";

export interface EventMonitorEvaluationResult {
  alerts: EventMonitorAlertRecord[];
  state: LocalState;
}

export interface ArbitrumFrozenEthReleaseMonitorResult {
  analysis: ArbitrumGovernanceIncidentAnalysis;
  monitor: EventMonitor;
  webhook: StoredWebhook;
}

function monitorFromPlan(plan: IncidentMonitorPlan, now: string, existing?: EventMonitor): EventMonitor {
  return {
    contractAddress: normalizeAddress(plan.targetAddress),
    contractLabel: plan.targetLabel,
    createdAt: existing?.createdAt ?? now,
    eventName: plan.eventName,
    followUpAnalysis: [...plan.followUpAnalysis],
    id: existing?.id ?? randomUUID(),
    kind: "arbitrum-frozen-eth-release-proposal",
    label: existing?.label ?? "Arbitrum frozen-ETH release proposal",
    lastTriggeredAt: existing?.lastTriggeredAt,
    matchText: [...plan.agentSideFilters],
    network: plan.network,
    profileName: plan.profileName,
    triggeredEventKeys: existing?.triggeredEventKeys ?? [],
    updatedAt: now,
  };
}

function upsertEventMonitor(monitors: EventMonitor[], monitor: EventMonitor): EventMonitor[] {
  const existing = monitors.find((candidate) => candidate.id === monitor.id);
  if (existing) {
    return monitors.map((candidate) => candidate.id === monitor.id ? monitor : candidate);
  }
  return [...monitors, monitor];
}

function findArbitrumFrozenEthMonitor(monitors: EventMonitor[], plan: IncidentMonitorPlan): EventMonitor | undefined {
  const address = normalizeAddress(plan.targetAddress);
  return monitors.find(
    (monitor) =>
      monitor.kind === "arbitrum-frozen-eth-release-proposal" &&
      normalizeAddress(monitor.contractAddress) === address &&
      monitor.eventName === plan.eventName,
  );
}

export async function createArbitrumFrozenEthReleaseMonitor(input: {
  limit?: number;
  webhookLabel?: string;
  webhookUrl?: string;
} = {}): Promise<ArbitrumFrozenEthReleaseMonitorResult> {
  const analysis = await analyzeArbitrumGovernanceIncident({ focus: "monitor", limit: input.limit });
  const plan = analysis.monitorPlan ?? buildArbitrumFrozenEthReleaseMonitorPlan();
  const config = resolveConfigForProfile(plan.profileName);
  const state = loadState(config.stateDir);
  const now = new Date().toISOString();
  const monitor = monitorFromPlan(plan, now, findArbitrumFrozenEthMonitor(state.eventMonitors, plan));
  const webhookLabel = input.webhookLabel ?? DEFAULT_WEBHOOK_LABEL;
  const callbackUrl = input.webhookUrl ?? deriveDefaultWebhookUrl(config.baseUrl);
  const registered = callbackUrl
    ? await ensureEventWebhook(config, webhookLabel, callbackUrl)
    : await findEventWebhook(config, webhookLabel);

  if (!registered) {
    throw new Error(
      "No active MultiBaas event webhook found. Configure MULTIBAAS_WEBHOOK_PUBLIC_URL or register an event.emitted webhook so MultiBaas can wake the agent.",
    );
  }

  const registeredSecret = (registered as { secret?: unknown }).secret;
  const webhook: StoredWebhook = {
    id: registered.id,
    label: registered.label,
    secret: (typeof registeredSecret === "string" ? registeredSecret : undefined) ?? state.webhook?.secret,
    subscriptions: registered.subscriptions,
    updatedAt: now,
    url: registered.url,
  };

  saveState(config.stateDir, {
    ...state,
    eventMonitors: upsertEventMonitor(state.eventMonitors, monitor),
    webhook,
  });

  return {
    analysis,
    monitor,
    webhook,
  };
}

function collectStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    output.push(String(value));
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return output;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      output.push(key);
      collectStrings(item, output);
    }
  }

  return output;
}

function findFirstField(value: unknown, fieldNames: Set<string>): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstField(item, fieldNames);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  for (const [key, item] of Object.entries(value)) {
    if (fieldNames.has(key.toLowerCase()) && item !== undefined && item !== null) {
      return String(item);
    }
  }

  for (const item of Object.values(value)) {
    const found = findFirstField(item, fieldNames);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function eventKey(event: unknown): string {
  const txHash = findFirstField(event, new Set(["transactionhash", "transaction_hash", "txhash", "tx_hash"]));
  const logIndex = findFirstField(event, new Set(["logindex", "log_index", "eventindex", "event_index"]));
  const blockNumber = findFirstField(event, new Set(["blocknumber", "block_number"]));
  if (txHash || logIndex || blockNumber) {
    return [txHash, blockNumber, logIndex].filter(Boolean).join(":");
  }

  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function eventMatchesMonitor(event: unknown, monitor: EventMonitor): { key: string; matchedText: string[] } | undefined {
  const strings = collectStrings(event);
  const haystack = strings.join(" ").toLowerCase();
  const monitorAddress = normalizeAddress(monitor.contractAddress);
  const mentionsContract = strings.some((value) => normalizeAddress(value).includes(monitorAddress));
  const mentionsEvent = haystack.includes(monitor.eventName.toLowerCase());
  const matchedText = monitor.matchText.filter((marker) => haystack.includes(marker.toLowerCase()));

  if (!mentionsContract || !mentionsEvent || matchedText.length === 0) {
    return undefined;
  }

  return {
    key: eventKey(event),
    matchedText,
  };
}

export function evaluateEventMonitorsForState(
  state: LocalState,
  events: unknown[],
  now = new Date().toISOString(),
): { alerts: EventMonitorAlertRecord[]; nextState: LocalState } {
  const alerts: EventMonitorAlertRecord[] = [];
  const eventMonitors = state.eventMonitors.map((monitor) => ({ ...monitor }));

  for (const monitor of eventMonitors) {
    for (const event of events) {
      const match = eventMatchesMonitor(event, monitor);
      if (!match || monitor.triggeredEventKeys.includes(match.key)) {
        continue;
      }

      monitor.triggeredEventKeys = [...monitor.triggeredEventKeys, match.key];
      monitor.lastTriggeredAt = now;
      monitor.updatedAt = now;
      alerts.push({
        eventKey: match.key,
        id: randomUUID(),
        matchedText: match.matchedText,
        monitorId: monitor.id,
        observedAt: now,
        summary: `${monitor.label}: ${monitor.eventName} on ${monitor.contractLabel} matched ${match.matchedText.join(", ")}`,
      });
    }
  }

  return {
    alerts,
    nextState: {
      ...state,
      eventMonitors,
    },
  };
}

export function evaluateEventMonitors(events: unknown[]): EventMonitorEvaluationResult {
  const alerts: EventMonitorAlertRecord[] = [];
  const states: LocalState[] = [];

  for (const config of eventMonitorStateConfigs()) {
    const state = loadState(config.stateDir);
    const evaluated = evaluateEventMonitorsForState(state, events);
    saveState(config.stateDir, evaluated.nextState);
    appendEventMonitorAlerts(config.stateDir, evaluated.alerts);
    alerts.push(...evaluated.alerts);
    states.push(evaluated.nextState);
  }

  const baseState = states[0] ?? loadState(resolveConfig().stateDir);
  return {
    alerts,
    state: {
      ...baseState,
      eventMonitors: states.flatMap((state) => state.eventMonitors),
    },
  };
}

function eventMonitorStateConfigs(): RuntimeConfig[] {
  const configured = listConfiguredBackends()
    .filter((backend) => !backend.inactive)
    .map((backend) => resolveConfigForProfile(backend.profileName));
  const candidates = configured.length > 0 ? configured : [resolveConfig()];
  const seen = new Set<string>();
  return candidates.filter((config) => {
    if (seen.has(config.stateDir)) {
      return false;
    }
    seen.add(config.stateDir);
    return true;
  });
}

export function formatEventMonitorAlerts(
  state: LocalState,
  alerts: EventMonitorAlertRecord[],
): string {
  if (alerts.length === 0) {
    return "No event monitor matches detected.";
  }

  return alerts
    .map((alert) => {
      const monitor = state.eventMonitors.find((candidate) => candidate.id === alert.monitorId);
      const label = monitor?.label ?? alert.monitorId;
      const followUp = monitor?.followUpAnalysis.join("; ");
      return `[event alert] ${label}: ${alert.summary}${followUp ? `. Next: ${followUp}.` : ""}`;
    })
    .join("\n");
}

export function formatArbitrumFrozenEthReleaseMonitorRegistration(
  result: ArbitrumFrozenEthReleaseMonitorResult,
): string {
  const proposalStatus = result.analysis.proposalStatus;
  const currentVerdict = proposalStatus && proposalStatus.matches.length > 0
    ? `found ${proposalStatus.matches.length} matching ProposalCreated event(s)`
    : `no matching release ProposalCreated event in ${proposalStatus?.searchedCount ?? 0} scanned Core Governor event(s)`;
  const followUp = result.monitor.followUpAnalysis.join("; ");

  const lines = [
    "Evidence packet: Arbitrum frozen-ETH release event monitor",
    "",
    "Use this packet as source material. Do not copy it wholesale; synthesize the user-facing acknowledgement from the evidence below.",
    "",
    formatArbitrumGovernanceIncidentMonitorSetup(result.analysis),
    "",
    "Monitor activation",
    `- Local monitor: ${result.monitor.label}`,
    `- Runtime path: MultiBaas event.emitted webhook -> local event monitor filter -> NanoClaw notification.`,
    "- Webhook status: registered.",
    `- Webhook: id=${result.webhook.id} label=${result.webhook.label} url=${result.webhook.url}`,
    `- Subscriptions: ${result.webhook.subscriptions.join(", ")}`,
    "",
    "Monitor registered",
    `- Current verdict: ${currentVerdict}.`,
    `- Watching: ${result.monitor.profileName} (${result.monitor.network}) ${result.monitor.contractLabel} ${result.monitor.contractAddress} / ${result.monitor.eventName}.`,
    `- Matching: ${result.monitor.matchText.join(", ")}.`,
    `- Follow-up after trigger: ${followUp}.`,
  ];

  return lines.join("\n");
}
