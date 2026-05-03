import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluatePendingHolderQueries, requestTopHolders } from "./holder-tasks.js";

test("requestTopHolders asks for a token address when the token name is unknown", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "logrunner-holder-task-"));

  try {
    const result = await requestTopHolders(
      stateDir,
      {
        limit: 20,
        rawText: "What are the top balances of mysterytoken?",
        tokenName: "mysterytoken",
      },
      {
        ensureReady: async () => {
          throw new Error("ensureReady should not be called when the token name is unresolved");
        },
        executeHolderQuery: async () => {
          throw new Error("executeHolderQuery should not be called when the token name is unresolved");
        },
        resolveTokenName: async () => undefined,
      },
      "helloworld_balance",
    );

    assert.match(result.responseText, /tell me the token contract address/i);
    assert.equal(result.task, undefined);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("requestTopHolders returns a partial indexed holder snapshot while syncing and follows up once ready", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "logrunner-holder-task-"));
  let ensureReadyCalls = 0;
  let executeCalls = 0;

  try {
    const initial = await requestTopHolders(
      stateDir,
      {
        contractAddress: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
        limit: 5,
        rawText: "Give me the top 5 holders for token 0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
      },
      {
        ensureReady: async () => {
          ensureReadyCalls += 1;
          return {
            addressAlias: "sampletoken",
            contractAddress: "0xd26fde38f244dcbb13e8017347ac37804d926bb5",
            contractLabel: "sampletoken",
            contractVersion: "1.0",
            state: "syncing",
            waitCondition: {
              reason: "Contract 0xd26fde38f244dcbb13e8017347ac37804d926bb5 is still syncing historical events.",
              state: "syncing",
            },
          };
        },
        executeHolderQuery: async () => {
          executeCalls += 1;
          return [
            "Verdict: current indexed top 5 holder snapshot; historical Transfer sync is still in progress, so rankings may move.",
            "",
            "Top 5 holders",
            "",
            "| Rank | Holder | Raw balance |",
            "| ---: | --- | ---: |",
            "| 1 | `0xabc` | 100 |",
            "",
            "```event_query",
            "query: multibaas.eventQuery",
            "status: syncing historical events; partial indexed snapshot",
            "```",
          ].join("\n");
        },
      },
      "helloworld_balance",
    );

    assert.equal(initial.task?.capability, "holder-analysis");
    assert.equal(initial.task?.state, "syncing");
    assert.equal(
      initial.task?.viewSpec.queryName,
      "contract:0xd26fde38f244dcbb13e8017347ac37804d926bb5",
    );
    assert.equal(executeCalls, 1);
    assert.match(initial.responseText, /partial indexed/i);
    assert.match(initial.responseText, /```event_query/i);

    const evaluation = await evaluatePendingHolderQueries(
      stateDir,
      {
        ensureReady: async () => {
          ensureReadyCalls += 1;
          return {
            addressAlias: "sampletoken",
            contractAddress: "0xd26fde38f244dcbb13e8017347ac37804d926bb5",
            contractLabel: "sampletoken",
            contractVersion: "1.0",
            state: "ready",
          };
        },
        executeHolderQuery: async () =>
          [
            "Top 5 holders",
            "",
            "Contract: 0xd26fde38f244dcbb13e8017347ac37804d926bb5",
            "",
            " 1. 0xabc  100",
          ].join("\n"),
      },
    );

    assert.equal(ensureReadyCalls, 2);
    assert.equal(evaluation.messages.length, 1);
    assert.match(evaluation.messages[0] ?? "", /Top 5 holders/);

    const secondEvaluation = await evaluatePendingHolderQueries(
      stateDir,
      {
        ensureReady: async () => {
          throw new Error("ensureReady should not be called after the result has already been reported");
        },
        executeHolderQuery: async () => {
          throw new Error("executeHolderQuery should not run after the result has already been reported");
        },
      },
    );

    assert.deepEqual(secondEvaluation.messages, []);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
