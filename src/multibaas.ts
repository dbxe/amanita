import crypto from "node:crypto";

import {
  AddressesApi,
  Configuration,
  ContractsApi,
  EventQueriesApi,
  type EventQuery,
} from "@curvegrid/multibaas-sdk";

import type { RuntimeConfig } from "./config.js";

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

export interface KnownAddress {
  address: string;
  alias: string;
}

export interface AddressRegistration {
  address: string;
  alias?: string;
  contracts: Array<{
    label: string;
    name?: string;
    version?: string;
  }>;
}

export interface ContractCatalogEntry {
  contractName?: string;
  label: string;
  version?: string;
}

export interface ContractDefinition {
  abi?: {
    events?: Record<string, unknown>;
    methods?: Record<string, unknown>;
  };
  contractName?: string;
  label: string;
  version?: string;
}

const QUERY_PAGE_LIMIT = 100;
const EVENT_EMITTED_WEBHOOK_SUBSCRIPTION = "event.emitted";

function buildConfiguration(config: RuntimeConfig): Configuration {
  return new Configuration({
    accessToken: config.apiKey ?? "placeholder",
    basePath: new URL("/api/v0", config.baseUrl).toString(),
  });
}

function createEventQueriesApi(config: RuntimeConfig): EventQueriesApi {
  return new EventQueriesApi(buildConfiguration(config));
}

function createAddressesApi(config: RuntimeConfig): AddressesApi {
  return new AddressesApi(buildConfiguration(config));
}

function createContractsApi(config: RuntimeConfig): ContractsApi {
  return new ContractsApi(buildConfiguration(config));
}

function adminApiUrl(config: RuntimeConfig, pathname: string): string {
  return new URL(pathname.replace(/^\/+/, ""), new URL("/api/v0/", config.baseUrl)).toString();
}

async function requestAdminJson<T>(
  config: RuntimeConfig,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(adminApiUrl(config, pathname), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.apiKey ?? "placeholder"}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`MultiBaas admin request failed (${response.status}): ${await response.text()}`);
  }

  return (await response.json()) as T;
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

export function buildContractBalanceEventQuery(contractAddress: string): EventQuery {
  const normalizedAddress = normalizeAddress(contractAddress);
  return {
    events: [
      {
        eventName: "Transfer(address,address,uint256)",
        filter: {
          children: [
            {
              fieldType: "contract_address",
              operator: "equal",
              value: normalizedAddress,
            },
          ],
          rule: "and",
        },
        select: [
          {
            alias: "address",
            inputIndex: 1,
            name: "to",
            type: "input" as const,
          },
          {
            aggregator: "add" as const,
            alias: "balance",
            inputIndex: 2,
            name: "tokens",
            type: "input" as const,
          },
        ],
      },
      {
        eventName: "Transfer(address,address,uint256)",
        filter: {
          children: [
            {
              fieldType: "contract_address",
              operator: "equal",
              value: normalizedAddress,
            },
          ],
          rule: "and",
        },
        select: [
          {
            alias: "address",
            inputIndex: 0,
            name: "from",
            type: "input" as const,
          },
          {
            aggregator: "subtract" as const,
            alias: "balance",
            inputIndex: 2,
            name: "tokens",
            type: "input" as const,
          },
        ],
      },
    ],
    groupBy: "address",
    order: "DESC",
    orderBy: "balance",
  };
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
  config: RuntimeConfig,
  queryName: string,
  limit: number,
  offset = 0,
): Promise<BalanceRow[]> {
  const api = createEventQueriesApi(config);
  const response = await api.executeEventQuery(queryName, offset, limit);
  return normalizeBalanceRows(readRows(response.data as unknown));
}

export async function executeContractBalanceQuery(
  config: RuntimeConfig,
  contractAddress: string,
  limit: number,
  offset = 0,
): Promise<BalanceRow[]> {
  const api = createEventQueriesApi(config);
  const response = await api.executeArbitraryEventQuery(
    buildContractBalanceEventQuery(contractAddress),
    offset,
    limit,
  );
  return normalizeBalanceRows(readRows(response.data as unknown));
}

export async function fetchBalanceSnapshot(
  config: RuntimeConfig,
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

export async function fetchContractBalanceSnapshot(
  config: RuntimeConfig,
  contractAddress: string,
  limit: number,
): Promise<Map<string, BalanceRow>> {
  const rows: BalanceRow[] = [];
  let offset = 0;

  while (rows.length < limit) {
    const pageLimit = Math.min(QUERY_PAGE_LIMIT, limit - rows.length);
    const page = await executeContractBalanceQuery(config, contractAddress, pageLimit, offset);
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

export async function inspectContractReadiness(
  config: RuntimeConfig,
  address: string,
): Promise<{
  contractLabel?: string;
  isProcessingPastLogs: boolean;
}> {
  const normalizedAddress = normalizeAddress(address);
  const addressesApi = createAddressesApi(config);
  const { data } = await addressesApi.getAddress(normalizedAddress, ["contractLookup"]);
  const linkedContracts = data.result?.contracts ?? [];
  const contractLabel = linkedContracts[0]?.label;

  if (!contractLabel) {
    return {
      isProcessingPastLogs: false,
    };
  }

  const contractsApi = createContractsApi(config);
  const status = await contractsApi.getEventIndexingStatus(normalizedAddress, contractLabel);
  return {
    contractLabel,
    isProcessingPastLogs: status.data.result?.isProcessingPastLogs ?? false,
  };
}

export async function getAddressRegistration(config: RuntimeConfig, addressOrAlias: string): Promise<AddressRegistration> {
  const normalizedAddressOrAlias = addressOrAlias.startsWith("0x") ? normalizeAddress(addressOrAlias) : addressOrAlias.trim();
  const addressesApi = createAddressesApi(config);
  const { data } = await addressesApi.getAddress(normalizedAddressOrAlias, ["contractLookup"]);
  return {
    address: normalizeAddress(data.result?.address ?? normalizedAddressOrAlias),
    alias: data.result?.alias?.trim() || undefined,
    contracts: (data.result?.contracts ?? []).map((contract) => ({
      label: contract.label,
      name: contract.name,
      version: contract.version,
    })),
  };
}

export async function listKnownAddresses(config: RuntimeConfig): Promise<KnownAddress[]> {
  const addressesApi = createAddressesApi(config);
  const { data } = await addressesApi.listAddresses();
  return (data.result ?? []).flatMap((entry) => {
    if (!entry.alias || !entry.address) {
      return [];
    }
    return [{ address: normalizeAddress(entry.address), alias: entry.alias }];
  });
}

export async function resolveKnownAddress(config: RuntimeConfig, tokenName: string): Promise<KnownAddress | undefined> {
  const normalizedTokenName = tokenName.trim().toLowerCase();
  const knownAddresses = await listKnownAddresses(config);
  return knownAddresses.find((entry) => entry.alias.toLowerCase() === normalizedTokenName);
}

export async function setAddressAlias(config: RuntimeConfig, address: string, alias: string): Promise<void> {
  const addressesApi = createAddressesApi(config);
  await addressesApi.setAddress({
    address: normalizeAddress(address),
    alias,
  });
}

export async function listContractCatalog(config: RuntimeConfig): Promise<ContractCatalogEntry[]> {
  const contractsApi = createContractsApi(config);
  const { data } = await contractsApi.listContracts();
  return (data.result ?? []).map((contract) => ({
    contractName: contract.contractName,
    label: contract.label,
    version: contract.version,
  }));
}

export async function getContractDefinition(config: RuntimeConfig, label: string): Promise<ContractDefinition> {
  const contractsApi = createContractsApi(config);
  const { data } = await contractsApi.getContract(label);
  return {
    abi: data.result?.abi
      ? {
          events: data.result.abi.events ?? {},
          methods: data.result.abi.methods ?? {},
        }
      : undefined,
    contractName: data.result?.contractName,
    label: data.result?.label ?? label,
    version: data.result?.version,
  };
}

export async function linkAddressToContract(
  config: RuntimeConfig,
  addressOrAlias: string,
  request: { label: string; startingBlock: string; version?: string },
): Promise<void> {
  const contractsApi = createContractsApi(config);
  await contractsApi.linkAddressContract(addressOrAlias, request);
}

export async function getEventIndexingStatus(
  config: RuntimeConfig,
  addressOrAlias: string,
  contract: string,
): Promise<{ isProcessingPastLogs: boolean }> {
  const contractsApi = createContractsApi(config);
  const response = await contractsApi.getEventIndexingStatus(addressOrAlias, contract);
  return {
    isProcessingPastLogs: response.data.result?.isProcessingPastLogs ?? false,
  };
}

export async function getAddressBalance(
  config: RuntimeConfig,
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
  config: RuntimeConfig,
  label: string,
  url: string,
): Promise<{
  id: number;
  label: string;
  secret?: string;
  subscriptions: string[];
  url: string;
}> {
  const existingResponse = await requestAdminJson<{
    result?: Array<{
      id: number;
      label: string;
      subscriptions: string[];
      url: string;
    }>;
  }>(config, "/webhooks");
  const existing = existingResponse.result ?? [];
  const found = existing.find((webhook) => webhook.label === label);

  if (found) {
    const updated = await requestAdminJson<{
      result: {
        id: number;
        label: string;
        subscriptions: string[];
        url: string;
      };
    }>(config, `/webhooks/${found.id}`, {
      body: JSON.stringify({
        label,
        subscriptions: [EVENT_EMITTED_WEBHOOK_SUBSCRIPTION],
        url,
      }),
      method: "PUT",
    });
    return {
      id: updated.result.id,
      label: updated.result.label,
      subscriptions: [...updated.result.subscriptions],
      url: updated.result.url,
    };
  }

  const created = await requestAdminJson<{
    result: {
      id: number;
      label: string;
      secret?: string;
      subscriptions: string[];
      url: string;
    };
  }>(config, "/webhooks", {
    body: JSON.stringify({
      label,
      subscriptions: [EVENT_EMITTED_WEBHOOK_SUBSCRIPTION],
      url,
    }),
    method: "POST",
  });

  return {
    id: created.result.id,
    label: created.result.label,
    secret: created.result.secret,
    subscriptions: [...created.result.subscriptions],
    url: created.result.url,
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
