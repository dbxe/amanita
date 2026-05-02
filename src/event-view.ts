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

function commonTimelineSelect(): EventViewFieldSpec[] {
  return [
    { alias: "contract_address", fieldType: "contract_address" },
    { alias: "contract_label", fieldType: "contract_label" },
    { alias: "event_signature", fieldType: "event_signature" },
    { alias: "block_number", fieldType: "block_number" },
    { alias: "triggered_at", fieldType: "triggered_at" },
    { alias: "tx_hash", fieldType: "tx_hash" },
  ];
}

export function buildArbitrumGovernorProposalCreatedEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  return {
    events: [
      {
        eventName: "ProposalCreated",
        filter,
        select: [
          ...commonTimelineSelect(),
          { alias: "proposal_id", fieldType: "input", inputIndex: 0, name: "proposalId" },
          { alias: "proposer", fieldType: "input", inputIndex: 1, name: "proposer" },
          { alias: "targets", fieldType: "input", inputIndex: 2, name: "targets" },
          { alias: "values", fieldType: "input", inputIndex: 3, name: "values" },
          { alias: "signatures", fieldType: "input", inputIndex: 4, name: "signatures" },
          { alias: "calldatas", fieldType: "input", inputIndex: 5, name: "calldatas" },
          { alias: "vote_start", fieldType: "input", inputIndex: 6, name: "voteStart" },
          { alias: "vote_end", fieldType: "input", inputIndex: 7, name: "voteEnd" },
          { alias: "description", fieldType: "input", inputIndex: 8, name: "description" },
        ],
      },
    ],
    order: "DESC",
    orderBy: "triggered_at",
  };
}

export function buildArbitrumGovernorLifecycleEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  return {
    events: [
      {
        eventName: "ProposalQueued",
        filter,
        select: [
          ...commonTimelineSelect(),
          { alias: "proposal_id", fieldType: "input", inputIndex: 0, name: "proposalId" },
          { alias: "eta", fieldType: "input", inputIndex: 1, name: "eta" },
        ],
      },
      {
        eventName: "ProposalExecuted",
        filter,
        select: [
          ...commonTimelineSelect(),
          { alias: "proposal_id", fieldType: "input", inputIndex: 0, name: "proposalId" },
        ],
      },
      {
        eventName: "ProposalCanceled",
        filter,
        select: [
          ...commonTimelineSelect(),
          { alias: "proposal_id", fieldType: "input", inputIndex: 0, name: "proposalId" },
        ],
      },
    ],
    order: "DESC",
    orderBy: "triggered_at",
  };
}

export function buildArbitrumGovernorVoteActivityEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  const voteSelect: EventViewFieldSpec[] = [
    ...commonTimelineSelect(),
    { alias: "voter", fieldType: "input", inputIndex: 0, name: "voter" },
    { alias: "proposal_id", fieldType: "input", inputIndex: 1, name: "proposalId" },
    { alias: "support", fieldType: "input", inputIndex: 2, name: "support" },
    { alias: "weight", fieldType: "input", inputIndex: 3, name: "weight" },
    { alias: "reason", fieldType: "input", inputIndex: 4, name: "reason" },
  ];

  return {
    events: [
      {
        eventName: "VoteCast",
        filter,
        select: voteSelect,
      },
      {
        eventName: "VoteCastWithParams",
        filter,
        select: voteSelect,
      },
    ],
    order: "DESC",
    orderBy: "triggered_at",
  };
}

export function buildArbitrumTimelockOperationEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  return {
    events: [
      {
        eventName: "CallScheduled",
        filter,
        select: [
          ...commonTimelineSelect(),
          { alias: "operation_id", fieldType: "input", inputIndex: 0, name: "id" },
          { alias: "index", fieldType: "input", inputIndex: 1, name: "index" },
          { alias: "target", fieldType: "input", inputIndex: 2, name: "target" },
          { alias: "value", fieldType: "input", inputIndex: 3, name: "value" },
          { alias: "data", fieldType: "input", inputIndex: 4, name: "data" },
          { alias: "predecessor", fieldType: "input", inputIndex: 5, name: "predecessor" },
          { alias: "delay", fieldType: "input", inputIndex: 6, name: "delay" },
        ],
      },
      {
        eventName: "CallExecuted",
        filter,
        select: [
          ...commonTimelineSelect(),
          { alias: "operation_id", fieldType: "input", inputIndex: 0, name: "id" },
          { alias: "index", fieldType: "input", inputIndex: 1, name: "index" },
          { alias: "target", fieldType: "input", inputIndex: 2, name: "target" },
          { alias: "value", fieldType: "input", inputIndex: 3, name: "value" },
          { alias: "data", fieldType: "input", inputIndex: 4, name: "data" },
        ],
      },
      {
        eventName: "Cancelled",
        filter,
        select: [
          ...commonTimelineSelect(),
          { alias: "operation_id", fieldType: "input", inputIndex: 0, name: "id" },
        ],
      },
    ],
    order: "DESC",
    orderBy: "triggered_at",
  };
}

export function buildArbitrumUpgradeExecutorActivityEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  const select: EventViewFieldSpec[] = [
    ...commonTimelineSelect(),
    { alias: "target", fieldType: "input", inputIndex: 0, name: "target" },
    { alias: "value", fieldType: "input", inputIndex: 1, name: "value" },
    { alias: "data", fieldType: "input", inputIndex: 2, name: "data" },
  ];

  return {
    events: [
      {
        eventName: "UpgradeExecuted",
        filter,
        select,
      },
      {
        eventName: "TargetCallExecuted",
        filter,
        select,
      },
    ],
    order: "DESC",
    orderBy: "triggered_at",
  };
}

export function buildStablecoinIssuerActivityEventViewSpec(target: ContractTargetReference): EventViewSpec {
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
        eventName: "Mint(address,address,uint256)",
        filter,
        select: [
          ...commonSelect,
          { alias: "actor", fieldType: "input", inputIndex: 0, name: "minter" },
          { alias: "counterparty", fieldType: "input", inputIndex: 1, name: "to" },
          { alias: "amount", fieldType: "input", inputIndex: 2, name: "amount" },
        ],
      },
      {
        eventName: "Burn(address,uint256)",
        filter,
        select: [
          ...commonSelect,
          { alias: "actor", fieldType: "input", inputIndex: 0, name: "burner" },
          { alias: "amount", fieldType: "input", inputIndex: 1, name: "amount" },
        ],
      },
    ],
    order: "DESC",
    orderBy: "block_number",
  };
}

export function buildUniswapV3NetLiquidityEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  return {
    events: [
      {
        eventName: "Mint(address,address,int24,int24,uint128,uint256,uint256)",
        filter,
        select: [
          { alias: "address", fieldType: "input", inputIndex: 1, name: "owner" },
          { aggregator: "add", alias: "liquidity", fieldType: "input", inputIndex: 4, name: "amount" },
        ],
      },
      {
        eventName: "Burn(address,int24,int24,uint128,uint256,uint256)",
        filter,
        select: [
          { alias: "address", fieldType: "input", inputIndex: 0, name: "owner" },
          { aggregator: "subtract", alias: "liquidity", fieldType: "input", inputIndex: 3, name: "amount" },
        ],
      },
    ],
    groupBy: "address",
    order: "DESC",
    orderBy: "liquidity",
  };
}

export function buildUniswapV3RecentActivityEventViewSpec(target: ContractTargetReference): EventViewSpec {
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
        eventName: "Mint(address,address,int24,int24,uint128,uint256,uint256)",
        filter,
        select: [
          ...commonSelect,
          { alias: "actor", fieldType: "input", inputIndex: 1, name: "owner" },
          { alias: "liquidity", fieldType: "input", inputIndex: 4, name: "amount" },
          { alias: "tick_lower", fieldType: "input", inputIndex: 2, name: "tickLower" },
          { alias: "tick_upper", fieldType: "input", inputIndex: 3, name: "tickUpper" },
        ],
      },
      {
        eventName: "Burn(address,int24,int24,uint128,uint256,uint256)",
        filter,
        select: [
          ...commonSelect,
          { alias: "actor", fieldType: "input", inputIndex: 0, name: "owner" },
          { alias: "liquidity", fieldType: "input", inputIndex: 3, name: "amount" },
          { alias: "tick_lower", fieldType: "input", inputIndex: 1, name: "tickLower" },
          { alias: "tick_upper", fieldType: "input", inputIndex: 2, name: "tickUpper" },
        ],
      },
      {
        eventName: "Collect(address,address,int24,int24,uint128,uint128)",
        filter,
        select: [
          ...commonSelect,
          { alias: "actor", fieldType: "input", inputIndex: 0, name: "owner" },
          { alias: "counterparty", fieldType: "input", inputIndex: 1, name: "recipient" },
          { alias: "amount0", fieldType: "input", inputIndex: 4, name: "amount0" },
          { alias: "amount1", fieldType: "input", inputIndex: 5, name: "amount1" },
        ],
      },
      {
        eventName: "Swap(address,address,int256,int256,uint160,uint128,int24)",
        filter,
        select: [
          ...commonSelect,
          { alias: "actor", fieldType: "input", inputIndex: 0, name: "sender" },
          { alias: "counterparty", fieldType: "input", inputIndex: 1, name: "recipient" },
          { alias: "amount0", fieldType: "input", inputIndex: 2, name: "amount0" },
          { alias: "amount1", fieldType: "input", inputIndex: 3, name: "amount1" },
          { alias: "liquidity", fieldType: "input", inputIndex: 5, name: "liquidity" },
          { alias: "tick", fieldType: "input", inputIndex: 6, name: "tick" },
        ],
      },
    ],
    order: "DESC",
    orderBy: "block_number",
  };
}

export function buildAaveV3NetBorrowersEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  return {
    events: [
      {
        eventName: "Borrow(address,address,address,uint256,uint8,uint256,uint16)",
        filter,
        select: [
          { alias: "address", fieldType: "input", inputIndex: 2, name: "onBehalfOf" },
          { aggregator: "add", alias: "borrow_amount", fieldType: "input", inputIndex: 3, name: "amount" },
        ],
      },
      {
        eventName: "Repay(address,address,address,uint256,bool)",
        filter,
        select: [
          { alias: "address", fieldType: "input", inputIndex: 1, name: "user" },
          { aggregator: "subtract", alias: "borrow_amount", fieldType: "input", inputIndex: 3, name: "amount" },
        ],
      },
    ],
    groupBy: "address",
    order: "DESC",
    orderBy: "borrow_amount",
  };
}

export function buildAaveV3TopLiquidatorsEventViewSpec(target: ContractTargetReference): EventViewSpec {
  const filter = [contractTargetFilter(target)];
  return {
    events: [
      {
        eventName: "LiquidationCall(address,address,address,uint256,uint256,address,bool)",
        filter,
        select: [
          { alias: "address", fieldType: "input", inputIndex: 5, name: "liquidator" },
          { aggregator: "add", alias: "debt_covered", fieldType: "input", inputIndex: 3, name: "debtToCover" },
        ],
      },
    ],
    groupBy: "address",
    order: "DESC",
    orderBy: "debt_covered",
  };
}

export function buildAaveV3RecentActivityEventViewSpec(target: ContractTargetReference): EventViewSpec {
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
        eventName: "Supply(address,address,address,uint256,uint16)",
        filter,
        select: [
          ...commonSelect,
          { alias: "reserve", fieldType: "input", inputIndex: 0, name: "reserve" },
          { alias: "actor", fieldType: "input", inputIndex: 2, name: "onBehalfOf" },
          { alias: "amount", fieldType: "input", inputIndex: 3, name: "amount" },
        ],
      },
      {
        eventName: "Withdraw(address,address,address,uint256)",
        filter,
        select: [
          ...commonSelect,
          { alias: "reserve", fieldType: "input", inputIndex: 0, name: "reserve" },
          { alias: "actor", fieldType: "input", inputIndex: 1, name: "user" },
          { alias: "counterparty", fieldType: "input", inputIndex: 2, name: "to" },
          { alias: "amount", fieldType: "input", inputIndex: 3, name: "amount" },
        ],
      },
      {
        eventName: "Borrow(address,address,address,uint256,uint8,uint256,uint16)",
        filter,
        select: [
          ...commonSelect,
          { alias: "reserve", fieldType: "input", inputIndex: 0, name: "reserve" },
          { alias: "actor", fieldType: "input", inputIndex: 2, name: "onBehalfOf" },
          { alias: "amount", fieldType: "input", inputIndex: 3, name: "amount" },
        ],
      },
      {
        eventName: "Repay(address,address,address,uint256,bool)",
        filter,
        select: [
          ...commonSelect,
          { alias: "reserve", fieldType: "input", inputIndex: 0, name: "reserve" },
          { alias: "actor", fieldType: "input", inputIndex: 1, name: "user" },
          { alias: "counterparty", fieldType: "input", inputIndex: 2, name: "repayer" },
          { alias: "amount", fieldType: "input", inputIndex: 3, name: "amount" },
        ],
      },
      {
        eventName: "LiquidationCall(address,address,address,uint256,uint256,address,bool)",
        filter,
        select: [
          ...commonSelect,
          { alias: "reserve", fieldType: "input", inputIndex: 1, name: "debtAsset" },
          { alias: "actor", fieldType: "input", inputIndex: 5, name: "liquidator" },
          { alias: "counterparty", fieldType: "input", inputIndex: 2, name: "user" },
          { alias: "amount", fieldType: "input", inputIndex: 3, name: "debtToCover" },
        ],
      },
    ],
    order: "DESC",
    orderBy: "block_number",
  };
}
