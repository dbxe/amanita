import { resolveConfig } from "./config.js";
import {
  executeArbitraryEventQueryRows,
  type ContractReadiness,
  type TokenMetadata,
  getErc20Metadata,
  resolveContractReadiness,
} from "./multibaas.js";
import { resolveTokenTarget, type TokenTargetInput } from "./token-target-service.js";
import {
  buildTokenControlTimelineEventViewSpec,
  compileEventViewSpec,
  type ContractTargetReference,
} from "./event-view.js";

export interface TokenControlEvent {
  account?: string;
  blockNumber?: string;
  contractAddress?: string;
  eventSignature?: string;
  implementation?: string;
  newAdmin?: string;
  newOwner?: string;
  previousAdmin?: string;
  previousOwner?: string;
  role?: string;
  sender?: string;
  triggeredAt?: string;
  txHash?: string;
}

export interface TokenControlInvestigationResult {
  events: TokenControlEvent[];
  limit: number;
  metadata?: TokenMetadata;
  readiness?: ContractReadiness;
  resolvedAddress?: string;
  unresolvedTokenName?: string;
}

function readinessPreventsHistoricalView(readiness?: ContractReadiness): boolean {
  return readiness?.state === "needs-link" || readiness?.state === "syncing";
}

function toContractTargetReference(address: string): ContractTargetReference {
  return { kind: "address", value: address };
}

export async function getTokenControlEvents(
  input: TokenTargetInput & { limit?: number },
): Promise<TokenControlInvestigationResult> {
  const resolved = await resolveTokenTarget(input);
  const limit = input.limit ?? 20;

  if (resolved.unresolved) {
    return {
      events: [],
      limit,
      unresolvedTokenName: resolved.tokenNameInput,
    };
  }

  if (!resolved.address) {
    return {
      events: [],
      limit,
    };
  }

  const config = resolveConfig();
  const [readiness, metadata] = await Promise.all([
    resolveContractReadiness(config, resolved.address),
    getErc20Metadata(config, resolved.address).catch(() => undefined),
  ]);

  if (readinessPreventsHistoricalView(readiness)) {
    return {
      events: [],
      limit,
      metadata,
      readiness,
      resolvedAddress: resolved.address,
    };
  }

  const rows = await executeArbitraryEventQueryRows(
    config,
    compileEventViewSpec(buildTokenControlTimelineEventViewSpec(toContractTargetReference(resolved.address))),
    limit,
  );

  return {
    events: rows.map((row) => ({
      account: typeof row.account === "string" ? row.account : undefined,
      blockNumber: row.block_number !== undefined ? String(row.block_number) : undefined,
      contractAddress: typeof row.contract_address === "string" ? row.contract_address : undefined,
      eventSignature: typeof row.event_signature === "string" ? row.event_signature : undefined,
      implementation: typeof row.implementation === "string" ? row.implementation : undefined,
      newAdmin: typeof row.new_admin === "string" ? row.new_admin : undefined,
      newOwner: typeof row.new_owner === "string" ? row.new_owner : undefined,
      previousAdmin: typeof row.previous_admin === "string" ? row.previous_admin : undefined,
      previousOwner: typeof row.previous_owner === "string" ? row.previous_owner : undefined,
      role: typeof row.role === "string" ? row.role : undefined,
      sender: typeof row.sender === "string" ? row.sender : undefined,
      triggeredAt: typeof row.triggered_at === "string" ? row.triggered_at : undefined,
      txHash: typeof row.tx_hash === "string" ? row.tx_hash : undefined,
    })),
    limit,
    metadata,
    readiness,
    resolvedAddress: resolved.address,
  };
}

export function formatTokenControlEvents(result: TokenControlInvestigationResult): string {
  if (result.unresolvedTokenName) {
    return `I don't know the contract address for ${result.unresolvedTokenName} yet. Tell me the token contract address and I'll inspect its control events directly.`;
  }

  if (!result.resolvedAddress) {
    return "Tell me the token contract address or a known token name and I'll inspect its control events.";
  }

  const lines = [
    `Token control events`,
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
    lines.push("", "MultiBaas is still syncing historical events for this token, so control history is not complete yet.");
    return lines.join("\n");
  }

  if (result.readiness?.state === "needs-link") {
    lines.push("", "This token is not linked in MultiBaas yet, so control-history analysis is not ready.");
    return lines.join("\n");
  }

  if (result.events.length === 0) {
    lines.push("", "No matching control events found in the queried window.");
    return lines.join("\n");
  }

  lines.push("", `Latest ${result.events.length} control events`);
  for (const event of result.events) {
    const details = [
      event.account ? `account=${event.account}` : undefined,
      event.role ? `role=${event.role}` : undefined,
      event.sender ? `sender=${event.sender}` : undefined,
      event.previousOwner ? `previousOwner=${event.previousOwner}` : undefined,
      event.newOwner ? `newOwner=${event.newOwner}` : undefined,
      event.previousAdmin ? `previousAdmin=${event.previousAdmin}` : undefined,
      event.newAdmin ? `newAdmin=${event.newAdmin}` : undefined,
      event.implementation ? `implementation=${event.implementation}` : undefined,
      event.txHash ? `tx=${event.txHash}` : undefined,
    ].filter(Boolean);

    lines.push(
      `- ${event.eventSignature ?? "unknown"}${event.blockNumber ? ` @ block ${event.blockNumber}` : ""}${event.triggeredAt ? ` (${event.triggeredAt})` : ""}`,
    );
    if (details.length > 0) {
      lines.push(`  ${details.join("  ")}`);
    }
  }

  return lines.join("\n");
}
