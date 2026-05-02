import assert from "node:assert/strict";
import test from "node:test";

import {
  buildArbitrumGovernorLifecycleEventViewSpec,
  buildArbitrumGovernorProposalCreatedEventViewSpec,
  buildArbitrumGovernorVoteActivityEventViewSpec,
  buildArbitrumTimelockOperationEventViewSpec,
  buildArbitrumUpgradeExecutorActivityEventViewSpec,
  buildErc20BalanceEventViewSpec,
  buildTokenControlTimelineEventViewSpec,
  compileEventViewSpec,
} from "./event-view.js";

test("compileEventViewSpec builds an ERC-20 balance reconstruction query", () => {
  const query = compileEventViewSpec(
    buildErc20BalanceEventViewSpec({ kind: "address", value: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }),
  );

  assert.equal(query.groupBy, "address");
  assert.equal(query.orderBy, "balance");
  assert.equal(query.order, "DESC");
  assert.equal(query.events.length, 2);
  assert.equal(query.events[0]?.eventName, "Transfer(address,address,uint256)");
  assert.equal(query.events[0]?.filter?.children?.[0]?.fieldType, "contract_address");
  assert.equal(query.events[0]?.filter?.children?.[0]?.value, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
  assert.equal(query.events[0]?.select?.[1]?.aggregator, "add");
  assert.equal(query.events[1]?.select?.[1]?.aggregator, "subtract");
});

test("compileEventViewSpec builds a token control timeline query", () => {
  const query = compileEventViewSpec(buildTokenControlTimelineEventViewSpec({ kind: "alias", value: "usdc" }));

  assert.equal(query.orderBy, "block_number");
  assert.equal(query.order, "DESC");
  assert.ok((query.events ?? []).some((event) => event.eventName === "Blacklist(address)"));
  assert.ok((query.events ?? []).some((event) => event.eventName === "OwnershipTransferred(address,address)"));
  assert.equal(query.events?.[0]?.filter?.children?.[0]?.fieldType, "contract_address_alias");
  assert.equal(query.events?.[0]?.filter?.children?.[0]?.value, "usdc");
});

test("compileEventViewSpec builds Arbitrum governance incident event queries", () => {
  const target = { kind: "address" as const, value: "0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9" };
  const proposalQuery = compileEventViewSpec(buildArbitrumGovernorProposalCreatedEventViewSpec(target));
  const lifecycleQuery = compileEventViewSpec(buildArbitrumGovernorLifecycleEventViewSpec(target));
  const voteQuery = compileEventViewSpec(buildArbitrumGovernorVoteActivityEventViewSpec(target));
  const timelockQuery = compileEventViewSpec(
    buildArbitrumTimelockOperationEventViewSpec({
      kind: "address",
      value: "0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0",
    }),
  );
  const executorQuery = compileEventViewSpec(
    buildArbitrumUpgradeExecutorActivityEventViewSpec({
      kind: "address",
      value: "0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827",
    }),
  );

  assert.equal(proposalQuery.events?.[0]?.eventName, "ProposalCreated");
  assert.ok(proposalQuery.events?.[0]?.select?.some((field) => field.alias === "description"));
  assert.ok((lifecycleQuery.events ?? []).some((event) => event.eventName === "ProposalQueued"));
  assert.ok((lifecycleQuery.events ?? []).some((event) => event.eventName === "ProposalExecuted"));
  assert.ok((voteQuery.events ?? []).some((event) => event.eventName === "VoteCast"));
  assert.ok((voteQuery.events ?? []).some((event) => event.eventName === "VoteCastWithParams"));
  assert.ok((timelockQuery.events ?? []).some((event) => event.eventName === "CallScheduled"));
  assert.ok((timelockQuery.events ?? []).some((event) => event.eventName === "CallExecuted"));
  assert.ok((executorQuery.events ?? []).some((event) => event.eventName === "UpgradeExecuted"));
  assert.ok((executorQuery.events ?? []).some((event) => event.eventName === "TargetCallExecuted"));
});
