import assert from "node:assert/strict";
import test from "node:test";

import {
  formatContractAddressInvestigationResult,
  formatContractLookupResult,
  formatImportContractLookupCandidateResult,
  selectBestContractLookupCandidateIndex,
} from "./contract-lookup-service.js";

test("formatContractLookupResult renders candidate summaries", () => {
  const text = formatContractLookupResult({
    candidates: [
      {
        abiEventCount: 1,
        abiFunctionCount: 4,
        address: "0xabc",
        hasBytecode: true,
        index: 0,
        name: "ERC1967Proxy",
        proxy: true,
        sourceLength: 42,
        verified: true,
        verifiedLink: "https://example.test/address/0xabc",
        verifiedSource: "blockscout",
      },
    ],
    preferredCandidateIndex: 0,
    searchedAddress: "0xproxy",
  });

  assert.match(text, /Contract lookup candidates/);
  assert.match(text, /Address: 0xproxy/);
  assert.match(text, /\[0\] ERC1967Proxy @ 0xabc \[preferred\]/);
  assert.match(text, /verified=yes source=blockscout proxy=yes functions=4 events=1/);
});

test("formatImportContractLookupCandidateResult renders import summary", () => {
  const text = formatImportContractLookupCandidateResult({
    candidate: {
      abiEventCount: 10,
      abiFunctionCount: 25,
      address: "0ximpl",
      hasBytecode: false,
      index: 1,
      name: "FiatTokenV1",
      proxy: true,
      sourceLength: 100,
      verified: true,
      verifiedSource: "blockscout",
    },
    contractLabel: "fiattokenv1",
    contractVersion: "1.0",
    inspection: {
      address: "0xproxy",
      linkedContracts: [
        {
          capabilityTags: ["erc20"],
          contractLabel: "fiattokenv1",
          contractName: "FiatTokenV1",
          contractVersion: "1.0",
          matchedPreloadedLabels: ["erc20interface"],
        },
      ],
      preloadedInterfaces: [],
      readiness: {
        address: "0xproxy",
        isProcessingPastLogs: true,
        state: "syncing",
      },
    },
    searchedAddress: "0xproxy",
  });

  assert.match(text, /Imported contract lookup candidate/);
  assert.match(text, /Candidate: \[1\] FiatTokenV1 @ 0ximpl/);
  assert.match(text, /Contract label: fiattokenv1/);
  assert.match(text, /Readiness: syncing/);
});

test("formatContractAddressInvestigationResult renders preferred candidate and import outcome", () => {
  const text = formatContractAddressInvestigationResult({
    importAttempted: true,
    importedCandidate: {
      abiEventCount: 18,
      abiFunctionCount: 50,
      address: "0ximpl",
      hasBytecode: false,
      index: 1,
      name: "FiatTokenV1",
      proxy: true,
      sourceLength: 100,
      verified: true,
      verifiedSource: "blockscout",
    },
    importedContractLabel: "fiattokenv1",
    importedContractVersion: "1.0",
    inspection: {
      address: "0xproxy",
      linkedContracts: [
        {
          capabilityTags: ["erc20"],
          contractLabel: "fiattokenv1",
          contractName: "FiatTokenV1",
          contractVersion: "1.0",
          matchedPreloadedLabels: ["erc20interface"],
        },
      ],
      preloadedInterfaces: [],
      readiness: {
        address: "0xproxy",
        isProcessingPastLogs: true,
        state: "syncing",
      },
    },
    lookup: {
      candidates: [
        {
          abiEventCount: 1,
          abiFunctionCount: 0,
          address: "0xproxy",
          hasBytecode: false,
          index: 0,
          name: "ERC1967Proxy",
          proxy: true,
          sourceLength: 10,
          verified: true,
        },
        {
          abiEventCount: 18,
          abiFunctionCount: 50,
          address: "0ximpl",
          hasBytecode: false,
          index: 1,
          name: "FiatTokenV1",
          proxy: true,
          sourceLength: 100,
          verified: true,
          verifiedSource: "blockscout",
        },
      ],
      preferredCandidateIndex: 1,
      searchedAddress: "0xproxy",
    },
    metadata: {
      address: "0xproxy",
      decimals: 18,
      isProcessingPastLogs: true,
      name: "JPY Coin",
      state: "syncing",
      symbol: "JPYC",
      totalSupply: "653038691000000000000000000",
    },
  });

  assert.match(text, /Contract address investigation/);
  assert.match(text, /\[1\] FiatTokenV1 @ 0ximpl \[preferred\]/);
  assert.match(text, /Imported: \[1\] FiatTokenV1 as fiattokenv1 1.0/);
  assert.match(text, /Token: JPY Coin \(JPYC\)/);
  assert.match(text, /Readiness: syncing/);
});

test("selectBestContractLookupCandidateIndex prefers the richer non-proxy-shell candidate", () => {
  const bestIndex = selectBestContractLookupCandidateIndex([
    {
      abi: JSON.stringify([{ type: "event" }]),
      address: "0xproxy",
      name: "ERC1967Proxy",
      proxy: true,
      verified: true,
    },
    {
      abi: JSON.stringify([
        { type: "function" },
        { type: "function" },
        { type: "event" },
      ]),
      address: "0ximpl",
      name: "FiatTokenV1",
      proxy: true,
      verified: true,
    },
  ]);

  assert.equal(bestIndex, 1);
});
