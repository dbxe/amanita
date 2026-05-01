import assert from "node:assert/strict";
import test from "node:test";

import { formatTokenInvestigation } from "./investigation-service.js";

test("formatTokenInvestigation renders unresolved token guidance", () => {
  const text = formatTokenInvestigation({
    requestedLimit: 5,
    signals: [],
    unresolvedTokenName: "mysterytoken",
  });

  assert.match(text, /tell me the token contract address/i);
  assert.match(text, /mysterytoken/i);
});

test("formatTokenInvestigation renders readiness, concentration, and signals", () => {
  const text = formatTokenInvestigation({
    concentration: {
      concentrationBps: 1560,
      concentrationPct: "15.60%",
      contractAddress: "0xabc",
      coveredBalance: "156000000000000000000",
      holderCount: 102,
      holders: [{ address: "0x1", rawBalance: "98000000000000000000" }],
      kind: "holder-concentration",
      limit: 5,
      queryName: "contract:0xabc",
      totalTrackedBalance: "1000000000000000000000",
    },
    metadata: {
      address: "0xabc",
      decimals: 18,
      isProcessingPastLogs: false,
      name: "Hello World Token",
      state: "ready",
      symbol: "HWT",
      totalSupply: "1000000000000000000000",
    },
    readiness: {
      address: "0xabc",
      isProcessingPastLogs: false,
      state: "ready",
    },
    requestedLimit: 5,
    resolvedAddress: "0xabc",
    signals: [{ severity: "medium", summary: "The largest holder alone controls 9.80% of tracked supply." }],
    topHolders: {
      contractAddress: "0xabc",
      holders: [{ address: "0x1", rawBalance: "98000000000000000000" }],
      kind: "holder-list",
      limit: 5,
      queryName: "contract:0xabc",
    },
  });

  assert.match(text, /Token investigation/);
  assert.match(text, /Hello World Token/);
  assert.match(text, /Top 5 concentration: 15.60% \(1560 bps\)/);
  assert.match(text, /\[medium\] The largest holder alone controls 9.80%/);
});
