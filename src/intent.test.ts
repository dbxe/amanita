import test from "node:test";
import assert from "node:assert/strict";

import { parseIntent } from "./intent.js";

test("parseIntent recognizes top-holder queries", () => {
  assert.deepEqual(parseIntent("Give me the top 7 holders"), { kind: "top-holders", limit: 7 });
});

test("parseIntent recognizes balance watches", () => {
  assert.deepEqual(parseIntent("Alert me if the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 moves"), {
    kind: "create-watch",
    address: "0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172",
    label: undefined,
  });
});

test("parseIntent recognizes task listing requests", () => {
  assert.deepEqual(parseIntent("List tasks"), { kind: "list-tasks" });
});

test("parseIntent recognizes holder concentration requests", () => {
  assert.deepEqual(parseIntent("What is the top 5 holder concentration?"), {
    kind: "holder-concentration",
    limit: 5,
  });
});

test("parseIntent recognizes contract-targeted top-holder requests", () => {
  assert.deepEqual(parseIntent("Give me the top 5 holders for token 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5"), {
    kind: "top-holders",
    limit: 5,
    contractAddress: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
  });
});

test("parseIntent recognizes top-balance requests that need interface clarification", () => {
  assert.deepEqual(parseIntent("What are the top balances of this address 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5"), {
    kind: "top-holders",
    limit: 20,
    contractAddress: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
    needsInterfaceClarification: true,
  });
});

test("parseIntent recognizes token-name top-balance requests", () => {
  assert.deepEqual(parseIntent("What are the top balances of sampletoken?"), {
    kind: "top-holders",
    limit: 20,
    tokenName: "sampletoken",
  });
});

test("parseIntent recognizes token-targeted balance requests", () => {
  assert.deepEqual(
    parseIntent("What is the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 for token 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5?"),
    {
      kind: "balance",
      address: "0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172",
      contractAddress: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
    },
  );
});

test("parseIntent recognizes token-targeted watch requests", () => {
  assert.deepEqual(
    parseIntent("Alert me if the balance of 0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172 moves for token sampletoken"),
    {
      kind: "create-watch",
      address: "0xF9450D254A66ab06b30Cfa9c6e7AE1B7598c7172",
      label: undefined,
      tokenName: "sampletoken",
    },
  );
});
