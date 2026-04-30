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
