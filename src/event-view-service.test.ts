import assert from "node:assert/strict";
import test from "node:test";

import { formatTokenControlEvents } from "./event-view-service.js";

test("formatTokenControlEvents renders syncing guidance instead of a false empty result", () => {
  const text = formatTokenControlEvents({
    events: [],
    limit: 20,
    metadata: {
      address: "0xabc",
      decimals: 18,
      isProcessingPastLogs: true,
      name: "JPY Coin",
      state: "syncing",
      symbol: "JPYC",
    },
    readiness: {
      address: "0xabc",
      isProcessingPastLogs: true,
      state: "syncing",
    },
    resolvedAddress: "0xabc",
  });

  assert.match(text, /Readiness: syncing/);
  assert.match(text, /still syncing historical events/i);
  assert.doesNotMatch(text, /No matching control events found/i);
});

test("formatTokenControlEvents renders needs-link guidance instead of a false empty result", () => {
  const text = formatTokenControlEvents({
    events: [],
    limit: 20,
    readiness: {
      address: "0xabc",
      isProcessingPastLogs: false,
      state: "needs-link",
    },
    resolvedAddress: "0xabc",
  });

  assert.match(text, /Readiness: needs-link/);
  assert.match(text, /not linked in MultiBaas yet/i);
  assert.doesNotMatch(text, /No matching control events found/i);
});
