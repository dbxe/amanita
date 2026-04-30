import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadState, saveState } from "./state.js";
import { createBalanceWatchTask } from "./tasks.js";

test("loadState and saveState persist Phase 01 task records", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-state-"));

  try {
    const task = createBalanceWatchTask({
      address: "0xabc",
      now: "2026-04-30T00:00:00.000Z",
      queryName: "helloworld_balance",
    });

    saveState(stateDir, {
      tasks: [task],
      version: 2,
      watches: [],
    });

    const reloaded = loadState(stateDir);

    assert.equal(reloaded.version, 2);
    assert.equal(reloaded.tasks.length, 1);
    assert.equal(reloaded.tasks[0]?.id, task.id);
    assert.equal(reloaded.tasks[0]?.state, "ready");
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
