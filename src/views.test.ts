import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBalanceRows } from "./multibaas.js";
import { computeHolderConcentration, formatTokenBalance, formatTopHoldersEvidence } from "./views.js";

test("computeHolderConcentration derives top-N share from tracked positive balances", () => {
  const rows = normalizeBalanceRows([
    { address: "0x1", balance: "60" },
    { address: "0x2", balance: "25" },
    { address: "0x3", balance: "15" },
    { address: "0x4", balance: "0" },
  ]);

  const result = computeHolderConcentration(rows, 2, "helloworld_balance");

  assert.equal(result.kind, "holder-concentration");
  assert.equal(result.limit, 2);
  assert.equal(result.totalTrackedBalance, "100");
  assert.equal(result.coveredBalance, "85");
  assert.equal(result.concentrationBps, 8500);
  assert.equal(result.concentrationPct, "85.00%");
  assert.equal(result.holderCount, 3);
  assert.deepEqual(
    result.holders.map((holder) => [holder.address, holder.rawBalance]),
    [
      ["0x1", "60"],
      ["0x2", "25"],
    ],
  );
});

test("formatTopHoldersEvidence includes event query trace and partial sync caveat", () => {
  const text = formatTopHoldersEvidence(
    {
      contractAddress: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1",
      holders: [
        {
          address: "0x611f7bf868a6212f871e89f7e44684045ddfb09d",
          rawBalance: "93062640170000000000000000",
        },
      ],
      kind: "holder-list",
      limit: 10,
      queryName: "contract:0xb50721bcf8d664c30412cfbc6cf7a15145234ad1",
      tokenDecimals: 18,
      tokenSymbol: "ARB",
    },
    {
      contractLabel: "arbtokenethereum",
      status: "partial",
      statusReason: "Contract is still syncing historical events.",
    },
  );

  assert.match(text, /current indexed top 10 holder snapshot/i);
  assert.match(text, /rankings may move/i);
  assert.match(text, /Token: L1 bridged ARB `0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1`/i);
  assert.match(text, /Symbol: ARB/i);
  assert.match(text, /Decimals: 18/i);
  assert.match(text, /\| Rank \| Holder \| Balance \|/i);
  assert.match(text, /\| 1 \| `0x611f7bf868a6212f871e89f7e44684045ddfb09d` \| 93,062,640\.17 ARB \|/i);
  assert.match(text, /```event_query/i);
  assert.match(text, /purpose: reconstruct current ERC-20 holders from Transfer deltas/i);
  assert.match(text, /post_processing: scale raw uint256 balance by token decimals \(18\) in the runtime formatter/i);
  assert.match(text, /source: contract:0xb50721bcf8d664c30412cfbc6cf7a15145234ad1/i);
  assert.match(text, /status: syncing historical events; partial indexed snapshot/i);
  assert.match(text, /do not infer total supply, percentages, or concentration/i);
});

test("formatTokenBalance inserts ERC-20 decimals without floating point conversion", () => {
  assert.equal(formatTokenBalance("93062640170000000000000000", 18, "ARB"), "93,062,640.17 ARB");
  assert.equal(formatTokenBalance("1", 18, "ARB"), "<0.000001 ARB");
  assert.equal(formatTokenBalance("1000000", 6, "USDC"), "1 USDC");
  assert.equal(formatTokenBalance("12345", 0), "12,345");
  assert.equal(formatTokenBalance("10264298470590260000000012", 18, "ARB"), "10,264,298.47059 ARB");
});
