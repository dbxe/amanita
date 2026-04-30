import crypto from "node:crypto";

import {
  Configuration,
  EventQueriesApi,
  WebhooksApi,
  WebhookEventsType,
} from "@curvegrid/multibaas-sdk";

import type { AmanitaConfig } from "./config.js";

export interface BalanceRow {
  address: string;
  balance: bigint;
  rawBalance: string;
}

export interface BalanceAlert {
  address: string;
  currentBalance: bigint;
  previousBalance: bigint;
}

const QUERY_PAGE_LIMIT = 100;

function buildConfiguration(config: AmanitaConfig): Configuration {
  return new Configuration({
    accessToken: config.apiKey,
    basePath: new URL("/api/v0", config.baseUrl).toString(),
  });
}

function createEventQueriesApi(config: AmanitaConfig): EventQueriesApi {
  return new EventQueriesApi(buildConfiguration(config));
}

function createWebhooksApi(config: AmanitaConfig): WebhooksApi {
  return new WebhooksApi(buildConfiguration(config));
}

function readRows(result: unknown): Array<Record<string, unknown>> {
  if (typeof result !== "object" || result === null) {
    return [];
  }

  const maybeRows =
    (result as { result?: { rows?: Array<Record<string, unknown>> } }).result?.rows ??
    (result as { rows?: Array<Record<string, unknown>> }).rows;

  return Array.isArray(maybeRows) ? maybeRows : [];
}

function toBigIntString(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`Expected integer balance, received ${value}`);
    }
    return value.toString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new Error(`Expected integer balance string, received "${value}"`);
    }
    return trimmed;
  }

  throw new Error(`Unsupported balance value: ${String(value)}`);
}

export function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeBalanceRows(rows: Array<Record<string, unknown>>): BalanceRow[] {
  const normalized: BalanceRow[] = [];

  for (const row of rows) {
    const addressValue = row.address;
    const balanceValue = row.balance;

    if (typeof addressValue !== "string" || balanceValue === undefined) {
      continue;
    }

    const rawBalance = toBigIntString(balanceValue);
    normalized.push({
      address: normalizeAddress(addressValue),
      balance: BigInt(rawBalance),
      rawBalance,
    });
  }

  return normalized;
}

export function selectTopPositiveHolders(rows: BalanceRow[], limit: number): BalanceRow[] {
  return rows
    .filter((row) => row.balance > 0n)
    .sort((left, right) => {
      if (left.balance === right.balance) {
        return left.address.localeCompare(right.address);
      }
      return left.balance > right.balance ? -1 : 1;
    })
    .slice(0, limit);
}

export async function executeSavedBalanceQuery(
  config: AmanitaConfig,
  queryName: string,
  limit: number,
  offset = 0,
): Promise<BalanceRow[]> {
  const api = createEventQueriesApi(config);
  const response = await api.executeEventQuery(queryName, offset, limit);
  return normalizeBalanceRows(readRows(response.data as unknown));
}

export async function fetchBalanceSnapshot(
  config: AmanitaConfig,
  queryName: string,
  limit: number,
): Promise<Map<string, BalanceRow>> {
  const rows: BalanceRow[] = [];
  let offset = 0;

  while (rows.length < limit) {
    const pageLimit = Math.min(QUERY_PAGE_LIMIT, limit - rows.length);
    const page = await executeSavedBalanceQuery(config, queryName, pageLimit, offset);
    rows.push(...page);

    if (page.length < pageLimit) {
      break;
    }

    offset += page.length;
  }

  const snapshot = new Map<string, BalanceRow>();
  for (const row of rows) {
    snapshot.set(row.address, row);
  }
  return snapshot;
}

export async function getAddressBalance(
  config: AmanitaConfig,
  queryName: string,
  address: string,
): Promise<BalanceRow> {
  const normalizedAddress = normalizeAddress(address);
  const snapshot = await fetchBalanceSnapshot(config, queryName, config.scanLimit);
  return (
    snapshot.get(normalizedAddress) ?? {
      address: normalizedAddress,
      balance: 0n,
      rawBalance: "0",
    }
  );
}

export async function ensureEventWebhook(
  config: AmanitaConfig,
  label: string,
  url: string,
): Promise<{
  id: number;
  label: string;
  secret?: string;
  subscriptions: string[];
  url: string;
}> {
  const api = createWebhooksApi(config);
  const existing = (await api.listWebhooks(200, 0)).data.result ?? [];
  const found = existing.find((webhook) => webhook.label === label);

  if (found) {
    const updated = await api.updateWebhook(found.id, {
      label,
      subscriptions: [WebhookEventsType.EventEmitted],
      url,
    });
    return {
      id: updated.data.result.id,
      label: updated.data.result.label,
      subscriptions: [...updated.data.result.subscriptions],
      url: updated.data.result.url,
    };
  }

  const created = await api.createWebhook({
    label,
    subscriptions: [WebhookEventsType.EventEmitted],
    url,
  });

  return {
    id: created.data.result.id,
    label: created.data.result.label,
    secret: created.data.result.secret,
    subscriptions: [...created.data.result.subscriptions],
    url: created.data.result.url,
  };
}

export function createSignature(body: Buffer, timestamp: string, secret: string): string {
  const mac = crypto.createHmac("sha256", secret);
  mac.update(body);
  mac.update(timestamp);
  return mac.digest("hex");
}

export function verifyWebhookSignature(
  body: Buffer,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!timestamp || !signature) {
    return false;
  }

  const expected = createSignature(body, timestamp, secret);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}
