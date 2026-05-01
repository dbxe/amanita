import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { resolveConfig } from "./config.js";
import { evaluatePendingHolderQueries, requestTopHolders } from "./holder-query-service.js";
import { handleIntent } from "./intent.js";
import {
  createContractBalanceSource,
  getErc20Metadata,
  resolveContractReadiness,
  resolveKnownAddress,
} from "./multibaas.js";
import { loadState } from "./state.js";
import { formatAlerts, formatSavedWatch, formatTasks, formatWatches } from "./task-formatting.js";
import { DEFAULT_WEBHOOK_LABEL, ensureBalanceWebhook } from "./webhook-service.js";
import { evaluateBalanceWatches, listBalanceWatches, saveBalanceWatch } from "./watch-service.js";
import {
  formatAnalyticalViewResult,
  getContractHolderConcentration,
  getHolderConcentration,
  lookupBalance,
} from "./views.js";

const server = new McpServer({
  name: "multibaas-protocol-intelligence-runtime",
  version: "0.1.0",
});

server.tool(
  "handle_multibaas_request",
  {
    text: z
      .string()
      .min(1)
      .describe("Compatibility tool for legacy holder/balance/watch phrasing. Prefer typed capability tools when the request maps cleanly to them."),
  },
  async ({ text }) => {
    return {
      content: [{ type: "text", text: await handleIntent(text) }],
    };
  },
);

async function resolveContractTargetInput(contractAddress?: string, tokenName?: string): Promise<{
  address?: string;
  alias?: string;
  tokenNameInput?: string;
  unresolved?: boolean;
}> {
  if (contractAddress) {
    return { address: contractAddress };
  }

  if (!tokenName) {
    return {};
  }

  const resolved = await resolveKnownAddress(resolveConfig(), tokenName);
  if (!resolved) {
    return { tokenNameInput: tokenName, unresolved: true };
  }

  return {
    address: resolved.address,
    alias: resolved.alias,
    tokenNameInput: tokenName,
  };
}

server.tool(
  "resolve_contract_target",
  {
    contractAddress: z.string().min(1).optional(),
    tokenName: z.string().min(1).optional(),
  },
  async ({ contractAddress, tokenName }) => {
    const target = await resolveContractTargetInput(contractAddress, tokenName);
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
    const target = await resolveContractTargetInput(contractAddress, tokenName);
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
    const text = contractAddress
      ? `Give me the top ${limit ?? 20} holders for token ${contractAddress}`
      : tokenName
        ? `Give me the top ${limit ?? 20} holders for token ${tokenName}`
        : "";
    const responseText =
      contractAddress || tokenName
        ? (
            await requestTopHolders({
              contractAddress,
              limit: limit ?? 20,
              rawText: text,
              tokenName,
            })
          ).responseText
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
    queryName: z.string().min(1).optional(),
  },
  async ({ address, contractAddress, queryName }) => {
    if (!queryName && !contractAddress) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address for that balance lookup and I'll query it directly." }],
      };
    }

    const result = await lookupBalance(address, queryName ?? createContractBalanceSource(contractAddress!));
    return {
      content: [{ type: "text", text: formatAnalyticalViewResult(result) }],
    };
  },
);

server.tool(
  "get_holder_concentration",
  {
    contractAddress: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    queryName: z.string().min(1).optional(),
  },
  async ({ contractAddress, limit, queryName }) => {
    if (!contractAddress && !queryName) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address for that concentration request and I'll query it directly." }],
      };
    }

    const result = contractAddress
      ? await getContractHolderConcentration(contractAddress, limit ?? 5, queryName)
      : await getHolderConcentration(limit ?? 5, queryName);
    return {
      content: [{ type: "text", text: formatAnalyticalViewResult(result) }],
    };
  },
);

server.tool(
  "create_balance_watch",
  {
    address: z.string().min(1),
    contractAddress: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    queryName: z.string().min(1).optional(),
  },
  async ({ address, contractAddress, label, queryName }) => {
    if (!queryName && !contractAddress) {
      return {
        content: [{ type: "text", text: "Tell me the token contract address for that watch and I'll create it." }],
      };
    }

    const result = await saveBalanceWatch(address, label, queryName ?? createContractBalanceSource(contractAddress!));
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

server.tool("list_tasks", {}, async () => {
  return {
    content: [{ type: "text", text: formatTasks({ tasks: loadState(resolveConfig().stateDir).tasks }) }],
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
