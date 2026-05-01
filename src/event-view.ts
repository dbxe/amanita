import type { EventQuery, EventQueryEvent, EventQueryField, EventQueryFilter } from "@curvegrid/multibaas-sdk";

import { normalizeAddress } from "./multibaas.js";

export type EventViewFieldType =
  | "input"
  | "contract_label"
  | "contract_name"
  | "contract_address"
  | "contract_address_alias"
  | "block_number"
  | "triggered_at"
  | "event_signature"
  | "block_hash"
  | "tx_hash"
  | "tx_from";

export interface EventViewFieldSpec {
  aggregator?: "add" | "subtract" | "first" | "last" | "min" | "max";
  alias: string;
  fieldType: EventViewFieldType;
  inputIndex?: number;
  name?: string;
}

export interface EventViewFilterSpec {
  fieldType: EventViewFieldType;
  inputIndex?: number;
  name?: string;
  operator: "equal";
  value: string;
}

export interface EventViewEventSpec {
  eventName: string;
  filter?: EventViewFilterSpec[];
  select: EventViewFieldSpec[];
}

export interface EventViewSpec {
  events: EventViewEventSpec[];
  groupBy?: string;
  order?: "ASC" | "DESC";
  orderBy?: string;
}

export type ContractTargetReference =
  | { kind: "address"; value: string }
  | { kind: "alias"; value: string };

function contractTargetFilter(target: ContractTargetReference): EventViewFilterSpec {
  return {
    fieldType: target.kind === "address" ? "contract_address" : "contract_address_alias",
    operator: "equal",
    value: target.kind === "address" ? normalizeAddress(target.value) : target.value.trim(),
  };
}

function compileField(field: EventViewFieldSpec): EventQueryField {
  return {
    ...(field.aggregator ? { aggregator: field.aggregator } : {}),
    alias: field.alias,
    ...(field.fieldType === "input"
      ? {
          ...(field.inputIndex !== undefined ? { inputIndex: field.inputIndex } : {}),
          ...(field.name ? { name: field.name } : {}),
        }
      : {}),
    type: field.fieldType,
  };
}

export function compileEventViewSpec(spec: EventViewSpec): EventQuery {
  return {
    events: spec.events.map((event): EventQueryEvent => ({
      eventName: event.eventName,
      filter: event.filter && event.filter.length > 0
        ? {
            children: event.filter.map((filter): EventQueryFilter => ({
              ...(filter.fieldType === "input"
                ? {
                    ...(filter.inputIndex !== undefined ? { inputIndex: filter.inputIndex } : {}),
                    ...(filter.name ? { name: filter.name } : {}),
                  }
                : {}),
              fieldType: filter.fieldType,
              operator: filter.operator,
              value: filter.value,
            })),
            rule: "and",
          }
        : undefined,
      select: event.select.map((field) => compileField(field)),
    })),
    groupBy: spec.groupBy,
    order: spec.order,
    orderBy: spec.orderBy,
  };
}

export function buildErc20BalanceEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  return {
    events: [
      {
        eventName: "Transfer(address,address,uint256)",
        filter,
        select: [
          { alias: "address", fieldType: "input", inputIndex: 1, name: "to" },
          { aggregator: "add", alias: "balance", fieldType: "input", inputIndex: 2, name: "tokens" },
        ],
      },
      {
        eventName: "Transfer(address,address,uint256)",
        filter,
        select: [
          { alias: "address", fieldType: "input", inputIndex: 0, name: "from" },
          { aggregator: "subtract", alias: "balance", fieldType: "input", inputIndex: 2, name: "tokens" },
        ],
      },
    ],
    groupBy: "address",
    order: "DESC",
    orderBy: "balance",
  };
}

export function buildTokenControlTimelineEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  const commonSelect: EventViewFieldSpec[] = [
    { alias: "contract_address", fieldType: "contract_address" },
    { alias: "event_signature", fieldType: "event_signature" },
    { alias: "block_number", fieldType: "block_number" },
    { alias: "triggered_at", fieldType: "triggered_at" },
    { alias: "tx_hash", fieldType: "tx_hash" },
  ];

  return {
    events: [
      {
        eventName: "Pause()",
        filter,
        select: commonSelect,
      },
      {
        eventName: "Unpause()",
        filter,
        select: commonSelect,
      },
      {
        eventName: "Blacklist(address)",
        filter,
        select: [...commonSelect, { alias: "account", fieldType: "input", inputIndex: 0, name: "account" }],
      },
      {
        eventName: "UnBlacklist(address)",
        filter,
        select: [...commonSelect, { alias: "account", fieldType: "input", inputIndex: 0, name: "account" }],
      },
      {
        eventName: "RoleGranted(bytes32,address,address)",
        filter,
        select: [
          ...commonSelect,
          { alias: "role", fieldType: "input", inputIndex: 0, name: "role" },
          { alias: "account", fieldType: "input", inputIndex: 1, name: "account" },
          { alias: "sender", fieldType: "input", inputIndex: 2, name: "sender" },
        ],
      },
      {
        eventName: "RoleRevoked(bytes32,address,address)",
        filter,
        select: [
          ...commonSelect,
          { alias: "role", fieldType: "input", inputIndex: 0, name: "role" },
          { alias: "account", fieldType: "input", inputIndex: 1, name: "account" },
          { alias: "sender", fieldType: "input", inputIndex: 2, name: "sender" },
        ],
      },
      {
        eventName: "OwnershipTransferred(address,address)",
        filter,
        select: [
          ...commonSelect,
          { alias: "previous_owner", fieldType: "input", inputIndex: 0, name: "previousOwner" },
          { alias: "new_owner", fieldType: "input", inputIndex: 1, name: "newOwner" },
        ],
      },
      {
        eventName: "Upgraded(address)",
        filter,
        select: [...commonSelect, { alias: "implementation", fieldType: "input", inputIndex: 0, name: "implementation" }],
      },
      {
        eventName: "AdminChanged(address,address)",
        filter,
        select: [
          ...commonSelect,
          { alias: "previous_admin", fieldType: "input", inputIndex: 0, name: "previousAdmin" },
          { alias: "new_admin", fieldType: "input", inputIndex: 1, name: "newAdmin" },
        ],
      },
    ],
    order: "DESC",
    orderBy: "block_number",
  };
}
