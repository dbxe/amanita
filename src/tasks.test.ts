import assert from "node:assert/strict";
import test from "node:test";

import {
  applyTaskFailure,
  attachWatchToTask,
  createBalanceWatchTask,
  recordTaskAlert,
  transitionTask,
} from "./tasks.js";

test("createBalanceWatchTask builds a ready task with a deterministic execution plan", () => {
  const task = createBalanceWatchTask({
    address: "0xabc",
    now: "2026-04-30T00:00:00.000Z",
    queryName: "helloworld_balance",
  });

  assert.equal(task.state, "ready");
  assert.equal(task.kind, "balance-watch");
  assert.equal(task.viewSpec.kind, "balance-watch");
  assert.equal(task.viewSpec.address, "0xabc");
  assert.equal(task.executionPlan.steps.map((step) => step.kind).join(","), "resolve-balance,persist-watch,evaluate-watch");
});

test("transitionTask rejects illegal transitions", () => {
  const task = createBalanceWatchTask({
    address: "0xabc",
    now: "2026-04-30T00:00:00.000Z",
    queryName: "helloworld_balance",
  });
  const waitingTask = applyTaskFailure(
    task,
    new Error("Contract is not linked yet"),
    "2026-04-30T00:00:01.000Z",
  );

  assert.throws(
    () => transitionTask(waitingTask, "needs-abi", "2026-04-30T00:00:02.000Z"),
    /Illegal task transition/,
  );
});

test("applyTaskFailure classifies indexing failures as syncing", () => {
  const task = createBalanceWatchTask({
    address: "0xabc",
    now: "2026-04-30T00:00:00.000Z",
    queryName: "helloworld_balance",
  });

  const failedTask = applyTaskFailure(task, new Error("Event indexing is still in progress for this contract"), "2026-04-30T00:00:01.000Z");

  assert.equal(failedTask.state, "syncing");
  assert.equal(failedTask.waitCondition?.state, "syncing");
});

test("attachWatchToTask and recordTaskAlert keep monitoring context in sync with alerts", () => {
  const task = createBalanceWatchTask({
    address: "0xabc",
    now: "2026-04-30T00:00:00.000Z",
    queryName: "helloworld_balance",
  });

  const monitoringTask = attachWatchToTask(task, {
    balance: "100",
    now: "2026-04-30T00:00:02.000Z",
    watchId: "watch-1",
  });
  const alertedTask = recordTaskAlert(monitoringTask, {
    currentBalance: "95",
    now: "2026-04-30T00:00:03.000Z",
    watchId: "watch-1",
  });

  assert.equal(monitoringTask.state, "monitoring");
  assert.equal(alertedTask.state, "monitoring");
  assert.equal(alertedTask.lastKnownBalance, "95");
  assert.equal(alertedTask.lastAlertAt, "2026-04-30T00:00:03.000Z");
});
