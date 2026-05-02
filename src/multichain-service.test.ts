import assert from "node:assert/strict";
import test from "node:test";

import { formatConfiguredBackends, formatMultichainInspection } from "./multichain-service.js";

test("formatConfiguredBackends renders configured backend summaries", () => {
  const text = formatConfiguredBackends([
    {
      hardhatNetwork: "development",
      hasApiKey: false,
      inactive: true,
      note: "Legacy local fallback; not part of the remote Arbitrum DAO demo.",
      profileName: "development",
      stateDir: "/tmp/.agent-state/development",
    },
    {
      baseUrl: "https://mainnet.example.multibaas.com",
      chainId: 1,
      chainName: "Ethereum Mainnet",
      hardhatNetwork: "ethereum-mainnet",
      hasApiKey: true,
      profileName: "mainnet-remote",
      stateDir: "/tmp/.agent-state/mainnet-remote",
    },
    {
      baseUrl: "https://arb.example.multibaas.com",
      chainId: 42161,
      chainName: "Arbitrum One",
      hardhatNetwork: "arbitrum-one",
      hasApiKey: true,
      profileName: "arbitrum-one-remote",
      stateDir: "/tmp/.agent-state/arbitrum-one-remote",
    },
  ]);

  assert.match(text, /mainnet-remote/);
  assert.match(text, /development/);
  assert.match(text, /status=inactive/);
  assert.match(text, /apiKey=not required while inactive/);
  assert.match(text, /Ethereum Mainnet \(1\)/);
  assert.match(text, /arbitrum-one-remote/);
  assert.match(text, /Arbitrum One \(42161\)/);
});

test("formatMultichainInspection renders per-backend readiness and signals", () => {
  const text = formatMultichainInspection({
    backends: [
      {
        baseUrl: "https://mainnet.example.multibaas.com",
        chainId: 1,
        chainName: "Ethereum Mainnet",
        hardhatNetwork: "ethereum-mainnet",
        hasApiKey: true,
        profileName: "mainnet-remote",
        stateDir: "/tmp/.agent-state/mainnet-remote",
      },
      {
        baseUrl: "https://arb.example.multibaas.com",
        chainId: 42161,
        chainName: "Arbitrum One",
        hardhatNetwork: "arbitrum-one",
        hasApiKey: true,
        profileName: "arbitrum-one-remote",
        stateDir: "/tmp/.agent-state/arbitrum-one-remote",
      },
    ],
    signals: [
      "Readiness is uneven across backends. Ready: mainnet-remote. Waiting: arbitrum-one-remote.",
    ],
    targets: [
      {
        configuredBackend: {
          baseUrl: "https://mainnet.example.multibaas.com",
          chainId: 1,
          chainName: "Ethereum Mainnet",
          hardhatNetwork: "ethereum-mainnet",
          hasApiKey: true,
          profileName: "mainnet-remote",
          stateDir: "/tmp/.agent-state/mainnet-remote",
        },
        eventLeads: [{ id: "token_control_timeline", rationale: "r", summary: "s", title: "t" }],
        linkedContracts: ["fiattokenv1 1.0"],
        metadata: {
          address: "0x1111111111111111111111111111111111111111",
          decimals: 18,
          isProcessingPastLogs: false,
          name: "JPY Coin",
          state: "ready",
          symbol: "JPYC",
          totalSupply: "100",
        },
        profileName: "mainnet-remote",
        readinessState: "ready",
        resolvedAddress: "0x1111111111111111111111111111111111111111",
        role: "source",
      },
      {
        configuredBackend: {
          baseUrl: "https://arb.example.multibaas.com",
          chainId: 42161,
          chainName: "Arbitrum One",
          hardhatNetwork: "arbitrum-one",
          hasApiKey: true,
          profileName: "arbitrum-one-remote",
          stateDir: "/tmp/.agent-state/arbitrum-one-remote",
        },
        eventLeads: [],
        linkedContracts: [],
        metadata: {
          address: "0x2222222222222222222222222222222222222222",
          decimals: 18,
          isProcessingPastLogs: true,
          name: "JPY Coin",
          state: "syncing",
          symbol: "JPYC",
          totalSupply: "100",
        },
        profileName: "arbitrum-one-remote",
        readinessState: "syncing",
        resolvedAddress: "0x2222222222222222222222222222222222222222",
        role: "destination",
      },
    ],
  });

  assert.match(text, /source: mainnet-remote/);
  assert.match(text, /destination: arbitrum-one-remote/);
  assert.match(text, /linked: fiattokenv1 1.0/);
  assert.match(text, /event leads: token_control_timeline/);
  assert.match(text, /Readiness is uneven across backends/);
});
