import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { ArbitrumGovernanceIncidentAnalysis } from "./arbitrum-governance-incident-service.js";
import {
  evaluateEventMonitorsForState,
  evaluateEventMonitors,
  formatArbitrumFrozenEthReleaseMonitorRegistration,
} from "./event-monitor-service.js";
import { loadState, saveState, type EventMonitor, type LocalState } from "./state.js";

const monitor: EventMonitor = {
  contractAddress: "0xf07ded9dc292157749b6fd268e37df6ea38395b9",
  contractLabel: "Core Governor",
  createdAt: "2026-05-02T00:00:00.000Z",
  eventName: "ProposalCreated",
  followUpAnalysis: ["inspect proposal ID, proposer, targets, values, calldata, and description"],
  id: "monitor-1",
  kind: "arbitrum-frozen-eth-release-proposal",
  label: "Arbitrum frozen-ETH release proposal",
  matchText: ["Kelp", "rsETH", "frozen ETH"],
  network: "Arbitrum One",
  profileName: "arbitrum-one-remote",
  triggeredEventKeys: [],
  updatedAt: "2026-05-02T00:00:00.000Z",
};

function stateWithMonitor(candidate: EventMonitor = monitor): LocalState {
  return {
    eventMonitors: [candidate],
    tasks: [],
    version: 3,
    watches: [],
  };
}

test("evaluateEventMonitorsForState emits one alert for a matching ProposalCreated webhook event", () => {
  const event = {
    block_number: "123",
    contract: { address: monitor.contractAddress },
    event: "ProposalCreated",
    event_index: "4",
    fields: {
      description: "Release frozen ETH for KelpDAO rsETH recovery",
      proposalId: "42",
    },
    transaction_hash: "0xabc",
  };

  const first = evaluateEventMonitorsForState(stateWithMonitor(), [event], "2026-05-02T01:00:00.000Z");
  assert.equal(first.alerts.length, 1);
  assert.deepEqual(first.alerts[0]?.matchedText, ["Kelp", "rsETH", "frozen ETH"]);
  assert.equal(first.nextState.eventMonitors[0]?.triggeredEventKeys.length, 1);

  const second = evaluateEventMonitorsForState(first.nextState, [event], "2026-05-02T01:01:00.000Z");
  assert.equal(second.alerts.length, 0);
});

test("evaluateEventMonitors checks configured profile state dirs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "amanita-event-monitors-"));
  const mainnetStateDir = path.join(tempDir, "mainnet");
  const arbitrumStateDir = path.join(tempDir, "arbitrum");
  const previousBackendsJson = process.env.MULTIBAAS_BACKENDS_JSON;
  const previousProfile = process.env.MULTIBAAS_PROFILE;

  process.env.MULTIBAAS_BACKENDS_JSON = JSON.stringify({
    defaultProfile: "mainnet-remote",
    profiles: {
      "arbitrum-one-remote": {
        baseUrl: "https://arb.example.multibaas.com",
        hardhatNetwork: "arbitrum-one",
        stateDir: arbitrumStateDir,
      },
      "mainnet-remote": {
        baseUrl: "https://mainnet.example.multibaas.com",
        hardhatNetwork: "ethereum-mainnet",
        stateDir: mainnetStateDir,
      },
    },
  });
  delete process.env.MULTIBAAS_PROFILE;

  try {
    saveState(arbitrumStateDir, stateWithMonitor());
    const event = {
      block_number: "123",
      contract: { address: monitor.contractAddress },
      event: "ProposalCreated",
      event_index: "4",
      fields: {
        description: "Release frozen ETH for KelpDAO rsETH recovery",
      },
      transaction_hash: "0xabc",
    };

    const result = evaluateEventMonitors([event]);
    assert.equal(result.alerts.length, 1);
    assert.equal(loadState(arbitrumStateDir).eventMonitors[0]?.triggeredEventKeys.length, 1);
    assert.equal(loadState(mainnetStateDir).eventMonitors.length, 0);
  } finally {
    if (previousBackendsJson === undefined) {
      delete process.env.MULTIBAAS_BACKENDS_JSON;
    } else {
      process.env.MULTIBAAS_BACKENDS_JSON = previousBackendsJson;
    }

    if (previousProfile === undefined) {
      delete process.env.MULTIBAAS_PROFILE;
    } else {
      process.env.MULTIBAAS_PROFILE = previousProfile;
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("formatArbitrumFrozenEthReleaseMonitorRegistration describes the webhook path without a scheduling fallback", () => {
  const analysis: ArbitrumGovernanceIncidentAnalysis = {
    evidenceBoundaries: [],
    focus: "monitor",
    limit: 3,
    monitorPlan: {
      agentSideFilters: ["Kelp", "rsETH", "frozen ETH"],
      directDescriptionFilteringSupported: false,
      eventName: "ProposalCreated",
      followUpAnalysis: ["inspect proposal ID, proposer, targets, values, calldata, and description"],
      network: "Arbitrum One",
      profileName: "arbitrum-one-remote",
      targetAddress: monitor.contractAddress,
      targetLabel: "Core Governor",
    },
    proposalStatus: {
      matches: [],
      queryTarget: {
        network: "Arbitrum One",
        profileName: "arbitrum-one-remote",
        targetAddress: monitor.contractAddress,
        targetLabel: "Core Governor",
      },
      recent: [],
      searchedCount: 28,
    },
  };

  const text = formatArbitrumFrozenEthReleaseMonitorRegistration({
    analysis,
    monitor,
    webhook: {
      id: 7,
      label: "runtime-events",
      subscriptions: ["event.emitted"],
      updatedAt: "2026-05-02T01:00:00.000Z",
      url: "https://agent.example/webhooks/multibaas",
    },
  });

  assert.match(text, /Webhook status: registered/i);
  assert.match(text, /MultiBaas event\.emitted webhook -> local event monitor filter -> NanoClaw notification/i);
  assert.doesNotMatch(text, /fallback/i);
  assert.doesNotMatch(text, /recurrence/i);
  assert.doesNotMatch(text, /tool: analyze_arbitrum_governance_incident/i);
});
