import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBalanceRows } from "./multibaas.js";
import { computeHolderConcentration } from "./views.js";

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
