import assert from "node:assert/strict";
import test from "node:test";

import {
  formatContractLookupResult,
  formatImportContractLookupCandidateResult,
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
    searchedAddress: "0xproxy",
  });

  assert.match(text, /Contract lookup candidates/);
  assert.match(text, /Address: 0xproxy/);
  assert.match(text, /\[0\] ERC1967Proxy @ 0xabc/);
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
