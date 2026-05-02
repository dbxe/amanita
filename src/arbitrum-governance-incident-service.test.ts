import assert from "node:assert/strict";
import test from "node:test";

import {
  bytesValueToHex,
  calldataSelector,
  formatArbitrumGovernanceIncidentAnalysis,
  formatArbitrumGovernanceIncidentMonitorSetup,
  matchIncidentMarkers,
  parseArbitrumGovernanceIncidentFocus,
  type ArbitrumGovernanceIncidentAnalysis,
} from "./arbitrum-governance-incident-service.js";

test("parseArbitrumGovernanceIncidentFocus defaults and validates values", () => {
  assert.equal(parseArbitrumGovernanceIncidentFocus(undefined), "brief");
  assert.equal(parseArbitrumGovernanceIncidentFocus("proposal-status"), "proposal-status");
  assert.throws(
    () => parseArbitrumGovernanceIncidentFocus("bad-focus"),
    /Unsupported Arbitrum governance incident focus/,
  );
});

test("bytesValueToHex decodes MultiBaas byte result shapes", () => {
  assert.equal(bytesValueToHex("sUf0DA=="), "0xb147f40c");
  assert.equal(
    bytesValueToHex("[92, 71, 77, 174, 67, 254, 23, 203, 167, 24, 131, 17, 131, 105, 75, 162, 43, 254, 218, 12, 21, 179, 8, 202, 212, 73, 46, 9, 33, 78, 136, 34]"),
    "0x5c474dae43fe17cba718831183694ba22bfeda0c15b308cad4492e09214e8822",
  );
});

test("calldataSelector extracts a compact selector", () => {
  assert.equal(calldataSelector("0xb147f40c000000"), "0xb147f40c");
  assert.equal(calldataSelector("0x1234"), undefined);
  assert.equal(calldataSelector("0x000000000000"), undefined);
});

test("matchIncidentMarkers finds Kelp rsETH incident language", () => {
  assert.deepEqual(
    matchIncidentMarkers("Release the frozen ETH for KelpDAO rsETH recovery at 0x0000000000000000000000000000000000000DA0"),
    ["Kelp", "rsETH", "frozen ETH", "0x0000000000000000000000000000000000000DA0"],
  );
});

test("formatArbitrumGovernanceIncidentAnalysis renders proposal-status evidence boundary", () => {
  const result: ArbitrumGovernanceIncidentAnalysis = {
    evidenceBoundaries: ["Do not confuse public proposal context with onchain ProposalCreated evidence."],
    focus: "proposal-status",
    limit: 2,
    proposalStatus: {
      matches: [],
      queryTarget: {
        network: "Arbitrum One",
        profileName: "arbitrum-one-remote",
        targetAddress: "0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9",
        targetLabel: "Core Governor",
      },
      recent: [
        {
          blockNumber: "293809109",
          matchedMarkers: [],
          proposalId: "112177996398925212273579485756315626637025938627124330171390356044681347897430",
          targetLabels: [],
          title: "# [Constitutional] DVP Quorum & Proposal Cancellation",
          triggeredAt: "2026-02-23 21:36:25+00",
          txHash: "0x0e065032993b9a99a1a34bd4ac08ab5945b7058f26973c90c86c37bf4ef2295a",
        },
      ],
      searchWindow: {
        newestBlockNumber: "293809109",
        newestTriggeredAt: "2026-02-23 21:36:25+00",
        oldestBlockNumber: "198000000",
        oldestTriggeredAt: "2025-07-01 00:00:00+00",
      },
      searchedCount: 28,
    },
  };

  const text = formatArbitrumGovernanceIncidentAnalysis(result);

  assert.match(text, /```event_query/i);
  assert.match(text, /query: multibaas\.eventQuery/i);
  assert.match(text, /purpose: current onchain status preflight/i);
  assert.doesNotMatch(text, /tool: analyze_arbitrum_governance_incident/i);
  assert.match(text, /fields: proposal metadata \+ execution payload \+ description/i);
  assert.match(text, /match: Kelp \| rsETH \| frozen ETH/i);
  assert.match(text, /scanned: 28 ProposalCreated event/i);
  assert.match(text, /window: blocks 198000000 -> 293809109/i);
  assert.match(text, /matches: 0 incident marker match/i);
  assert.match(text, /Verdict: not onchain yet/i);
  assert.match(text, /Searched: 28 indexed ProposalCreated event.*blocks 198000000 -> 293809109/i);
  assert.match(text, /Next binding signal: ProposalCreated/i);
  assert.match(text, /arbitrum-one-remote.*Core Governor/i);
  assert.match(text, /DVP Quorum & Proposal Cancellation/i);
  assert.match(text, /Do not confuse public proposal context/i);
});

test("formatArbitrumGovernanceIncidentAnalysis keeps brief shape distinct from status", () => {
  const result: ArbitrumGovernanceIncidentAnalysis = {
    evidenceBoundaries: [],
    focus: "brief",
    limit: 2,
    proposalStatus: {
      matches: [],
      queryTarget: {
        network: "Arbitrum One",
        profileName: "arbitrum-one-remote",
        targetAddress: "0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9",
        targetLabel: "Core Governor",
      },
      recent: [],
      searchWindow: {
        newestBlockNumber: "293809109",
        newestTriggeredAt: "2026-02-23 21:36:25+00",
        oldestBlockNumber: "198000000",
        oldestTriggeredAt: "2025-07-01 00:00:00+00",
      },
      searchedCount: 28,
    },
  };

  const text = formatArbitrumGovernanceIncidentAnalysis(result);

  assert.match(text, /User-facing brief requirements/i);
  assert.match(text, /what happened, contracts to inspect, what can happen next/i);
  assert.match(text, /Security Council action froze 30,765/i);
  assert.match(text, /Possible onchain control path/i);
  assert.match(text, /Release path preflight/i);
  assert.match(text, /none has appeared yet in this checked stream/i);
  assert.match(text, /Reserve Verdict\/Searched\/Found\/Next signal for explicit proposal-status or monitor turns/i);
  assert.doesNotMatch(text, /Observed Core Governor proposal status/i);
  assert.doesNotMatch(text, /Verdict: not onchain yet/i);
  assert.doesNotMatch(text, /^Searched:/m);
  assert.doesNotMatch(text, /Next binding signal:/i);
});

test("formatArbitrumGovernanceIncidentAnalysis renders control evidence", () => {
  const result: ArbitrumGovernanceIncidentAnalysis = {
    evidenceBoundaries: ["Decoded executor events verify control activity, not exploit reconstruction."],
    focus: "verify-freeze",
    l1TimelockOperations: [
      {
        calldataSelector: "0xb147f40c",
        delaySeconds: "259200",
        eventSignature: "CallScheduled(bytes32,uint256,address,uint256,bytes,bytes32,uint256)",
        target: "0x3fffbadaf827559da092217e474760e2b2c3cedd",
        targetLabel: "L1 Upgrade Executor",
        triggeredAt: "2026-01-12 22:18:35+00",
        txHash: "0xdce7",
        valueEth: "0 ETH",
      },
    ],
    l1UpgradeExecutorEvents: [
      {
        calldataSelector: "0x0a2e5a5b",
        eventSignature: "UpgradeExecuted(address,uint256,bytes)",
        target: "0x3d456fcd62f5babcf3263b72fb4ac8ff8cc5a322",
        triggeredAt: "2026-04-21 03:26:47+00",
        txHash: "0x0799",
        valueEth: "0 ETH",
      },
    ],
    limit: 1,
  };

  const text = formatArbitrumGovernanceIncidentAnalysis(result);

  assert.match(text, /```event_query/i);
  assert.doesNotMatch(text, /tool: analyze_arbitrum_governance_incident/i);
  assert.match(text, /stream: mainnet-remote.*L1 Upgrade Executor.*UpgradeExecuted, TargetCallExecuted/i);
  assert.match(text, /stream: arbitrum-one-remote.*L2 Core Timelock.*CallScheduled, CallExecuted, Cancelled/i);
  assert.match(text, /fields: target \+ value \+ calldata \+ operation id \+ delay \+ tx hash \+ timestamp/i);
  assert.match(text, /Primary emergency-response evidence: L1 Upgrade Executor/i);
  assert.match(text, /Searched/i);
  assert.match(text, /L1 Upgrade Executor: 1 event\(s\), newest at 2026-04-21 03:26:47\+00/i);
  assert.match(text, /UpgradeExecuted/i);
  assert.match(text, /selector=`0x0a2e5a5b`/i);
  assert.match(text, /L1 Timelock context/i);
  assert.match(text, /does not directly prove the KelpDAO freeze transaction/i);
  assert.match(text, /target=`0x3fffbadaf827559da092217e474760e2b2c3cedd` \(L1 Upgrade Executor\)/i);
});

test("formatArbitrumGovernanceIncidentMonitorSetup renders actionable monitor details", () => {
  const result: ArbitrumGovernanceIncidentAnalysis = {
    evidenceBoundaries: [],
    focus: "monitor",
    limit: 3,
    monitorPlan: {
      agentSideFilters: ["Kelp", "rsETH", "frozen ETH"],
      directDescriptionFilteringSupported: false,
      eventName: "ProposalCreated",
      followUpAnalysis: [
        "inspect proposal ID, proposer, targets, values, calldata, and description",
        "watch for later ProposalQueued and ProposalExecuted events",
      ],
      network: "Arbitrum One",
      profileName: "arbitrum-one-remote",
      targetAddress: "0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9",
      targetLabel: "Core Governor",
    },
    proposalStatus: {
      matches: [],
      queryTarget: {
        network: "Arbitrum One",
        profileName: "arbitrum-one-remote",
        targetAddress: "0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9",
        targetLabel: "Core Governor",
      },
      recent: [],
      searchWindow: {
        newestBlockNumber: "293809109",
        newestTriggeredAt: "2026-02-23 21:36:25+00",
        oldestBlockNumber: "198000000",
        oldestTriggeredAt: "2025-07-01 00:00:00+00",
      },
      searchedCount: 28,
    },
  };

  const text = formatArbitrumGovernanceIncidentMonitorSetup(result);

  assert.match(text, /Current verdict: no matching release ProposalCreated event found after scanning 28 indexed ProposalCreated event/i);
  assert.match(text, /```event_query/i);
  assert.match(text, /stream: arbitrum-one-remote.*Core Governor.*ProposalCreated/i);
  assert.match(text, /purpose: current onchain status preflight before webhook monitor registration/i);
  assert.doesNotMatch(text, /tool: analyze_arbitrum_governance_incident/i);
  assert.match(text, /match: Kelp, rsETH, frozen ETH/i);
  assert.match(text, /window: blocks 198000000 -> 293809109/i);
  assert.match(text, /Monitor plan/i);
  assert.doesNotMatch(text, /I will watch/i);
  assert.match(text, /monitor_governance_proposal/i);
  assert.match(text, /MultiBaas event\.emitted webhook wakes the local runtime/i);
  assert.doesNotMatch(text, /call NanoClaw `schedule_task`/i);
  assert.doesNotMatch(text, /recurrence `0 \*\/6 \* \* \*`/i);
  assert.match(text, /Network: arbitrum-one-remote \(Arbitrum One\)/i);
  assert.match(text, /Contract: Core Governor `0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9`/i);
  assert.match(text, /Event: ProposalCreated/i);
  assert.match(text, /Agent-side filters: Kelp, rsETH, frozen ETH/i);
  assert.match(text, /Follow-up analysis after trigger/i);
});
