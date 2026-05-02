import assert from "node:assert/strict";
import test from "node:test";

import { formatArbitrumDaoInspection, parseArbitrumDaoFocus, type ArbitrumDaoInspectionResult } from "./arbitrum-dao-service.js";

function fixtureResult(focus: ArbitrumDaoInspectionResult["focus"]): ArbitrumDaoInspectionResult {
  return {
    backends: [],
    focus,
    targets: [
      {
        configuredBackend: {
          baseUrl: "https://mainnet.example",
          chainId: 1,
          chainName: "Ethereum Mainnet",
          hardhatNetwork: "ethereum-mainnet",
          hasApiKey: true,
          profileName: "mainnet-remote",
          stateDir: ".agent-state/mainnet-remote",
        },
        contractAddress: "0xE6841D92B0C345144506576eC13ECf5103aC7f49",
        definition: {
          category: "authority",
          chainLabel: "Ethereum mainnet",
          contractAddress: "0xE6841D92B0C345144506576eC13ECf5103aC7f49",
          description: "Ethereum-side governance finalization timelock.",
          id: "l1_timelock",
          profileName: "mainnet-remote",
          roleLabel: "L1 Timelock",
        },
        eventLeadIds: ["token_control_timeline"],
        linkedContracts: ["arbitrumdaol1timelock 1.0"],
        readinessState: "ready",
      },
      {
        configuredBackend: {
          baseUrl: "https://mainnet.example",
          chainId: 1,
          chainName: "Ethereum Mainnet",
          hardhatNetwork: "ethereum-mainnet",
          hasApiKey: true,
          profileName: "mainnet-remote",
          stateDir: ".agent-state/mainnet-remote",
        },
        contractAddress: "0x3ffFbAdAF827559da092217e474760E2b2c3CeDd",
        definition: {
          category: "authority",
          chainLabel: "Ethereum mainnet",
          contractAddress: "0x3ffFbAdAF827559da092217e474760E2b2c3CeDd",
          description: "Ethereum-side upgrade authority.",
          id: "l1_upgrade_executor",
          profileName: "mainnet-remote",
          roleLabel: "L1 Upgrade Executor",
        },
        eventLeadIds: ["token_control_timeline"],
        linkedContracts: ["arbitrumdaol1upgradeexecutor 1.0"],
        readinessState: "ready",
      },
      {
        configuredBackend: {
          baseUrl: "https://mainnet.example",
          chainId: 1,
          chainName: "Ethereum Mainnet",
          hardhatNetwork: "ethereum-mainnet",
          hasApiKey: true,
          profileName: "mainnet-remote",
          stateDir: ".agent-state/mainnet-remote",
        },
        contractAddress: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1",
        definition: {
          category: "token",
          chainLabel: "Ethereum mainnet",
          contractAddress: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1",
          description: "Bridged ARB token on Ethereum mainnet.",
          id: "l1_arb_token",
          profileName: "mainnet-remote",
          roleLabel: "L1 Bridged ARB",
        },
        eventLeadIds: [],
        linkedContracts: ["arbtokenethereum 1.0"],
        readinessState: "syncing",
      },
      ...[
        {
          id: "core_governor",
          roleLabel: "Core Governor",
          description: "Constitutional / protocol-level governor.",
          category: "governor",
        },
        {
          id: "treasury_governor",
          roleLabel: "Treasury Governor",
          description: "Treasury-focused governor.",
          category: "governor",
        },
        {
          id: "l2_core_timelock",
          roleLabel: "L2 Core Timelock",
          description: "Protocol-level L2 timelock.",
          category: "timelock",
        },
        {
          id: "l2_treasury_timelock",
          roleLabel: "L2 Treasury Timelock",
          description: "Treasury-focused L2 timelock.",
          category: "timelock",
        },
        {
          id: "l2_upgrade_executor",
          roleLabel: "L2 Upgrade Executor",
          description: "Arbitrum-side upgrade authority.",
          category: "authority",
        },
        {
          id: "treasury_wallet",
          roleLabel: "Treasury Wallet",
          description: "DAO treasury wallet.",
          category: "treasury",
        },
      ].map((target) => ({
        configuredBackend: {
          baseUrl: "https://arb.example",
          chainId: 42161,
          chainName: "Arbitrum One",
          hardhatNetwork: "arbitrum-one",
          hasApiKey: true,
          profileName: "arbitrum-one-remote",
          stateDir: ".agent-state/arbitrum-one-remote",
        },
        contractAddress: `0x${target.id}`,
        definition: {
          category: target.category as "authority" | "governor" | "timelock" | "treasury",
          chainLabel: "Arbitrum One",
          contractAddress: `0x${target.id}`,
          description: target.description,
          id: target.id as never,
          profileName: "arbitrum-one-remote",
          roleLabel: target.roleLabel,
        },
        eventLeadIds: [],
        linkedContracts: [target.roleLabel],
        readinessState: "syncing" as const,
      })),
    ],
  };
}

test("parseArbitrumDaoFocus defaults to overview and rejects unsupported values", () => {
  assert.equal(parseArbitrumDaoFocus(undefined), "overview");
  assert.equal(parseArbitrumDaoFocus("treasury"), "treasury");
  assert.throws(() => parseArbitrumDaoFocus("bad-focus"), /Unsupported Arbitrum DAO focus/);
});

test("formatArbitrumDaoInspection explains grounded vs premature DAO work", () => {
  const text = formatArbitrumDaoInspection(fixtureResult("overview"));

  assert.match(text, /Answerability: partially grounded/i);
  assert.match(text, /Ethereum-side control is grounded now/i);
  assert.match(text, /Arbitrum-side governors and timelocks are linked and syncing/i);
  assert.match(text, /Delegate-power questions are premature/i);
  assert.match(text, /Supplemental targets not in the active demo set/i);
});

test("formatArbitrumDaoInspection gives a bounded delegate answer", () => {
  const text = formatArbitrumDaoInspection(fixtureResult("delegates"));

  assert.match(text, /Answerability: premature/i);
  assert.match(text, /native L2 ARB token is not in the active demo target set/i);
  assert.match(text, /Add the native ARB token on Arbitrum One back into the active target set/i);
});

test("formatArbitrumDaoInspection treats total inspection failure as temporarily blocked", () => {
  const result = fixtureResult("overview");
  result.targets = result.targets.map((target) => ({
    ...target,
    inspectionError: "inspection timed out after 20000ms",
    readinessState: undefined,
  }));

  const text = formatArbitrumDaoInspection(result);

  assert.match(text, /Answerability: temporarily blocked/i);
  assert.match(text, /DAO-level conclusions are temporarily blocked/i);
  assert.match(text, /Retry a narrow readiness check/i);
  assert.match(text, /inspection did not complete/i);
  assert.doesNotMatch(text, /timed out after/i);
});
