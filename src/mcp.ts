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
  formatEventCapabilityInspection,
  formatEventInvestigation,
  inspectEventCapabilities,
  runEventInvestigation,
} from "./event-intelligence-service.js";
import { formatTokenControlEvents, getTokenControlEvents } from "./event-view-service.js";
import { evaluatePendingHolderQueries, getTopHoldersForTokenTarget } from "./holder-query-service.js";
import { formatTokenInvestigation, investigateToken } from "./investigation-service.js";
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
  name: "multibaas-protocol-intelligence-runtime",
  version: "0.1.0",
});

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
  "Use this for the KelpDAO / rsETH frozen-ETH Arbitrum governance incident demo. It returns the incident brief, decoded live event evidence, proposal-status verdict, or monitor plan without requiring the agent to author raw event-query JSON.",
  {
    focus: z.enum(ARBITRUM_GOVERNANCE_INCIDENT_FOCUS_VALUES).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ focus, limit }) => arbitrumGovernanceIncidentToolContent({ focus, limit }),
);

server.tool(
  "get_arbitrum_frozen_eth_governance_brief",
  "Mandatory for opening demo prompts like: Arbitrum froze funds from the KelpDAO exploit; give me the onchain governance brief, what contracts to inspect, and what can happen next. Returns the live MultiBaas-backed brief.",
  {
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ limit }) => arbitrumGovernanceIncidentToolContent({ focus: "brief", limit }),
);

server.tool(
  "get_arbitrum_frozen_eth_monitor_plan",
  "Mandatory for demo prompts like: let me know when the frozen-ETH release proposal reaches onchain governance. Returns a user-facing acknowledgement plus the actionable Core Governor ProposalCreated monitor target, filters, current verdict, and follow-up analysis. The final response must include those details, not only a one-sentence acknowledgement.",
  {
    limit: z.number().int().min(1).max(20).optional(),
  },
  async ({ limit }) => arbitrumGovernanceIncidentMonitorToolContent({ limit }),
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
  {
    contractAddress: z.string().min(1),
  },
  async ({ contractAddress }) => ({
    content: [{
      type: "text",
      text: formatContractAddressInvestigationResult(await investigateContractAddress(contractAddress)),
    }],
  }),
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
  {
    candidateIndex: z.number().int().min(0),
    contractAddress: z.string().min(1),
    contractLabel: z.string().min(1).optional(),
    startingBlock: z.string().min(1).optional(),
  },
  async ({ candidateIndex, contractAddress, contractLabel, startingBlock }) => ({
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
  }),
);

server.tool(
  "inspect_contract_interfaces",
  {
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
  {
    contractAddress: z.string().min(1).optional(),
    interfaceLabel: z.string().min(1),
    startingBlock: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, interfaceLabel, startingBlock, tokenName }) => {
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
  },
  async ({ contractAddress, limit, tokenName }) => {
    const responseText =
      contractAddress || tokenName
        ? await getTopHoldersForTokenTarget({
            contractAddress,
            limit: limit ?? 20,
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
  {
    url: z.string().url(),
    label: z.string().min(1).default(DEFAULT_WEBHOOK_LABEL),
  },
  async ({ url, label }) => {
    const result = await ensureBalanceWebhook(url, label);
    return {
      content: [{ type: "text", text: `Webhook ready: id=${result.id} label=${result.label} url=${result.url}` }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
