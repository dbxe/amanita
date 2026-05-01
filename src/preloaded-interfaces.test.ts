import assert from "node:assert/strict";
import test from "node:test";

import {
  contractDefinitionMatchesPreloadedInterface,
  getPreloadedInterface,
  listPreloadedInterfaces,
} from "./preloaded-interfaces.js";

test("listPreloadedInterfaces exposes the core hackathon interface inventory", () => {
  const labels = listPreloadedInterfaces().map((entry) => entry.label);

  assert.ok(labels.includes("erc20interface"));
  assert.ok(labels.includes("fiattokenv2interface"));
  assert.ok(labels.includes("uniswapv3poolinterface"));
  assert.ok(labels.includes("aavev3poolinterface"));
});

test("contractDefinitionMatchesPreloadedInterface recognizes an ERC-20 surface", () => {
  const erc20 = getPreloadedInterface("erc20interface");
  assert.ok(erc20);

  const matches = contractDefinitionMatchesPreloadedInterface(
    {
      abi: {
        events: {
          "Approval(address,address,uint256)": {},
          "Transfer(address,address,uint256)": {},
        },
        methods: {
          "allowance(address,address)": {},
          "approve(address,uint256)": {},
          "balanceOf(address)": {},
          "decimals()": {},
          "name()": {},
          "symbol()": {},
          "totalSupply()": {},
          "transfer(address,uint256)": {},
          "transferFrom(address,address,uint256)": {},
        },
      },
      label: "erc20interface",
      version: "1.0",
    },
    erc20,
  );

  assert.equal(matches, true);
});

test("contractDefinitionMatchesPreloadedInterface rejects a partial role surface", () => {
  const accessControl = getPreloadedInterface("accesscontrolinterface");
  assert.ok(accessControl);

  const matches = contractDefinitionMatchesPreloadedInterface(
    {
      abi: {
        events: {
          "RoleGranted(bytes32,address,address)": {},
        },
        methods: {
          "hasRole(bytes32,address)": {},
        },
      },
      label: "partialaccesscontrol",
      version: "1.0",
    },
    accessControl,
  );

  assert.equal(matches, false);
});
