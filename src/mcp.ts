import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ARBITRUM_DAO_FOCUS_VALUES, formatArbitrumDaoInspection, inspectArbitrumDao } from "./arbitrum-dao-service.js";
import {
  ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES,
  analyzeArbitrumGovernanceIncident,
  formatArbitrumGovernanceIncidentAnalysis,
  formatArbitrumGovernanceIncidentMonitorSetup,
} from "./arbitrum-governance-incident-service.js";
import {
  ensureContractInterfaceLink,
  formatContractInterfaceInspection,
  formatPreloadedInterfaceStatuses,
  getPreloadedInterfaceCatalogStatus,
  inspectContractInterfaces,
} from "./contract-interface-service.js";
import {
  formatContractAddressInvestigationResult,
  formatContractLookupResult,
  formatImportContractLookupCandidateResult,
  investigateContractAddress,
  importContractLookupCandidateForAddress,
  lookupContractCandidatesForAddress,
} from "./contract-lookup-service.js";
import { listConfiguredBackends, resolveConfig } from "./config.js";
import {
  createArbitrumFrozenEthReleaseMonitor,
  formatArbitrumFrozenEthReleaseMonitorRegistration,
} from "./event-monitor-service.js";
import {
  formatEventCapabilityInspection,
  formatEventInvestigation,
  inspectEventCapabilities,
  runEventInvestigation,
} from "./event-intelligence-service.js";
import { formatTokenControlEvents, getTokenControlEvents } from "./event-view-service.js";
import { evaluatePendingHolderQueries, getTopHoldersForTokenTarget } from "./holder-query-service.js";
import { formatTokenInvestigation, investigateToken } from "./investigation-service.js";
import { formatMutationConfirmationRequired, isMutationConfirmationRequired } from "./mcp-safety.js";
import { formatConfiguredBackends, formatMultichainInspection, inspectTargetsAcrossBackends } from "./multichain-service.js";
import { getAddressBalanceForTokenTarget, getHolderConcentrationForTokenTarget } from "./query-service.js";
import {
  getErc20Metadata,
  resolveContractReadiness,
} from "./multibaas.js";
import { loadState } from "./state.js";
import { formatAlerts, formatSavedWatch, formatTasks, formatWatches } from "./task-formatting.js";
import { requireTokenTarget, resolveTokenTarget } from "./token-target-service.js";
import { DEFAULT_WEBHOOK_LABEL, ensureBalanceWebhook } from "./webhook-service.js";
import { evaluateBalanceWatches, listBalanceWatches, saveBalanceWatch } from "./watch-service.js";

const server = new McpServer({
  name: "logrunner",
  version: "0.1.0",
});

function mutationConfirmationRequired(operation: string, confirmed?: boolean) {
  if (!isMutationConfirmationRequired() || confirmed) {
    return undefined;
  }

  return {
    content: [{ type: "text" as const, text: formatMutationConfirmationRequired(operation) }],
  };
}

async function arbitrumGovernanceIncidentToolContent(
  input: {
    focus?: (typeof ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES)[number];
    limit?: number;
  },
) {
  return {
    content: [{
      type: "text" as const,
      text: formatArbitrumGovernanceIncidentAnalysis(
        await analyzeArbitrumGovernanceIncident({
          focus: input.focus,
          limit: input.limit,
        }),
      ),
    }],
  };
}

async function arbitrumGovernanceIncidentMonitorToolContent(input: { limit?: number }) {
  return {
    content: [{
      type: "text" as const,
      text: formatArbitrumGovernanceIncidentMonitorSetup(
        await analyzeArbitrumGovernanceIncident({
          focus: "monitor",
          limit: input.limit,
        }),
      ),
    }],
  };
}

server.tool("list_preloaded_interfaces", {}, async () => ({
  content: [{
    type: "text",
    text: formatPreloadedInterfaceStatuses(await getPreloadedInterfaceCatalogStatus()),
  }],
}));

server.tool("list_configured_backends", {}, async () => ({
  content: [{
    type: "text",
    text: formatConfiguredBackends(listConfiguredBackends()),
  }],
}));

server.tool(
  "inspect_arbitrum_dao",
  {
    focus: z.enum(ARBITRUM_DAO_FOCUS_VALUES).optional(),
  },
  async ({ focus }) => ({
    content: [{
      type: "text",
      text: formatArbitrumDaoInspection(await inspectArbitrumDao(focus)),
    }],
  }),
);

server.tool(
  "analyze_arbitrum_governance_incident",
  "Use this general incident-analysis tool for every KelpDAO / rsETH frozen ETH Arbitrum governance incident turn before answering, even if a previous turn already checked related event data. Do not answer from prior context alone. Do not send a standalone progress-only message before calling this tool. It returns an evidence packet: public context, decoded live event evidence, proposal-status verdict, monitor plan, and evidence boundaries. For explicit notify/watch/alert monitor requests, including combined prompts that ask whether the proposal is onchain yet and ask to be told when it is, use monitor_governance_proposal so the follow-up is driven by the MultiBaas webhook path. Do not recite the packet wholesale. Synthesize your own concise answer from the packet, copy the compact fenced event_query block exactly, and preserve the stated evidence boundaries.",
  {
    focus: z.enum(ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ focus, limit }) => arbitrumGovernanceIncidentToolContent({ focus, limit }),
);

server.tool(
  "summarize_governance_incident",
  "Mandatory for opening governance incident prompts like: what's going on with Arbitrum governance lately, council froze ETH, what's the brief. Call this before answering even if the same incident came up earlier. Do not send a standalone progress-only message before calling this tool. Returns an evidence packet for the brief and the Core Governor ProposalCreated query that was checked. Use it as source material, not a script. The final answer must cover what happened, contracts to inspect, what can happen next, and the fenced event_query block.",
  {
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ limit }) => arbitrumGovernanceIncidentToolContent({ focus: "brief", limit }),
);

server.tool(
  "verify_governance_control_activity",
  "Mandatory for governance prompts asking whether event data shows a freeze transaction or whether an emergency governance response can be proved or verified from live onchain event data. Call this before answering even if prior turns already discussed live event data. Do not send a standalone progress-only message before calling this tool. This runs decoded MultiBaas event queries for the L1/L2 timelocks and upgrade executors. Use the result as an evidence packet: explain what you checked, what you found, and the boundary that this verifies governance-control activity, not the specific freeze transaction unless a matching freeze-specific event or transaction is present. Copy the fenced event_query block exactly.",
  {
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ limit }) => arbitrumGovernanceIncidentToolContent({ focus: "verify-freeze", limit }),
);

server.tool(
  "check_governance_proposal_status",
  "Mandatory for status-only governance proposal prompts like: has the proposal to release the frozen ETH reached onchain governance yet, landed onchain, or landed on chain? Call this before answering even if a previous turn already checked proposal status. Do not send a standalone progress-only message before calling this tool. This checks the Arbitrum One Core Governor ProposalCreated stream for Kelp / rsETH / frozen ETH markers as a current-status preflight. Use the result as an evidence packet, answer the status in your own words, and copy the fenced event_query block exactly. Do not set up, promise, or imply a monitor when the user only asks for current status. If the same prompt also says let me know, notify me, alert me, watch, or monitor, call monitor_governance_proposal instead.",
  {
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ limit }) => arbitrumGovernanceIncidentToolContent({ focus: "proposal-status", limit }),
);

server.tool(
  "plan_governance_proposal_monitor",
  "Use for dry-run or explanatory monitor-plan questions about how a governance release proposal would be watched. Do not call this for status-only questions such as has it reached onchain governance yet. For explicit notify/watch/alert requests, call monitor_governance_proposal instead so the monitor is registered through the MultiBaas webhook path. Returns an evidence packet with the current verdict, monitor target, filters, and follow-up analysis. Synthesize the acknowledgement yourself and copy the fenced event_query block exactly.",
  {
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ limit }) => arbitrumGovernanceIncidentMonitorToolContent({ limit }),
);

server.tool(
  "monitor_governance_proposal",
  "Mandatory for explicit monitor requests like: let me know, notify me, alert me, watch for, or monitor when a governance release proposal reaches onchain governance or lands onchain. Also mandatory for combined prompts like: has the proposal to release the frozen ETH reached onchain governance yet; if not, let me know when it does. This tool performs a ProposalCreated current-status preflight first, then uses the configured or already-active MultiBaas event.emitted webhook and persists the Core Governor ProposalCreated monitor with agent-side incident filters. Do not use NanoClaw schedule_task for this incident monitor. Do not invent or provide a webhook URL. After this succeeds, answer that the webhook-backed monitor is active, include the event_query trace block and the monitor_activation proof block, and describe the exact stream, filters, webhook id, and follow-up analysis. If this returns status: failed in monitor_activation, do not call a status-only fallback tool; say the proposal is not onchain in the preflight and the monitor was not activated because the webhook is missing.",
  {
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ limit }) => ({
    content: [{
      type: "text",
      text: formatArbitrumFrozenEthReleaseMonitorRegistration(
        await createArbitrumFrozenEthReleaseMonitor({ limit }),
      ),
    }],
  }),
);

server.tool(
  "inspect_targets_across_backends",
  {
    targets: z.array(z.object({
      contractAddress: z.string().min(1).optional(),
      profileName: z.string().min(1),
      role: z.string().min(1).optional(),
      tokenName: z.string().min(1).optional(),
    })).min(1),
  },
  async ({ targets }) => ({
    content: [{
      type: "text",
      text: formatMultichainInspection(await inspectTargetsAcrossBackends(targets)),
    }],
  }),
);

server.tool(
  "investigate_contract_address",
  "Inspect a raw contract address and, when allowed, import/link the clear verified ABI candidate. This can mutate MultiBaas setup and start historical indexing. If confirmation is required, call once without confirmed; only retry with confirmed true after the tool asks for confirmation and the user explicitly agrees in a later message.",
  {
    confirmed: z.boolean().optional().describe("Set true only after this tool has already returned a confirmation-required message and the user explicitly confirmed in a later message."),
    contractAddress: z.string().min(1),
  },
  async ({ confirmed, contractAddress }) => {
    const confirmation = mutationConfirmationRequired("automatic contract ABI import/linking", confirmed);
    if (confirmation) {
      return confirmation;
    }

    return {
      content: [{
        type: "text",
        text: formatContractAddressInvestigationResult(await investigateContractAddress(contractAddress)),
      }],
    };
  },
);

server.tool(
  "lookup_contract_candidates",
  {
    contractAddress: z.string().min(1),
  },
  async ({ contractAddress }) => ({
    content: [{
      type: "text",
      text: formatContractLookupResult(await lookupContractCandidatesForAddress(contractAddress)),
    }],
  }),
);

server.tool(
  "import_contract_lookup_candidate",
  "Import a selected verified ABI candidate and link it to an address. This mutates MultiBaas setup and may start historical indexing. If confirmation is required, call once without confirmed; only retry with confirmed true after the tool asks for confirmation and the user explicitly agrees in a later message.",
  {
    candidateIndex: z.number().int().min(0),
    confirmed: z.boolean().optional().describe("Set true only after this tool has already returned a confirmation-required message and the user explicitly confirmed in a later message."),
    contractAddress: z.string().min(1),
    contractLabel: z.string().min(1).optional(),
    startingBlock: z.string().min(1).optional(),
  },
  async ({ candidateIndex, confirmed, contractAddress, contractLabel, startingBlock }) => {
    const confirmation = mutationConfirmationRequired("manual contract ABI import/linking", confirmed);
    if (confirmation) {
      return confirmation;
    }

    return {
      content: [{
        type: "text",
        text: formatImportContractLookupCandidateResult(
          await importContractLookupCandidateForAddress({
            address: contractAddress,
            candidateIndex,
            contractLabel,
            startingBlock,
          }),
        ),
      }],
    };
  },
);

server.tool(
  "inspect_contract_interfaces",
  {
    confirmed: z.boolean().optional(),
    contractAddress: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, tokenName }) => {
    const target = await resolveTokenTarget({ contractAddress, tokenName });
    if (target.unresolved) {
      return {
        content: [{ type: "text", text: `I don't know the contract address for ${target.tokenNameInput} yet. Tell me the token contract address and I'll inspect its interface coverage directly.` }],
      };
    }

    if (!target.address) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address or a known token name and I'll inspect its interface coverage." }],
      };
    }

    return {
      content: [{
        type: "text",
        text: formatContractInterfaceInspection(await inspectContractInterfaces(target.address)),
      }],
    };
  },
);

server.tool(
  "ensure_contract_interface",
  "Manually link one preloaded interface to an address. This mutates MultiBaas setup and may start historical indexing. If confirmation is required, call once without confirmed; only retry with confirmed true after the tool asks for confirmation and the user explicitly agrees in a later message.",
  {
    confirmed: z.boolean().optional().describe("Set true only after this tool has already returned a confirmation-required message and the user explicitly confirmed in a later message."),
    contractAddress: z.string().min(1).optional(),
    interfaceLabel: z.string().min(1),
    startingBlock: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ confirmed, contractAddress, interfaceLabel, startingBlock, tokenName }) => {
    const confirmation = mutationConfirmationRequired("manual contract interface linking", confirmed);
    if (confirmation) {
      return confirmation;
    }

    const target = await resolveTokenTarget({ contractAddress, tokenName });
    if (target.unresolved) {
      return {
        content: [{ type: "text", text: `I don't know the contract address for ${target.tokenNameInput} yet. Tell me the token contract address and I'll link the requested interface.` }],
      };
    }

    if (!target.address) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address or a known token name and I'll link the requested interface." }],
      };
    }

    return {
      content: [{
        type: "text",
        text: formatContractInterfaceInspection(
          await ensureContractInterfaceLink({
            addressOrAlias: target.address,
            label: interfaceLabel,
            startingBlock,
          }),
        ),
      }],
    };
  },
);

server.tool(
  "resolve_contract_target",
  {
    contractAddress: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, tokenName }) => {
    const target = await resolveTokenTarget({ contractAddress, tokenName });
    if (target.unresolved) {
      return {
        content: [{ type: "text", text: `I don't know the contract address for ${target.tokenNameInput} yet. Tell me the token contract address and I'll inspect it directly.` }],
      };
    }

    if (!target.address) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address or a known token name and I'll resolve it." }],
      };
    }

    const readiness = await resolveContractReadiness(resolveConfig(), target.address);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(
          {
            address: readiness.address,
            alias: readiness.alias ?? target.alias,
            contractLabel: readiness.contractLabel,
            contractName: readiness.contractName,
            state: readiness.state,
            isProcessingPastLogs: readiness.isProcessingPastLogs,
          },
          null,
          2,
        ),
      }],
    };
  },
);

server.tool(
  "get_token_metadata",
  {
    contractAddress: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, tokenName }) => {
    const target = await resolveTokenTarget({ contractAddress, tokenName });
    if (target.unresolved) {
      return {
        content: [{ type: "text", text: `I don't know the contract address for ${target.tokenNameInput} yet. Tell me the token contract address and I'll query its metadata directly.` }],
      };
    }

    if (!target.address) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address or a known token name and I'll query its metadata." }],
      };
    }

    const metadata = await getErc20Metadata(resolveConfig(), target.address);
    return {
      content: [{
        type: "text",
        text: JSON.stringify(metadata, null, 2),
      }],
    };
  },
);

server.tool(
  "inspect_event_capabilities",
  {
    contractAddress: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, tokenName }) => ({
    content: [{
      type: "text",
      text: formatEventCapabilityInspection(
        await inspectEventCapabilities({
          contractAddress,
          tokenName,
        }),
      ),
    }],
  }),
);

server.tool(
  "run_event_investigation",
  {
    contractAddress: z.string().min(1).optional(),
    leadId: z.enum([
      "holder_distribution",
      "token_control_timeline",
      "stablecoin_issuer_activity",
      "uniswap_v3_net_liquidity",
      "uniswap_v3_recent_activity",
      "aave_v3_net_borrowers",
      "aave_v3_top_liquidators",
      "aave_v3_recent_activity",
    ]),
    limit: z.number().int().min(1).max(100).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, leadId, limit, tokenName }) => ({
    content: [{
      type: "text",
      text: formatEventInvestigation(
        await runEventInvestigation({
          contractAddress,
          leadId,
          limit,
          tokenName,
        }),
      ),
    }],
  }),
);

server.tool(
  "get_token_control_events",
  {
    contractAddress: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, limit, tokenName }) => ({
    content: [{
      type: "text",
      text: formatTokenControlEvents(
        await getTokenControlEvents({
          contractAddress,
          limit,
          tokenName,
        }),
      ),
    }],
  }),
);

server.tool(
  "investigate_token",
  {
    contractAddress: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, limit, tokenName }) => ({
    content: [{
      type: "text",
      text: formatTokenInvestigation(
        await investigateToken({
          contractAddress,
          limit,
          tokenName,
        }),
      ),
    }],
  }),
);

server.tool(
  "get_top_holders",
  {
    contractAddress: z
      .string()
      .min(1)
      .describe("ERC-20 token contract address. Prefer this when the user provides an address.")
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    tokenName: z
      .string()
      .min(1)
      .describe("Known token alias/name to resolve to a contract address before onboarding.")
      .optional(),
    confirmed: z.boolean().optional().describe("Set true only after this tool has already returned a confirmation-required message and the user explicitly confirmed in a later message."),
  },
  async ({ confirmed, contractAddress, limit, tokenName }) => {
    if (contractAddress && !tokenName) {
      let needsOnboarding = true;
      try {
        const readiness = await resolveContractReadiness(resolveConfig(), contractAddress);
        needsOnboarding = readiness.state === "needs-link";
      } catch {
        needsOnboarding = true;
      }

      if (needsOnboarding) {
        const confirmation = mutationConfirmationRequired("raw contract holder onboarding", confirmed);
        if (confirmation) {
          return confirmation;
        }
      }
    }

    const responseText =
      contractAddress || tokenName
        ? await getTopHoldersForTokenTarget({
            contractAddress,
            limit: limit ?? 10,
            tokenName,
          })
        : "Tell me the ERC-20 token contract address or a known token name so I can resolve and query the holders.";
    return {
      content: [{ type: "text", text: responseText }],
    };
  },
);

server.tool("evaluate_tasks", {}, async () => {
  const result = await evaluatePendingHolderQueries();
  return {
    content: [{ type: "text", text: result.messages.length > 0 ? result.messages.join("\n\n") : "No pending holder queries completed." }],
  };
});

server.tool("list_tasks", {}, async () => ({
  content: [{ type: "text", text: formatTasks({ tasks: loadState(resolveConfig().stateDir).tasks }) }],
}));

server.tool(
  "get_address_balance",
  {
    address: z.string().min(1),
    contractAddress: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ address, contractAddress, tokenName }) => {
    if (!contractAddress && !tokenName) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address or known token name for that balance lookup and I'll query it directly." }],
      };
    }

    return {
      content: [{
        type: "text",
        text: await getAddressBalanceForTokenTarget({
          address,
          contractAddress,
          tokenName,
        }),
      }],
    };
  },
);

server.tool(
  "get_holder_concentration",
  {
    contractAddress: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, limit, tokenName }) => {
    if (!contractAddress && !tokenName) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address or known token name for that concentration request and I'll query it directly." }],
      };
    }

    return {
      content: [{
        type: "text",
        text: await getHolderConcentrationForTokenTarget({
          contractAddress,
          limit: limit ?? 5,
          tokenName,
        }),
      }],
    };
  },
);

server.tool(
  "create_balance_watch",
  {
    address: z.string().min(1),
    contractAddress: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ address, contractAddress, label, tokenName }) => {
    if (!contractAddress && !tokenName) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address or known token name for that watch and I'll create it." }],
      };
    }

    const result = await saveBalanceWatch(
      address,
      label,
      (
        await requireTokenTarget({
          contractAddress,
          tokenName,
        })
      ).balanceSource,
    );
    return {
      content: [{ type: "text", text: formatSavedWatch(result) }],
    };
  },
);

server.tool("list_balance_watches", {}, async () => {
  const result = listBalanceWatches();
  return {
    content: [{ type: "text", text: formatWatches(result) }],
  };
});

server.tool("evaluate_balance_watches", {}, async () => {
  const result = await evaluateBalanceWatches();
  return {
    content: [{ type: "text", text: formatAlerts(result.state, result.alerts) }],
  };
});

server.tool(
  "ensure_event_webhook",
  "Register or update a generic MultiBaas event webhook URL. This mutates MultiBaas webhook configuration. If confirmation is required, call once without confirmed; only retry with confirmed true after the tool asks for confirmation and the user explicitly agrees in a later message.",
  {
    confirmed: z.boolean().optional().describe("Set true only after this tool has already returned a confirmation-required message and the user explicitly confirmed in a later message."),
    url: z.string().url(),
    label: z.string().min(1).default(DEFAULT_WEBHOOK_LABEL),
  },
  async ({ confirmed, url, label }) => {
    const confirmation = mutationConfirmationRequired("arbitrary webhook registration", confirmed);
    if (confirmation) {
      return confirmation;
    }

    const result = await ensureBalanceWebhook(url, label);
    return {
      content: [{ type: "text", text: `Webhook ready: id=${result.id} label=${result.label} url=${result.url}` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
