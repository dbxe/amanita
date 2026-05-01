import type { ContractDefinition } from "./multibaas.js";

export interface PreloadedInterfaceDefinition {
  abi: Array<Record<string, unknown>>;
  capabilityTags: string[];
  contractName: string;
  label: string;
  requiredEvents: string[];
  requiredMethods: string[];
  summary: string;
  version: string;
}

function hasAbiFragment(
  abi: Array<Record<string, unknown>>,
  fragmentType: "event" | "function",
  name: string,
): boolean {
  return abi.some((fragment) => fragment.type === fragmentType && fragment.name === name);
}

function defineInterface(definition: Omit<PreloadedInterfaceDefinition, "requiredEvents" | "requiredMethods">): PreloadedInterfaceDefinition {
  const requiredEvents = definition.abi
    .filter((fragment) => fragment.type === "event" && typeof fragment.name === "string")
    .map((fragment) => String(fragment.name));
  const requiredMethods = definition.abi
    .filter((fragment) => fragment.type === "function" && typeof fragment.name === "string")
    .map((fragment) => String(fragment.name));

  return {
    ...definition,
    requiredEvents,
    requiredMethods,
  };
}

export const PRELOADED_INTERFACE_LIBRARY: PreloadedInterfaceDefinition[] = [
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }], name: "Transfer", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "owner", type: "address" }, { indexed: true, name: "spender", type: "address" }, { indexed: false, name: "value", type: "uint256" }], name: "Approval", type: "event" },
      { inputs: [], name: "name", outputs: [{ name: "", type: "string" }], stateMutability: "view", type: "function" },
      { inputs: [], name: "symbol", outputs: [{ name: "", type: "string" }], stateMutability: "view", type: "function" },
      { inputs: [], name: "decimals", outputs: [{ name: "", type: "uint8" }], stateMutability: "view", type: "function" },
      { inputs: [], name: "totalSupply", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
      { inputs: [{ name: "account", type: "address" }], name: "balanceOf", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
      { inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], name: "allowance", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
      { inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], name: "approve", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" },
      { inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], name: "transfer", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" },
      { inputs: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }], name: "transferFrom", outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable", type: "function" },
    ],
    capabilityTags: ["erc20", "metadata", "balances", "allowances", "holders"],
    contractName: "ERC20Interface",
    label: "erc20interface",
    summary: "Standard ERC-20 metadata, balance, allowance, and Transfer/Approval event surface.",
    version: "1.0",
  }),
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: true, name: "previousOwner", type: "address" }, { indexed: true, name: "newOwner", type: "address" }], name: "OwnershipTransferred", type: "event" },
      { inputs: [], name: "owner", outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
      { inputs: [], name: "renounceOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
      { inputs: [{ name: "newOwner", type: "address" }], name: "transferOwnership", outputs: [], stateMutability: "nonpayable", type: "function" },
    ],
    capabilityTags: ["ownership", "admin", "governance"],
    contractName: "OwnableInterface",
    label: "ownableinterface",
    summary: "Ownable control surface for simple admin ownership inspection and transfer history.",
    version: "1.0",
  }),
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: false, name: "account", type: "address" }], name: "Paused", type: "event" },
      { anonymous: false, inputs: [{ indexed: false, name: "account", type: "address" }], name: "Unpaused", type: "event" },
      { inputs: [], name: "paused", outputs: [{ name: "", type: "bool" }], stateMutability: "view", type: "function" },
    ],
    capabilityTags: ["pause-state", "controls"],
    contractName: "PausableInterface",
    label: "pausableinterface",
    summary: "Pause-state inspection plus Paused/Unpaused control history.",
    version: "1.0",
  }),
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: true, name: "role", type: "bytes32" }, { indexed: true, name: "previousAdminRole", type: "bytes32" }, { indexed: true, name: "newAdminRole", type: "bytes32" }], name: "RoleAdminChanged", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "role", type: "bytes32" }, { indexed: true, name: "account", type: "address" }, { indexed: true, name: "sender", type: "address" }], name: "RoleGranted", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "role", type: "bytes32" }, { indexed: true, name: "account", type: "address" }, { indexed: true, name: "sender", type: "address" }], name: "RoleRevoked", type: "event" },
      { inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], name: "hasRole", outputs: [{ name: "", type: "bool" }], stateMutability: "view", type: "function" },
      { inputs: [{ name: "role", type: "bytes32" }], name: "getRoleAdmin", outputs: [{ name: "", type: "bytes32" }], stateMutability: "view", type: "function" },
      { inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], name: "grantRole", outputs: [], stateMutability: "nonpayable", type: "function" },
      { inputs: [{ name: "role", type: "bytes32" }, { name: "account", type: "address" }], name: "revokeRole", outputs: [], stateMutability: "nonpayable", type: "function" },
      { inputs: [{ name: "role", type: "bytes32" }, { name: "callerConfirmation", type: "address" }], name: "renounceRole", outputs: [], stateMutability: "nonpayable", type: "function" },
    ],
    capabilityTags: ["roles", "access-control", "governance"],
    contractName: "AccessControlInterface",
    label: "accesscontrolinterface",
    summary: "Role-based permission surface with grant/revoke/admin-change event history.",
    version: "1.0",
  }),
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: true, name: "implementation", type: "address" }], name: "Upgraded", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "previousAdmin", type: "address" }, { indexed: true, name: "newAdmin", type: "address" }], name: "AdminChanged", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "beacon", type: "address" }], name: "BeaconUpgraded", type: "event" },
    ],
    capabilityTags: ["proxy", "upgrades", "admin"],
    contractName: "ERC1967ProxyInterface",
    label: "erc1967proxyinterface",
    summary: "Upgradeable proxy event surface for implementation, beacon, and admin changes.",
    version: "1.0",
  }),
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: true, name: "account", type: "address" }], name: "Blacklist", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "account", type: "address" }], name: "UnBlacklist", type: "event" },
      { anonymous: false, inputs: [], name: "Pause", type: "event" },
      { anonymous: false, inputs: [], name: "Unpause", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "minter", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "amount", type: "uint256" }], name: "Mint", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "burner", type: "address" }, { indexed: false, name: "amount", type: "uint256" }], name: "Burn", type: "event" },
      { inputs: [{ name: "account", type: "address" }], name: "isBlacklisted", outputs: [{ name: "", type: "bool" }], stateMutability: "view", type: "function" },
      { inputs: [], name: "paused", outputs: [{ name: "", type: "bool" }], stateMutability: "view", type: "function" },
    ],
    capabilityTags: ["stablecoin-controls", "blacklist", "pause-state", "mint-burn"],
    contractName: "FiatTokenV2Interface",
    label: "fiattokenv2interface",
    summary: "Stablecoin issuer-control surface for blacklist, pause, mint, and burn history.",
    version: "1.0",
  }),
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: false, name: "sender", type: "address" }, { indexed: true, name: "owner", type: "address" }, { indexed: true, name: "tickLower", type: "int24" }, { indexed: true, name: "tickUpper", type: "int24" }, { indexed: false, name: "amount", type: "uint128" }, { indexed: false, name: "amount0", type: "uint256" }, { indexed: false, name: "amount1", type: "uint256" }], name: "Mint", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "owner", type: "address" }, { indexed: true, name: "tickLower", type: "int24" }, { indexed: true, name: "tickUpper", type: "int24" }, { indexed: false, name: "amount", type: "uint128" }, { indexed: false, name: "amount0", type: "uint256" }, { indexed: false, name: "amount1", type: "uint256" }], name: "Burn", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "owner", type: "address" }, { indexed: false, name: "recipient", type: "address" }, { indexed: true, name: "tickLower", type: "int24" }, { indexed: true, name: "tickUpper", type: "int24" }, { indexed: false, name: "amount0", type: "uint128" }, { indexed: false, name: "amount1", type: "uint128" }], name: "Collect", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "sender", type: "address" }, { indexed: true, name: "recipient", type: "address" }, { indexed: false, name: "amount0", type: "int256" }, { indexed: false, name: "amount1", type: "int256" }, { indexed: false, name: "sqrtPriceX96", type: "uint160" }, { indexed: false, name: "liquidity", type: "uint128" }, { indexed: false, name: "tick", type: "int24" }], name: "Swap", type: "event" },
      { inputs: [], name: "liquidity", outputs: [{ name: "", type: "uint128" }], stateMutability: "view", type: "function" },
      { inputs: [], name: "slot0", outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint8" }, { name: "unlocked", type: "bool" }], stateMutability: "view", type: "function" },
    ],
    capabilityTags: ["amm", "uniswap-v3", "liquidity", "swaps", "lp-analysis"],
    contractName: "UniswapV3PoolInterface",
    label: "uniswapv3poolinterface",
    summary: "Uniswap V3 pool event surface for LP concentration, liquidity changes, and swaps.",
    version: "1.0",
  }),
  defineInterface({
    abi: [
      { anonymous: false, inputs: [{ indexed: true, name: "reserve", type: "address" }, { indexed: false, name: "user", type: "address" }, { indexed: true, name: "onBehalfOf", type: "address" }, { indexed: true, name: "referralCode", type: "uint16" }, { indexed: false, name: "amount", type: "uint256" }], name: "Supply", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "reserve", type: "address" }, { indexed: true, name: "user", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "amount", type: "uint256" }], name: "Withdraw", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "reserve", type: "address" }, { indexed: false, name: "user", type: "address" }, { indexed: true, name: "onBehalfOf", type: "address" }, { indexed: false, name: "amount", type: "uint256" }, { indexed: false, name: "interestRateMode", type: "uint8" }, { indexed: false, name: "borrowRate", type: "uint256" }, { indexed: true, name: "referralCode", type: "uint16" }], name: "Borrow", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "reserve", type: "address" }, { indexed: true, name: "user", type: "address" }, { indexed: true, name: "repayer", type: "address" }, { indexed: false, name: "amount", type: "uint256" }, { indexed: false, name: "useATokens", type: "bool" }], name: "Repay", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "collateralAsset", type: "address" }, { indexed: true, name: "debtAsset", type: "address" }, { indexed: true, name: "user", type: "address" }, { indexed: false, name: "debtToCover", type: "uint256" }, { indexed: false, name: "liquidatedCollateralAmount", type: "uint256" }, { indexed: false, name: "liquidator", type: "address" }, { indexed: false, name: "receiveAToken", type: "bool" }], name: "LiquidationCall", type: "event" },
      { anonymous: false, inputs: [{ indexed: true, name: "user", type: "address" }, { indexed: false, name: "categoryId", type: "uint8" }], name: "UserEModeSet", type: "event" },
    ],
    capabilityTags: ["lending", "aave-v3", "borrows", "liquidations", "flows"],
    contractName: "AaveV3PoolInterface",
    label: "aavev3poolinterface",
    summary: "Aave V3 pool flow events for supply, borrow, repay, liquidation, and eMode analytics.",
    version: "1.0",
  }),
];

export function listPreloadedInterfaces(): PreloadedInterfaceDefinition[] {
  return PRELOADED_INTERFACE_LIBRARY.map((definition) => ({ ...definition, abi: [...definition.abi] }));
}

export function getPreloadedInterface(label: string): PreloadedInterfaceDefinition | undefined {
  const normalizedLabel = label.trim().toLowerCase();
  return PRELOADED_INTERFACE_LIBRARY.find((definition) => definition.label === normalizedLabel);
}

export function contractDefinitionMatchesPreloadedInterface(
  definition: ContractDefinition,
  preloadedInterface: PreloadedInterfaceDefinition,
): boolean {
  const methods = definition.abi?.methods ?? {};
  const events = definition.abi?.events ?? {};

  const hasRequiredMethods = preloadedInterface.requiredMethods.every(
    (methodName) =>
      hasAbiFragment(preloadedInterface.abi, "function", methodName)
      && Object.keys(methods).some((signature) => signature.startsWith(`${methodName}(`)),
  );
  const hasRequiredEvents = preloadedInterface.requiredEvents.every(
    (eventName) =>
      hasAbiFragment(preloadedInterface.abi, "event", eventName)
      && Object.keys(events).some((signature) => signature.startsWith(`${eventName}(`)),
  );

  return hasRequiredMethods && hasRequiredEvents;
}
