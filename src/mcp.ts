import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  DEFAULT_WEBHOOK_LABEL,
  ensureBalanceWebhook,
  evaluateBalanceWatches,
  formatAlerts,
  formatBalance,
  formatSavedWatch,
  formatTasks,
  formatTopHolders,
  formatWatches,
  getTopHolders,
  listTasks,
  listBalanceWatches,
  lookupBalance,
  saveBalanceWatch,
} from "./agent-tools.js";

const server = new McpServer({
  name: "multibaas-agent-harness",
  version: "0.1.0",
});

server.tool(
  "get_top_holders",
  {
    limit: z.number().int().min(1).max(100).optional(),
    queryName: z.string().min(1).optional(),
  },
  async ({ limit, queryName }) => {
    const result = await getTopHolders(limit ?? 20, queryName);
    return {
      content: [{ type: "text", text: formatTopHolders(result) }],
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
      content: [{ type: "text", text: formatBalance(result) }],
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
