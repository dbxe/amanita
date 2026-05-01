import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  AddressesApi,
  type BaseContract,
  Configuration,
  ContractsApi,
  EventQueriesApi,
  type EventQuery,
} from "@curvegrid/multibaas-sdk";

import type { RuntimeConfig } from "./config.js";

const execFileAsync = promisify(execFile);

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
  contractName?: string;
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
  instances?: Array<{
    address: string;
    alias?: string;
  }>;
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

export interface ContractReadiness {
  address: string;
  alias?: string;
  contractLabel?: string;
  contractName?: string;
  isProcessingPastLogs: boolean;
  state: "ready" | "needs-link" | "syncing";
}

export interface TokenMetadata {
  address: string;
  alias?: string;
  contractLabel?: string;
  contractName?: string;
  decimals?: number;
  isProcessingPastLogs: boolean;
  name?: string;
  state: ContractReadiness["state"];
  symbol?: string;
  totalSupply?: string;
}

const QUERY_PAGE_LIMIT = 100;
const EVENT_EMITTED_WEBHOOK_SUBSCRIPTION = "event.emitted";
const CURL_MAX_BUFFER = 10 * 1024 * 1024;
const CONTRACT_BALANCE_SOURCE_PREFIX = "contract:";

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

function withSearchParams(
  url: URL,
  params?: Record<string, string | number | Array<string | number> | undefined>,
): URL {
  if (!params) {
    return url;
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url;
}

async function requestJsonViaCurl<T>(
  config: RuntimeConfig,
  pathname: string,
  options: {
    body?: unknown;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    params?: Record<string, string | number | Array<string | number> | undefined>;
  } = {},
): Promise<T> {
  const url = withSearchParams(new URL(adminApiUrl(config, pathname)), options.params);
  const args = [
    "--silent",
    "--show-error",
    "--location",
    "--request",
    options.method ?? "GET",
    url.toString(),
    "--header",
    "Accept: application/json",
    "--header",
    `Authorization: Bearer ${config.apiKey ?? "placeholder"}`,
    "--write-out",
    "\n%{http_code}",
  ];

  if (options.body !== undefined) {
    args.push(
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      JSON.stringify(options.body),
    );
  }

  const { stdout } = await execFileAsync("curl", args, {
    env: process.env,
    maxBuffer: CURL_MAX_BUFFER,
  });
  const normalizedOutput = stdout.replace(/\r\n/g, "\n");
  const statusSeparator = normalizedOutput.lastIndexOf("\n");

  if (statusSeparator === -1) {
    throw new Error(`Unexpected curl response while requesting ${url.toString()}`);
  }

  const bodyText = normalizedOutput.slice(0, statusSeparator);
  const statusText = normalizedOutput.slice(statusSeparator + 1).trim();
  const status = Number.parseInt(statusText, 10);

  if (!Number.isInteger(status)) {
    throw new Error(`Unable to parse curl status "${statusText}" for ${url.toString()}`);
  }

  if (status < 200 || status >= 300) {
    throw new Error(`MultiBaas request failed (${status}): ${bodyText.trim()}`);
  }

  return (bodyText.trim() ? JSON.parse(bodyText) : {}) as T;
}

async function withCurlFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
): Promise<T> {
  try {
    return await primary();
  } catch {
    return fallback();
  }
}

async function requestAdminJson<T>(
  config: RuntimeConfig,
  pathname: string,
  init?: RequestInit,
): Promise<T> {
  return requestJsonViaCurl<T>(config, pathname, {
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
    method: (init?.method?.toUpperCase() as "GET" | "POST" | "PUT" | "DELETE" | undefined) ?? "GET",
  });
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

export function normalizeTokenIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

function normalizeContractTarget(value: string): string {
  return isAddress(value) ? normalizeAddress(value) : value.trim().toLowerCase();
}

export function createContractBalanceSource(contractTarget: string): string {
  return `${CONTRACT_BALANCE_SOURCE_PREFIX}${normalizeContractTarget(contractTarget)}`;
}

export function getContractTargetFromBalanceSource(source: string): string | undefined {
  if (!source.startsWith(CONTRACT_BALANCE_SOURCE_PREFIX)) {
    return undefined;
  }

  return source.slice(CONTRACT_BALANCE_SOURCE_PREFIX.length).trim() || undefined;
}

export function resolveBalanceSource(source?: string): string {
  const trimmedSource = source?.trim();
  if (trimmedSource) {
    return trimmedSource;
  }

  throw new Error("A saved query name or token contract address is required for this balance view.");
}

export function findKnownAddressByTokenName(
  tokenName: string,
  knownAddresses: KnownAddress[],
  contractCatalog: ContractCatalogEntry[] = [],
): KnownAddress | undefined {
  const normalizedTokenName = normalizeTokenIdentifier(tokenName);
  if (!normalizedTokenName) {
    return undefined;
  }

  const aliasMatch = knownAddresses.find((entry) => normalizeTokenIdentifier(entry.alias) === normalizedTokenName);
  if (aliasMatch) {
    return aliasMatch;
  }

  for (const contract of contractCatalog) {
    if (normalizeTokenIdentifier(contract.contractName ?? "") !== normalizedTokenName) {
      continue;
    }
    const instance = contract.instances?.find((candidate) => candidate.alias?.trim() && candidate.address?.trim());
    if (!instance?.alias) {
      continue;
    }
    return {
      address: normalizeAddress(instance.address),
      alias: instance.alias,
      contractName: contract.contractName,
    };
  }

  return knownAddresses.find(
    (entry) => entry.contractName && normalizeTokenIdentifier(entry.contractName) === normalizedTokenName,
  );
}

export function buildContractBalanceEventQuery(contractAddress: string): EventQuery {
  const normalizedTarget = normalizeContractTarget(contractAddress);
  const filterFieldType = isAddress(contractAddress) ? "contract_address" : "contract_address_alias";
  return {
    events: [
      {
        eventName: "Transfer(address,address,uint256)",
        filter: {
          children: [
            {
              fieldType: filterFieldType,
              operator: "equal",
              value: normalizedTarget,
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
              fieldType: filterFieldType,
              operator: "equal",
              value: normalizedTarget,
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
  const response = await withCurlFallback(
    async () => {
      const result = await api.executeEventQuery(queryName, offset, limit);
      return result.data as unknown;
    },
    () =>
      requestJsonViaCurl<unknown>(config, `/queries/${encodeURIComponent(queryName)}/results`, {
        params: { limit, offset },
      }),
  );
  return normalizeBalanceRows(readRows(response));
}

export async function executeContractBalanceQuery(
  config: RuntimeConfig,
  contractAddress: string,
  limit: number,
  offset = 0,
): Promise<BalanceRow[]> {
  const api = createEventQueriesApi(config);
  const response = await withCurlFallback(
    async () => {
      const result = await api.executeArbitraryEventQuery(
        buildContractBalanceEventQuery(contractAddress),
        offset,
        limit,
      );
      return result.data as unknown;
    },
    () =>
      requestJsonViaCurl<unknown>(config, "/queries", {
        body: buildContractBalanceEventQuery(contractAddress),
        method: "POST",
        params: { limit, offset },
      }),
  );
  return normalizeBalanceRows(readRows(response));
}

export async function executeArbitraryEventQueryRows(
  config: RuntimeConfig,
  query: EventQuery,
  limit: number,
  offset = 0,
): Promise<Array<Record<string, unknown>>> {
  const api = createEventQueriesApi(config);
  const response = await withCurlFallback(
    async () => {
      const result = await api.executeArbitraryEventQuery(query, offset, limit);
      return result.data as unknown;
    },
    () =>
      requestJsonViaCurl<unknown>(config, "/queries", {
        body: query,
        method: "POST",
        params: { limit, offset },
      }),
  );
  return readRows(response);
}

export async function executeBalanceSourceQuery(
  config: RuntimeConfig,
  source: string,
  limit: number,
  offset = 0,
): Promise<BalanceRow[]> {
  const contractTarget = getContractTargetFromBalanceSource(source);
  return contractTarget
    ? executeContractBalanceQuery(config, contractTarget, limit, offset)
    : executeSavedBalanceQuery(config, source, limit, offset);
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

export async function fetchBalanceSourceSnapshot(
  config: RuntimeConfig,
  source: string,
  limit: number,
): Promise<Map<string, BalanceRow>> {
  const contractTarget = getContractTargetFromBalanceSource(source);
  return contractTarget
    ? fetchContractBalanceSnapshot(config, contractTarget, limit)
    : fetchBalanceSnapshot(config, source, limit);
}

export async function inspectContractReadiness(
  config: RuntimeConfig,
  address: string,
): Promise<{
  contractLabel?: string;
  isProcessingPastLogs: boolean;
}> {
  const normalizedAddress = normalizeAddress(address);
  const addressDetails = await getAddressRegistration(config, normalizedAddress);
  const linkedContracts = addressDetails.contracts ?? [];
  const contractLabel = linkedContracts[0]?.label;

  if (!contractLabel) {
    return {
      isProcessingPastLogs: false,
    };
  }

  const status = await getEventIndexingStatus(config, normalizedAddress, contractLabel);
  return {
    contractLabel,
    isProcessingPastLogs: status.isProcessingPastLogs,
  };
}

export async function getAddressRegistration(config: RuntimeConfig, addressOrAlias: string): Promise<AddressRegistration> {
  const normalizedAddressOrAlias = addressOrAlias.startsWith("0x") ? normalizeAddress(addressOrAlias) : addressOrAlias.trim();
  const addressesApi = createAddressesApi(config);
  const data = await withCurlFallback(
    async () => {
      const response = await addressesApi.getAddress(normalizedAddressOrAlias, ["contractLookup"]);
      return response.data;
    },
    () =>
      requestJsonViaCurl<{
        result?: {
          address?: string;
          alias?: string;
          contracts?: Array<{ label: string; name?: string; version?: string }>;
        };
      }>(config, `/chains/ethereum/addresses/${encodeURIComponent(normalizedAddressOrAlias)}`, {
        params: { include: "contractLookup" },
      }),
  );
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
  const data = await withCurlFallback(
    async () => {
      const response = await addressesApi.listAddresses();
      return response.data;
    },
    () =>
      requestJsonViaCurl<{
        result?: Array<{
          address?: string;
          alias?: string;
        }>;
      }>(config, "/chains/ethereum/addresses"),
  );
  return (data.result ?? []).flatMap((entry) => {
    if (!entry.alias || !entry.address) {
      return [];
    }
    return [{ address: normalizeAddress(entry.address), alias: entry.alias }];
  });
}

export async function resolveKnownAddress(config: RuntimeConfig, tokenName: string): Promise<KnownAddress | undefined> {
  const [knownAddresses, contractCatalog] = await Promise.all([
    listKnownAddresses(config),
    listContractCatalog(config),
  ]);
  return findKnownAddressByTokenName(tokenName, knownAddresses, contractCatalog);
}

export async function setAddressAlias(config: RuntimeConfig, address: string, alias: string): Promise<void> {
  const addressesApi = createAddressesApi(config);
  await withCurlFallback(
    async () => {
      await addressesApi.setAddress({
        address: normalizeAddress(address),
        alias,
      });
    },
    () =>
      requestJsonViaCurl(config, "/chains/ethereum/addresses", {
        body: {
          address: normalizeAddress(address),
          alias,
        },
        method: "POST",
      }).then(() => undefined),
  );
}

export async function listContractCatalog(config: RuntimeConfig): Promise<ContractCatalogEntry[]> {
  const contractsApi = createContractsApi(config);
  const data = await withCurlFallback(
    async () => {
      const response = await contractsApi.listContracts();
      return response.data;
    },
    () =>
      requestJsonViaCurl<{
        result?: Array<{
          contractName?: string;
          label: string;
          version?: string;
          instances?: Array<{ address: string; alias?: string }>;
        }>;
      }>(config, "/contracts"),
  );
  return (data.result ?? []).map((contract) => ({
    contractName: contract.contractName,
    instances: (contract.instances ?? []).map((instance) => ({
      address: normalizeAddress(instance.address),
      alias: instance.alias?.trim() || undefined,
    })),
    label: contract.label,
    version: contract.version,
  }));
}

export async function getContractDefinition(config: RuntimeConfig, label: string): Promise<ContractDefinition> {
  const contractsApi = createContractsApi(config);
  const data = await withCurlFallback(
    async () => {
      const response = await contractsApi.getContract(label);
      return response.data;
    },
    () =>
      requestJsonViaCurl<{
        result?: {
          abi?: {
            events?: Record<string, unknown>;
            methods?: Record<string, unknown>;
          };
          contractName?: string;
          label?: string;
          version?: string;
        };
      }>(config, `/contracts/${encodeURIComponent(label)}`),
  );
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

export async function createContractDefinition(
  config: RuntimeConfig,
  contract: Pick<BaseContract, "contractName" | "label" | "rawAbi" | "version"> & {
    bin?: string;
    developerDoc?: string;
    metadata?: string;
    userDoc?: string;
  },
): Promise<void> {
  const contractsApi = createContractsApi(config);
  await withCurlFallback(
    async () => {
      await contractsApi.createContract(contract.label, {
        bin: contract.bin,
        contractName: contract.contractName,
        developerDoc: contract.developerDoc,
        label: contract.label,
        metadata: contract.metadata,
        rawAbi: contract.rawAbi,
        userDoc: contract.userDoc,
        version: contract.version,
      });
    },
    () =>
      requestJsonViaCurl(config, `/contracts/${encodeURIComponent(contract.label)}`, {
        body: {
          bin: contract.bin,
          contractName: contract.contractName,
          developerDoc: contract.developerDoc,
          label: contract.label,
          metadata: contract.metadata,
          rawAbi: contract.rawAbi,
          userDoc: contract.userDoc,
          version: contract.version,
        },
        method: "PUT",
      }).then(() => undefined),
  );
}

export async function linkAddressToContract(
  config: RuntimeConfig,
  addressOrAlias: string,
  request: { label: string; startingBlock: string; version?: string },
): Promise<void> {
  const contractsApi = createContractsApi(config);
  await withCurlFallback(
    async () => {
      await contractsApi.linkAddressContract(addressOrAlias, request);
    },
    () =>
      requestJsonViaCurl(config, `/chains/ethereum/addresses/${encodeURIComponent(addressOrAlias)}/contracts`, {
        body: request,
        method: "POST",
      }).then(() => undefined),
  );
}

export async function getEventIndexingStatus(
  config: RuntimeConfig,
  addressOrAlias: string,
  contract: string,
): Promise<{ isProcessingPastLogs: boolean }> {
  const contractsApi = createContractsApi(config);
  const response = await withCurlFallback(
    async () => {
      const result = await contractsApi.getEventIndexingStatus(addressOrAlias, contract);
      return result.data;
    },
    () =>
      requestJsonViaCurl<{
        result?: {
          isProcessingPastLogs?: boolean;
        };
      }>(
        config,
        `/chains/ethereum/addresses/${encodeURIComponent(addressOrAlias)}/contracts/${encodeURIComponent(contract)}/status`,
      ),
  );
  return {
    isProcessingPastLogs: response.result?.isProcessingPastLogs ?? false,
  };
}

function readContractScalarOutput(output: unknown): string | undefined {
  if (typeof output === "string") {
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof output === "number") {
    if (!Number.isFinite(output)) {
      return undefined;
    }
    return output.toString();
  }

  if (typeof output === "bigint") {
    return output.toString();
  }

  if (Array.isArray(output)) {
    for (const entry of output) {
      const value = readContractScalarOutput(entry);
      if (value) {
        return value;
      }
    }
    return undefined;
  }

  if (typeof output === "object" && output !== null) {
    for (const entry of Object.values(output)) {
      const value = readContractScalarOutput(entry);
      if (value) {
        return value;
      }
    }
  }

  return undefined;
}

export async function getContractStringValue(
  config: RuntimeConfig,
  addressOrAlias: string,
  contract: string,
  method: string,
  signature: string,
): Promise<string | undefined> {
  const contractsApi = createContractsApi(config);

  const response = await withCurlFallback(
    async () => {
      const result = await contractsApi.callContractFunction(addressOrAlias, contract, method, {
        args: [],
        contractOverride: true,
        signature,
      });
      return result.data as { result?: { output?: unknown } };
    },
    () =>
      requestJsonViaCurl<{ result?: { output?: unknown } }>(
        config,
        `/chains/ethereum/addresses/${encodeURIComponent(addressOrAlias)}/contracts/${encodeURIComponent(contract)}/methods/${encodeURIComponent(method)}`,
        {
          body: {
            args: [],
            contractOverride: true,
            signature,
          },
          method: "POST",
        },
      ),
  );

  return readContractScalarOutput(response.result?.output);
}

export async function getErc20TokenName(config: RuntimeConfig, addressOrAlias: string): Promise<string | undefined> {
  try {
    return await getContractStringValue(config, addressOrAlias, "erc20interface", "name", "name()");
  } catch {
    return undefined;
  }
}

export async function getErc20TokenSymbol(config: RuntimeConfig, addressOrAlias: string): Promise<string | undefined> {
  try {
    return await getContractStringValue(config, addressOrAlias, "erc20interface", "symbol", "symbol()");
  } catch {
    return undefined;
  }
}

export async function getErc20TokenDecimals(config: RuntimeConfig, addressOrAlias: string): Promise<number | undefined> {
  try {
    const value = await getContractStringValue(config, addressOrAlias, "erc20interface", "decimals", "decimals()");
    if (!value || !/^\d+$/.test(value)) {
      return undefined;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function getErc20TotalSupply(config: RuntimeConfig, addressOrAlias: string): Promise<string | undefined> {
  try {
    return await getContractStringValue(config, addressOrAlias, "erc20interface", "totalSupply", "totalSupply()");
  } catch {
    return undefined;
  }
}

export async function resolveContractReadiness(config: RuntimeConfig, addressOrAlias: string): Promise<ContractReadiness> {
  const registration = await getAddressRegistration(config, addressOrAlias);
  const contract = registration.contracts[0];

  if (!contract) {
    return {
      address: registration.address,
      alias: registration.alias,
      isProcessingPastLogs: false,
      state: "needs-link",
    };
  }

  const status = await getEventIndexingStatus(config, registration.address, contract.label);
  return {
    address: registration.address,
    alias: registration.alias,
    contractLabel: contract.label,
    contractName: contract.name,
    isProcessingPastLogs: status.isProcessingPastLogs,
    state: status.isProcessingPastLogs ? "syncing" : "ready",
  };
}

export async function getErc20Metadata(config: RuntimeConfig, addressOrAlias: string): Promise<TokenMetadata> {
  const readiness = await resolveContractReadiness(config, addressOrAlias);
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    getErc20TokenName(config, readiness.address),
    getErc20TokenSymbol(config, readiness.address),
    getErc20TokenDecimals(config, readiness.address),
    getErc20TotalSupply(config, readiness.address),
  ]);

  return {
    address: readiness.address,
    alias: readiness.alias,
    contractLabel: readiness.contractLabel,
    contractName: readiness.contractName,
    decimals,
    isProcessingPastLogs: readiness.isProcessingPastLogs,
    name,
    state: readiness.state,
    symbol,
    totalSupply,
  };
}

export async function getAddressBalance(
  config: RuntimeConfig,
  queryName: string,
  address: string,
): Promise<BalanceRow> {
  const normalizedAddress = normalizeAddress(address);
  const snapshot = await fetchBalanceSourceSnapshot(config, queryName, config.scanLimit);
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
