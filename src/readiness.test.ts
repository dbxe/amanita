import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBalanceMonitorReadiness } from "./readiness.js";

test("evaluateBalanceMonitorReadiness marks a balance monitor ready with the current balance", async () => {
  const readiness = await evaluateBalanceMonitorReadiness("0xabc", "contract:0xdef", {
    lookupBalance: async () => ({ rawBalance: "42" }),
  });

  assert.equal(readiness.state, "ready");
  assert.equal(readiness.currentBalance, "42");
  assert.equal(readiness.waitCondition, undefined);
});

test("evaluateBalanceMonitorReadiness turns link failures into explicit wait states", async () => {
  const readiness = await evaluateBalanceMonitorReadiness("0xabc", "contract:0xdef", {
    lookupBalance: async () => {
      throw new Error("Contract is not linked for this address yet");
    },
  });

  assert.equal(readiness.state, "needs-link");
  assert.equal(readiness.waitCondition?.state, "needs-link");
  assert.match(readiness.waitCondition?.reason ?? "", /not linked/i);
});
