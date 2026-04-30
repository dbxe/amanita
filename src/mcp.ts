import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  DEFAULT_WEBHOOK_LABEL,
  ensureBalanceWebhook,
  evaluateBalanceWatches,
  formatAlerts,
  formatSavedWatch,
  formatTasks,
  formatWatches,
  listTasks,
  listBalanceWatches,
  saveBalanceWatch,
} from "./agent-tools.js";
import {
  formatAnalyticalViewResult,
  getContractHolderConcentration,
  getContractTopHolders,
  getHolderConcentration,
  getTopHolders,
  lookupBalance,
} from "./views.js";

const server = new McpServer({
  name: "multibaas-agent-harness",
  version: "0.1.0",
});

server.tool(
  "get_top_holders",
  {
    contractAddress: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    queryName: z.string().min(1).optional(),
  },
  async ({ contractAddress, limit, queryName }) => {
    const result = contractAddress
      ? await getContractTopHolders(contractAddress, limit ?? 20, queryName)
      : await getTopHolders(limit ?? 20, queryName);
    return {
      content: [{ type: "text", text: formatAnalyticalViewResult(result) }],
    };
  },
);

server.tool(
  "get_address_balance",
  {
    address: z.string().min(1),
    queryName: z.string().min(1).optional(),
  },
  async ({ address, queryName }) => {
    const result = await lookupBalance(address, queryName);
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
    label: z.string().min(1).optional(),
    queryName: z.string().min(1).optional(),
  },
  async ({ address, label, queryName }) => {
    const result = await saveBalanceWatch(address, label, queryName);
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
  const result = listTasks();
  return {
    content: [{ type: "text", text: formatTasks(result) }],
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
