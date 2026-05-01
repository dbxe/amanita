import assert from "node:assert/strict";
import test from "node:test";

import {
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
