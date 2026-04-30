import assert from "node:assert/strict";
import test from "node:test";

import {
  createBalanceWatchPlan,
  createPlanFromIntent,
  evaluateBalanceWatchReadiness,
} from "./planning.js";

test("createBalanceWatchPlan returns a typed plan for the balance-watch flow", () => {
  const plan = createBalanceWatchPlan({
    address: "0xabc",
    label: "whale",
    queryName: "helloworld_balance",
    rawText: "Alert me if the balance of 0xabc moves",
  });

  assert.equal(plan.kind, "balance-watch");
  assert.equal(plan.intent.kind, "create-watch");
  assert.equal(plan.intent.address, "0xabc");
  assert.equal(plan.intent.label, "whale");
  assert.equal(plan.viewSpec.kind, "balance-watch");
  assert.equal(plan.viewSpec.queryName, "helloworld_balance");
  assert.equal(plan.readiness.state, "ready");
  assert.equal(plan.executionPlan.steps.map((step) => step.kind).join(","), "resolve-balance,persist-watch,evaluate-watch");
});

test("evaluateBalanceWatchReadiness marks a plan ready with the current balance", async () => {
  const plan = createBalanceWatchPlan({
    address: "0xabc",
    queryName: "helloworld_balance",
    rawText: "Alert me if the balance of 0xabc moves",
  });

  const readyPlan = await evaluateBalanceWatchReadiness(plan, {
    lookupBalance: async () => ({ rawBalance: "42" }),
  });

  assert.equal(readyPlan.readiness.state, "ready");
  assert.equal(readyPlan.readiness.currentBalance, "42");
  assert.equal(readyPlan.readiness.waitCondition, undefined);
});

test("evaluateBalanceWatchReadiness turns link failures into explicit wait states", async () => {
  const plan = createBalanceWatchPlan({
    address: "0xabc",
    queryName: "helloworld_balance",
    rawText: "Alert me if the balance of 0xabc moves",
  });

  const waitingPlan = await evaluateBalanceWatchReadiness(plan, {
    lookupBalance: async () => {
      throw new Error("Contract is not linked for this address yet");
    },
  });

  assert.equal(waitingPlan.readiness.state, "needs-link");
  assert.equal(waitingPlan.readiness.waitCondition?.state, "needs-link");
  assert.match(waitingPlan.readiness.waitCondition?.reason ?? "", /not linked/i);
});

test("createPlanFromIntent maps top-holder requests to a holder-list view", () => {
  const plan = createPlanFromIntent(
    {
      kind: "top-holders",
      limit: 5,
      rawText: "Give me the top 5 holders",
    },
    "helloworld_balance",
  );

  assert.equal(plan.kind, "holder-list");
  assert.equal(plan.viewSpec.kind, "holder-list");
  assert.equal(plan.viewSpec.limit, 5);
  assert.equal(plan.readiness.state, "ready");
});

test("createPlanFromIntent maps balance requests to an address-balance view", () => {
  const plan = createPlanFromIntent(
    {
      address: "0xabc",
      kind: "balance",
      rawText: "What is the balance of 0xabc?",
    },
    "helloworld_balance",
  );

  assert.equal(plan.kind, "address-balance");
  assert.equal(plan.viewSpec.kind, "address-balance");
  assert.equal(plan.viewSpec.address, "0xabc");
  assert.equal(plan.executionPlan.steps.map((step) => step.kind).join(","), "resolve-balance,format-response");
});
