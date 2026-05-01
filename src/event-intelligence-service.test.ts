import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveEventInvestigationLeads,
  formatEventCapabilityInspection,
  formatEventInvestigation,
} from "./event-intelligence-service.js";

test("deriveEventInvestigationLeads suggests stablecoin control and issuer leads from fiat token events", () => {
  const leads = deriveEventInvestigationLeads({
    eventNames: ["Transfer", "Mint", "Burn", "Blacklist", "UnBlacklist", "Pause", "Unpause", "Upgraded", "AdminChanged"],
    methodNames: ["name", "symbol", "decimals", "totalSupply", "balanceOf", "paused"],
  });

  assert.deepEqual(
    leads.map((lead) => lead.id),
    ["stablecoin_issuer_activity", "token_control_timeline", "holder_distribution"],
  );
});

test("deriveEventInvestigationLeads suggests Uniswap v3 investigations from pool surface", () => {
  const leads = deriveEventInvestigationLeads({
    eventNames: ["Mint", "Burn", "Collect", "Swap"],
    methodNames: ["slot0", "liquidity"],
  });

  assert.deepEqual(
    leads.map((lead) => lead.id),
    ["uniswap_v3_net_liquidity", "uniswap_v3_recent_activity"],
  );
});

test("deriveEventInvestigationLeads suggests Aave v3 investigations from pool surface", () => {
  const leads = deriveEventInvestigationLeads({
    eventNames: ["Supply", "Withdraw", "Borrow", "Repay", "LiquidationCall"],
    methodNames: [],
  });

  assert.deepEqual(
    leads.map((lead) => lead.id),
    ["aave_v3_net_borrowers", "aave_v3_top_liquidators", "aave_v3_recent_activity"],
  );
});

test("formatEventCapabilityInspection renders discovered leads and abi source", () => {
  const text = formatEventCapabilityInspection({
    eventNames: ["Borrow", "LiquidationCall", "Repay", "Supply", "Withdraw"],
    leads: deriveEventInvestigationLeads({
      eventNames: ["Borrow", "LiquidationCall", "Repay", "Supply", "Withdraw"],
      methodNames: [],
    }),
    methodNames: [],
    readiness: {
      address: "0xaave",
      isProcessingPastLogs: false,
      state: "ready",
    },
    resolvedAddress: "0xaave",
    sourceContractLabel: "aavev3pool",
    sourceContractName: "Pool",
    sourceKind: "linked-contract",
  });

  assert.match(text, /Event capability inspection/);
  assert.match(text, /ABI source: linked-contract/);
  assert.match(text, /aave_v3_top_liquidators: Rank liquidators by debt covered/i);
});

test("formatEventInvestigation renders syncing guidance instead of false empty results", () => {
  const text = formatEventInvestigation({
    lead: {
      id: "stablecoin_issuer_activity",
      rationale: "Mint and burn events expose issuer-side supply creation and redemption flows.",
      summary: "Inspect recent mint and burn activity by issuer-facing actors.",
      title: "Stablecoin issuer activity",
    },
    limit: 10,
    readiness: {
      address: "0xjpyc",
      isProcessingPastLogs: true,
      state: "syncing",
    },
    resolvedAddress: "0xjpyc",
    rows: [],
  });

  assert.match(text, /Readiness: syncing/);
  assert.match(text, /still syncing historical events/i);
  assert.doesNotMatch(text, /No matching events were found/i);
});

test("formatEventInvestigation renders activity rows for recent protocol events", () => {
  const text = formatEventInvestigation({
    lead: {
      id: "uniswap_v3_recent_activity",
      rationale: "Pool events show swaps, LP adds\\/removes, and fee collections without relying on NFT-manager joins.",
      summary: "Inspect the latest swaps, liquidity changes, and fee collections.",
      title: "Uniswap v3 recent activity",
    },
    limit: 2,
    readiness: {
      address: "0xpool",
      isProcessingPastLogs: false,
      state: "ready",
    },
    resolvedAddress: "0xpool",
    rows: [
      {
        actor: "0xactor",
        amount0: "-100",
        amount1: "200000",
        block_number: "123",
        event_signature: "Swap(address,address,int256,int256,uint160,uint128,int24)",
        tick: "100",
        triggered_at: "2026-05-01T00:00:00Z",
        tx_hash: "0xtx",
      },
    ],
  });

  assert.match(text, /Uniswap v3 recent activity/);
  assert.match(text, /Lead: uniswap_v3_recent_activity/);
  assert.match(text, /Swap\(address,address,int256,int256,uint160,uint128,int24\) @ block 123/);
  assert.match(text, /actor=0xactor/);
  assert.match(text, /amount1=200000/);
});
