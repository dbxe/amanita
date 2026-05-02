import { listConfiguredBackends, resolveConfigForProfile, type ConfiguredBackendSummary, type RuntimeConfig } from "./config.js";
import { resolveContractReadiness } from "./multibaas.js";
import type { TaskState } from "./runtime-types.js";

export const ARBITRUM_DAO_FOCUS_VALUES = [
  "overview",
  "authority",
  "treasury",
  "proposals",
  "delegates",
  "risks",
] as const;

export type ArbitrumDaoFocus = (typeof ARBITRUM_DAO_FOCUS_VALUES)[number];
const TARGET_TIMEOUT_MS = 20_000;

export interface ArbitrumDaoTargetDefinition {
  category: "authority" | "governor" | "timelock" | "token" | "treasury";
  chainLabel: string;
  contractAddress: string;
  description: string;
  id: string;
  profileName: string;
  roleLabel: string;
}

export interface ArbitrumDaoTargetInspection {
  alias?: string;
  configuredBackend: ConfiguredBackendSummary;
  contractAddress: string;
  contractLabel?: string;
  contractName?: string;
  definition: ArbitrumDaoTargetDefinition;
  eventLeadIds: string[];
  inspectionError?: string;
  linkedContracts: string[];
  readinessState?: TaskState;
}

export interface ArbitrumDaoInspectionResult {
  backends: ConfiguredBackendSummary[];
  focus: ArbitrumDaoFocus;
  targets: ArbitrumDaoTargetInspection[];
}

const ACTIVE_TARGETS: ArbitrumDaoTargetDefinition[] = [
  {
    category: "authority",
    chainLabel: "Ethereum mainnet",
    contractAddress: "0xE6841D92B0C345144506576eC13ECf5103aC7f49",
    description: "Ethereum-side governance finalization timelock.",
    id: "l1_timelock",
    profileName: "mainnet-remote",
    roleLabel: "L1 Timelock",
  },
  {
    category: "authority",
    chainLabel: "Ethereum mainnet",
    contractAddress: "0x3ffFbAdAF827559da092217e474760E2b2c3CeDd",
    description: "Ethereum-side upgrade authority.",
    id: "l1_upgrade_executor",
    profileName: "mainnet-remote",
    roleLabel: "L1 Upgrade Executor",
  },
  {
    category: "token",
    chainLabel: "Ethereum mainnet",
    contractAddress: "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1",
    description: "Bridged ARB token on Ethereum mainnet.",
    id: "l1_arb_token",
    profileName: "mainnet-remote",
    roleLabel: "L1 Bridged ARB",
  },
  {
    category: "governor",
    chainLabel: "Arbitrum One",
    contractAddress: "0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9",
    description: "Constitutional / protocol-level governor.",
    id: "core_governor",
    profileName: "arbitrum-one-remote",
    roleLabel: "Core Governor",
  },
  {
    category: "governor",
    chainLabel: "Arbitrum One",
    contractAddress: "0x789fC99093B09aD01C34DC7251D0C89ce743e5a4",
    description: "Treasury-focused governor.",
    id: "treasury_governor",
    profileName: "arbitrum-one-remote",
    roleLabel: "Treasury Governor",
  },
  {
    category: "timelock",
    chainLabel: "Arbitrum One",
    contractAddress: "0x34d45e99f7D8c45ed05B5cA72D54bbD1fb3F98f0",
    description: "Protocol-level L2 timelock.",
    id: "l2_core_timelock",
    profileName: "arbitrum-one-remote",
    roleLabel: "L2 Core Timelock",
  },
  {
    category: "timelock",
    chainLabel: "Arbitrum One",
    contractAddress: "0xbFc1FECa8B09A5c5D3EFfE7429eBE24b9c09EF58",
    description: "Treasury-focused L2 timelock.",
    id: "l2_treasury_timelock",
    profileName: "arbitrum-one-remote",
    roleLabel: "L2 Treasury Timelock",
  },
  {
    category: "authority",
    chainLabel: "Arbitrum One",
    contractAddress: "0xCF57572261c7c2BCF21ffD220ea7d1a27D40A827",
    description: "Arbitrum-side upgrade authority.",
    id: "l2_upgrade_executor",
    profileName: "arbitrum-one-remote",
    roleLabel: "L2 Upgrade Executor",
  },
  {
    category: "treasury",
    chainLabel: "Arbitrum One",
    contractAddress: "0xF3FC178157fb3c87548bAA86F9d24BA38E649B58",
    description: "DAO treasury wallet.",
    id: "treasury_wallet",
    profileName: "arbitrum-one-remote",
    roleLabel: "Treasury Wallet",
  },
];

const SUPPLEMENTAL_TARGETS = [
  {
    chainLabel: "Arbitrum One",
    description: "Native ARB token on Arbitrum One. Needed for delegation and vote-power work.",
    roleLabel: "L2 ARB Token",
  },
] as const;

export function parseArbitrumDaoFocus(value: string | undefined): ArbitrumDaoFocus {
  if (!value) {
    return "overview";
  }

  if ((ARBITRUM_DAO_FOCUS_VALUES as readonly string[]).includes(value)) {
    return value as ArbitrumDaoFocus;
  }

  throw new Error(`Unsupported Arbitrum DAO focus "${value}". Expected one of: ${ARBITRUM_DAO_FOCUS_VALUES.join(", ")}`);
}

function isReady(state?: TaskState): boolean {
  return state === "ready";
}

function isSyncing(state?: TaskState): boolean {
  return state === "syncing";
}

async function inspectDaoTarget(
  definition: ArbitrumDaoTargetDefinition,
  config: RuntimeConfig,
  configuredBackend: ConfiguredBackendSummary,
): Promise<ArbitrumDaoTargetInspection> {
  try {
    const readiness = await resolveContractReadiness(config, definition.contractAddress);

    return {
      alias: readiness.alias,
      configuredBackend,
      contractAddress: readiness.address,
      contractLabel: readiness.contractLabel,
      contractName: readiness.contractName,
      definition,
      eventLeadIds: [],
      linkedContracts: [],
      readinessState: readiness.state,
    };
  } catch (error) {
    return {
      configuredBackend,
      contractAddress: definition.contractAddress,
      definition,
      eventLeadIds: [],
      inspectionError: error instanceof Error ? error.message : String(error),
      linkedContracts: [],
    };
  }
}

async function inspectDaoTargetWithTimeout(
  definition: ArbitrumDaoTargetDefinition,
  config: RuntimeConfig,
  configuredBackend: ConfiguredBackendSummary,
): Promise<ArbitrumDaoTargetInspection> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      inspectDaoTarget(definition, config, configuredBackend),
      new Promise<ArbitrumDaoTargetInspection>((resolve) => {
        timer = setTimeout(() => {
          resolve({
            configuredBackend,
            contractAddress: definition.contractAddress,
            definition,
            eventLeadIds: [],
            inspectionError: `inspection timed out after ${TARGET_TIMEOUT_MS}ms`,
            linkedContracts: [],
          });
        }, TARGET_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function targetById(result: ArbitrumDaoInspectionResult, id: ArbitrumDaoTargetDefinition["id"]): ArbitrumDaoTargetInspection {
  const target = result.targets.find((candidate) => candidate.definition.id === id);
  if (!target) {
    throw new Error(`Missing Arbitrum DAO target ${id}`);
  }
  return target;
}

type AnswerabilityStatus = "grounded" | "partial" | "premature" | "blocked";

function answerabilityLabel(label: AnswerabilityStatus): string {
  if (label === "grounded") {
    return "grounded now";
  }
  if (label === "partial") {
    return "partially grounded";
  }
  if (label === "blocked") {
    return "temporarily blocked";
  }
  return "premature";
}

function buildOverviewLines(result: ArbitrumDaoInspectionResult): string[] {
  const l1Timelock = targetById(result, "l1_timelock");
  const l1UpgradeExecutor = targetById(result, "l1_upgrade_executor");
  const l2Governors = [targetById(result, "core_governor"), targetById(result, "treasury_governor")];
  const l2Timelocks = [targetById(result, "l2_core_timelock"), targetById(result, "l2_treasury_timelock")];
  const l2UpgradeExecutor = targetById(result, "l2_upgrade_executor");
  const treasuryWallet = targetById(result, "treasury_wallet");
  const l1ArbToken = targetById(result, "l1_arb_token");

  const lines: string[] = [];

  if (isReady(l1Timelock.readinessState) && isReady(l1UpgradeExecutor.readinessState)) {
    lines.push("Ethereum-side control is grounded now: the L1 timelock and L1 upgrade executor are both ready.");
  }

  if (l2Governors.some((target) => isSyncing(target.readinessState)) || l2Timelocks.some((target) => isSyncing(target.readinessState))) {
    lines.push("The Arbitrum-side governors and timelocks are linked and syncing, so contract topology is grounded but full proposal/event history is still developing.");
  }

  if (isSyncing(l2UpgradeExecutor.readinessState)) {
    lines.push("Arbitrum-side upgrade authority is visible, but its event history is still syncing.");
  }

  if (isSyncing(treasuryWallet.readinessState)) {
    lines.push("Treasury structure is visible, but treasury-flow claims are still premature until the wallet and treasury governor finish syncing.");
  }

  if (isSyncing(l1ArbToken.readinessState)) {
    lines.push("The bridged ARB token on Ethereum is present but still syncing, so bridge-side token-flow stories are not final yet.");
  }

  return lines;
}

function buildFocusAssessment(result: ArbitrumDaoInspectionResult): { grounded: string[]; next: string[]; premature: string[]; status: AnswerabilityStatus } {
  const successfulInspections = result.targets.filter((target) => target.readinessState);
  if (successfulInspections.length === 0) {
    return {
      grounded: [],
      next: [
        "Retry a narrow readiness check for one explicit target before making DAO-level claims.",
        "Use single-contract inspection against the named backend to separate backend indexing pressure from actual DAO readiness.",
      ],
      premature: [
        "DAO-level conclusions are temporarily blocked because no active target inspection completed.",
      ],
      status: "blocked",
    };
  }

  const coreGovernor = targetById(result, "core_governor");
  const treasuryGovernor = targetById(result, "treasury_governor");
  const l2CoreTimelock = targetById(result, "l2_core_timelock");
  const l2TreasuryTimelock = targetById(result, "l2_treasury_timelock");
  const l1Timelock = targetById(result, "l1_timelock");
  const l1UpgradeExecutor = targetById(result, "l1_upgrade_executor");
  const l2UpgradeExecutor = targetById(result, "l2_upgrade_executor");
  const treasuryWallet = targetById(result, "treasury_wallet");

  if (result.focus === "authority") {
    return {
      grounded: [
        "Ethereum mainnet currently gives the cleanest grounded authority picture because the L1 timelock and L1 upgrade executor are ready.",
        "Arbitrum One authority is already structurally visible through the core/treasury timelocks and L2 upgrade executor, even though those contracts are still syncing.",
      ],
      next: [
        "Use the ready L1 contracts for recent control-history questions now.",
        "Revisit the L2 timelocks and L2 upgrade executor as their event history catches up.",
      ],
      premature: [
        "Do not treat Arbitrum-side admin-change history as complete until the L2 timelocks and L2 upgrade executor are ready.",
      ],
      status: isReady(l1Timelock.readinessState) && isReady(l1UpgradeExecutor.readinessState) ? "partial" : "premature",
    };
  }

  if (result.focus === "treasury") {
    return {
      grounded: [
        "The treasury story is structurally grounded: Treasury Governor -> L2 Treasury Timelock -> Treasury Wallet.",
      ],
      next: [
        "As the treasury governor, treasury timelock, and treasury wallet continue syncing, treasury-impacting proposal and transfer questions will become grounded.",
      ],
      premature: [
        "Do not claim which proposals moved treasury assets yet; that depends on synced treasury-governor, treasury-timelock, and treasury-wallet history.",
      ],
      status: [treasuryGovernor, l2TreasuryTimelock, treasuryWallet].some((target) => isReady(target.readinessState)) ? "partial" : "premature",
    };
  }

  if (result.focus === "proposals") {
    return {
      grounded: [
        "The proposal path is structurally grounded: governors feed timelocks, and timelocks gate execution.",
      ],
      next: [
        "Once the governors and timelocks are ready, proposal lifecycle and consequence questions should become first-class.",
      ],
      premature: [
        "It is still premature to rank consequential executed proposals because the governor and timelock event history is still syncing on Arbitrum One.",
      ],
      status: [coreGovernor, treasuryGovernor, l2CoreTimelock, l2TreasuryTimelock].some((target) => isReady(target.readinessState)) ? "partial" : "premature",
    };
  }

  if (result.focus === "delegates") {
    return {
      grounded: [],
      next: [
        "Add the native ARB token on Arbitrum One back into the active target set when sync budget allows.",
        "Then combine ARB delegation/voting-power history with governor vote events.",
      ],
      premature: [
        "Delegate-power questions are premature right now because the native L2 ARB token is not in the active demo target set and the governors are still syncing.",
      ],
      status: "premature",
    };
  }

  if (result.focus === "risks") {
    return {
      grounded: [
        "We can already name which timelocks matter for queued-risk analysis: the L2 core timelock, the L2 treasury timelock, and the L1 timelock.",
      ],
      next: [
        "Use the ready L1 timelock now for Ethereum-side control history.",
        "Wait for the L2 timelocks to finish syncing before making queued-risk claims on Arbitrum One.",
      ],
      premature: [
        "Current queued-risk claims on Arbitrum One are premature because the L2 timelocks are still syncing.",
      ],
      status: isReady(l1Timelock.readinessState) ? "partial" : "premature",
    };
  }

  return {
    grounded: buildOverviewLines(result),
    next: [
      "Ask narrow questions against the ready L1 contracts now.",
      "As the Arbitrum-side governors, timelocks, and treasury continue syncing, broader proposal and treasury questions will become grounded.",
      "Delegate-power work still needs the native ARB token on Arbitrum One back in the target set.",
    ],
    premature: [
      "Delegate-power questions are premature without the native L2 ARB token plus synced governor vote history.",
      "Queued-risk and proposal-consequence questions are still premature while the Arbitrum-side governors and timelocks are syncing.",
    ],
    status: "partial",
  };
}

export async function inspectArbitrumDao(focus: ArbitrumDaoFocus = "overview"): Promise<ArbitrumDaoInspectionResult> {
  const backends = listConfiguredBackends();
  const backendMap = new Map(backends.map((backend) => [backend.profileName, backend]));
  const configMap = new Map<string, RuntimeConfig>();
  const targetGroups = new Map<string, ArbitrumDaoTargetDefinition[]>();

  for (const target of ACTIVE_TARGETS) {
    if (!configMap.has(target.profileName)) {
      configMap.set(target.profileName, resolveConfigForProfile(target.profileName));
    }
    targetGroups.set(target.profileName, [...(targetGroups.get(target.profileName) ?? []), target]);
  }

  const targetsById = new Map<string, ArbitrumDaoTargetInspection>();
  await Promise.all(
    [...targetGroups.entries()].map(async ([profileName, groupedTargets]) => {
      const config = configMap.get(profileName);
      const configuredBackend = backendMap.get(profileName);
      if (!config || !configuredBackend) {
        throw new Error(`Missing configured backend profile ${profileName} for Arbitrum DAO inspection.`);
      }

      for (const target of groupedTargets) {
        targetsById.set(target.id, await inspectDaoTargetWithTimeout(target, config, configuredBackend));
      }
    }),
  );

  return {
    backends,
    focus,
    targets: ACTIVE_TARGETS.map((target) => {
      const inspection = targetsById.get(target.id);
      if (!inspection) {
        throw new Error(`Missing Arbitrum DAO inspection result for ${target.id}`);
      }
      return inspection;
    }),
  };
}

function formatInspectionError(error: string): string {
  if (/timed out/i.test(error)) {
    return "inspection did not complete; retry a narrow target check before making historical claims";
  }
  if (/request failed \(500\)|internal error/i.test(error)) {
    return "backend request failed while indexing or status reads were under pressure; retry a narrow target check";
  }
  return error;
}

export function formatArbitrumDaoInspection(result: ArbitrumDaoInspectionResult): string {
  const focusAssessment = buildFocusAssessment(result);
  const lines = [
    `Arbitrum DAO ${result.focus} read`,
    "",
    `Answerability: ${answerabilityLabel(focusAssessment.status)}`,
    "",
    "Active target set",
  ];

  for (const target of result.targets) {
    const status = target.inspectionError
      ? `inspection incomplete (${formatInspectionError(target.inspectionError)})`
      : target.readinessState ?? "unknown";
    lines.push(
      `- [${status}] ${target.definition.roleLabel} (${target.definition.chainLabel})`,
      `  address: ${target.contractAddress}`,
      `  role: ${target.definition.description}`,
    );
    if (target.contractLabel || target.contractName) {
      lines.push(`  contract: ${target.contractName ?? "unknown"}${target.contractLabel ? ` via ${target.contractLabel}` : ""}`);
    }
    if (target.linkedContracts.length > 0) {
      lines.push(`  linked: ${target.linkedContracts.join(", ")}`);
    }
    if (target.eventLeadIds.length > 0) {
      lines.push(`  event leads now: ${target.eventLeadIds.join(", ")}`);
    }
  }

  const incompleteTargets = result.targets.filter((target) => target.inspectionError);
  if (incompleteTargets.length > 0) {
    lines.push("", "Inspection caveats");
    for (const target of incompleteTargets) {
      lines.push(`- ${target.definition.roleLabel}: ${formatInspectionError(target.inspectionError!)}`);
    }
  }

  lines.push("", "Grounded now");
  for (const line of focusAssessment.grounded) {
    lines.push(`- ${line}`);
  }

  lines.push("", "Still premature");
  for (const line of focusAssessment.premature) {
    lines.push(`- ${line}`);
  }

  lines.push("", "Next best questions");
  for (const line of focusAssessment.next) {
    lines.push(`- ${line}`);
  }

  lines.push("", "Supplemental targets not in the active demo set");
  for (const target of SUPPLEMENTAL_TARGETS) {
    lines.push(`- ${target.roleLabel} (${target.chainLabel}): ${target.description}`);
  }

  return lines.join("\n");
}
