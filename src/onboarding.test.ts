import assert from "node:assert/strict";
import test from "node:test";

import { createContractNameAlias, createDeterministicAddressAlias, ensureErc20HolderQueryReady } from "./onboarding.js";

test("createDeterministicAddressAlias derives a stable ERC-20 alias from the address", () => {
  assert.equal(
    createDeterministicAddressAlias("0xD26fde38F244Dcbb13e8017347Ac37804d926Bb5"),
    "erc20-d26fde38f244dcbb13e8017347ac37804d926bb5",
  );
});

test("createContractNameAlias normalizes token names into aliases", () => {
  assert.equal(createContractNameAlias("Hello World Token"), "helloworldtoken");
});

test("ensureErc20HolderQueryReady aliases and links an unseen address before waiting for sync", async () => {
  const actions: string[] = [];
  let getAddressCount = 0;

  const result = await ensureErc20HolderQueryReady("0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5", {
    getAddress: async () => {
      actions.push("getAddress");
      getAddressCount += 1;
      if (getAddressCount === 1) {
        return { address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5", alias: "", contracts: [] };
      }
      if (getAddressCount === 2) {
        return {
          address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
          alias: "helloworldtoken",
          contracts: [],
        };
      }
      return {
        address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
        alias: "helloworldtoken",
        contracts: [{ label: "erc20interface", version: "1.0" }],
      };
    },
    getContract: async () => {
      throw new Error("getContract should not be called before the address is linked");
    },
    getContractName: async () => {
      actions.push("getContractName");
      return "Hello World Token";
    },
    getEventIndexingStatus: async () => {
      actions.push("getEventIndexingStatus");
      return { isProcessingPastLogs: true };
    },
    linkAddressContract: async (_addressOrAlias, request) => {
      actions.push(`linkAddressContract:${request.label}:${request.startingBlock}`);
    },
    listContracts: async () => {
      actions.push("listContracts");
      return [{ contractName: "ERC20Interface", label: "erc20interface", version: "1.0" }];
    },
    listKnownAddresses: async () => {
      actions.push("listKnownAddresses");
      return [];
    },
    setAddressAlias: async (_address, alias) => {
      actions.push(`setAddressAlias:${alias}`);
    },
  });

  assert.equal(result.state, "syncing");
  assert.equal(result.addressAlias, "helloworldtoken");
  assert.equal(result.contractLabel, "erc20interface");
  assert.equal(result.contractVersion, "1.0");
  assert.deepEqual(actions, [
    "listContracts",
    "getAddress",
    "listKnownAddresses",
    "getContractName",
    "setAddressAlias:helloworldtoken",
    "getAddress",
    "linkAddressContract:erc20interface:0",
    "getAddress",
    "getEventIndexingStatus",
  ]);
});

test("ensureErc20HolderQueryReady reuses an existing compatible linked contract", async () => {
  const actions: string[] = [];

  const result = await ensureErc20HolderQueryReady("0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5", {
    getAddress: async () => {
      actions.push("getAddress");
      return {
        address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
        alias: "sampletoken",
        contracts: [{ label: "sampletoken", version: "1.0" }],
      };
    },
    getContract: async (label) => {
      actions.push(`getContract:${label}`);
      return {
        abi: {
          events: {
            "Transfer(address,address,uint256)": {},
          },
          methods: {
            "balanceOf(address)": {},
            "totalSupply()": {},
          },
        },
        label,
        version: "1.0",
      };
    },
    getContractName: async () => {
      throw new Error("getContractName should not be called for an aliased address");
    },
    getEventIndexingStatus: async (addressOrAlias, contract) => {
      actions.push(`getEventIndexingStatus:${addressOrAlias}:${contract}`);
      return { isProcessingPastLogs: false };
    },
    linkAddressContract: async () => {
      throw new Error("linkAddressContract should not be called for a compatible linked contract");
    },
    listContracts: async () => {
      actions.push("listContracts");
      return [{ contractName: "ERC20Interface", label: "erc20interface", version: "1.0" }];
    },
    listKnownAddresses: async () => {
      throw new Error("listKnownAddresses should not be called for an aliased address");
    },
    setAddressAlias: async () => {
      throw new Error("setAddressAlias should not be called for an aliased address");
    },
  });

  assert.equal(result.state, "ready");
  assert.equal(result.addressAlias, "sampletoken");
  assert.equal(result.contractLabel, "sampletoken");
  assert.deepEqual(actions, [
    "listContracts",
    "getAddress",
    "getContract:sampletoken",
    "getEventIndexingStatus:sampletoken:sampletoken",
  ]);
});

test("ensureErc20HolderQueryReady returns needs-abi when ERC-20 interface support is unavailable", async () => {
  const result = await ensureErc20HolderQueryReady("0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5", {
    getAddress: async () => ({ address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5", alias: "", contracts: [] }),
    getContract: async () => {
      throw new Error("getContract should not be called without any linked contracts");
    },
    getContractName: async () => {
      throw new Error("getContractName should not be called without an ERC-20 interface");
    },
    getEventIndexingStatus: async () => {
      throw new Error("getEventIndexingStatus should not be called when onboarding is blocked");
    },
    linkAddressContract: async () => {
      throw new Error("linkAddressContract should not be called when the interface is unavailable");
    },
    listContracts: async () => [{ contractName: "ERC721Interface", label: "erc721interface", version: "1.0" }],
    listKnownAddresses: async () => {
      throw new Error("listKnownAddresses should not be called when the interface is unavailable");
    },
    setAddressAlias: async () => {
      throw new Error("setAddressAlias should not be called when the interface is unavailable");
    },
  });

  assert.equal(result.state, "needs-abi");
  assert.match(result.waitCondition?.reason ?? "", /erc20interface/i);
});

test("ensureErc20HolderQueryReady falls back to a deterministic alias when the token name would collide", async () => {
  let getAddressCount = 0;

  const result = await ensureErc20HolderQueryReady("0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5", {
    getAddress: async () => {
      getAddressCount += 1;
      if (getAddressCount === 1) {
        return { address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5", alias: "", contracts: [] };
      }
      if (getAddressCount === 2) {
        return {
          address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
          alias: "erc20-d26fde38f244dcbb13e8017347ac37804d926bb5",
          contracts: [],
        };
      }
      return {
        address: "0xd26fde38F244Dcbb13e8017347Ac37804d926Bb5",
        alias: "erc20-d26fde38f244dcbb13e8017347ac37804d926bb5",
        contracts: [{ label: "erc20interface", version: "1.0" }],
      };
    },
    getContract: async () => {
      throw new Error("getContract should not be called before the address is linked");
    },
    getContractName: async () => "Sample Token",
    getEventIndexingStatus: async () => ({ isProcessingPastLogs: false }),
    linkAddressContract: async () => undefined,
    listContracts: async () => [{ contractName: "ERC20Interface", label: "erc20interface", version: "1.0" }],
    listKnownAddresses: async () => [
      {
        address: "0x1111111111111111111111111111111111111111",
        alias: "sampletoken",
      },
    ],
    setAddressAlias: async (_address, alias) => {
      assert.equal(alias, "erc20-d26fde38f244dcbb13e8017347ac37804d926bb5");
    },
  });

  assert.equal(result.addressAlias, "erc20-d26fde38f244dcbb13e8017347ac37804d926bb5");
});
