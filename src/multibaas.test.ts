import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContractBalanceEventQuery,
  createSignature,
  normalizeBalanceRows,
  selectTopPositiveHolders,
  verifyWebhookSignature,
} from "./multibaas.js";

test("normalizeBalanceRows coerces strings and numbers into bigint-backed rows", () => {
  const rows = normalizeBalanceRows([
    { address: "0xABC", balance: "100" },
    { address: "0xdef", balance: 5 },
  ]);

  assert.deepEqual(
    rows.map((row) => ({ address: row.address, rawBalance: row.rawBalance, balance: row.balance.toString() })),
    [
      { address: "0xabc", rawBalance: "100", balance: "100" },
      { address: "0xdef", rawBalance: "5", balance: "5" },
    ],
  );
});

test("selectTopPositiveHolders sorts descending and filters non-positive balances", () => {
  const rows = normalizeBalanceRows([
    { address: "0x1", balance: "10" },
    { address: "0x2", balance: "0" },
    { address: "0x3", balance: "25" },
    { address: "0x4", balance: "-1" },
  ]);

  const selected = selectTopPositiveHolders(rows, 2);

  assert.deepEqual(
    selected.map((row) => [row.address, row.rawBalance]),
    [
      ["0x3", "25"],
      ["0x1", "10"],
    ],
  );
});

test("verifyWebhookSignature accepts the signature generated from body + timestamp", () => {
  const body = Buffer.from('[{"event":"event.emitted"}]', "utf8");
  const timestamp = "1714444444";
  const secret = "test-secret";
  const signature = createSignature(body, timestamp, secret);

  assert.equal(verifyWebhookSignature(body, timestamp, signature, secret), true);
  assert.equal(verifyWebhookSignature(body, timestamp, "not-valid", secret), false);
});

test("buildContractBalanceEventQuery filters transfer math by contract address", () => {
  const query = buildContractBalanceEventQuery("0xD26fde38F244Dcbb13e8017347Ac37804d926Bb5");
  const children = query.events?.[0]?.filter?.children;

  assert.equal(query.groupBy, "address");
  assert.equal(children?.[0]?.fieldType, "contract_address");
  assert.equal(children?.[0]?.value, "0xd26fde38f244dcbb13e8017347ac37804d926bb5");
});
