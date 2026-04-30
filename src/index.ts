import http from "node:http";
import { randomUUID } from "node:crypto";

import { resolveConfig } from "./config.js";
import {
  ensureEventWebhook,
  executeSavedBalanceQuery,
  fetchBalanceSnapshot,
  getAddressBalance,
  normalizeAddress,
  selectTopPositiveHolders,
  verifyWebhookSignature,
} from "./multibaas.js";
import {
  appendAlerts,
  loadState,
  saveState,
  type AlertRecord,
  type LocalState,
  type Watch,
} from "./state.js";

function printUsage(): void {
  console.log(`Local MultiBaas agent loop

Usage:
  npm run dev -- query top-holders [--limit 20] [--query helloworld_balance]
  npm run dev -- query balance --address 0x... [--query helloworld_balance]
  npm run dev -- watch add --address 0x... [--label whale] [--query helloworld_balance]
  npm run dev -- watch list
  npm run dev -- watch evaluate
  npm run dev -- webhook ensure --url https://example.test/webhooks/multibaas [--label balance-watch]
  npm run dev -- webhook serve [--port 8787] [--path /webhooks/multibaas] [--secret <secret>]
`);
}

function readCommand(args: string[], index: number): string | undefined {
  return args[index];
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function requireFlag(args: string[], name: string): string {
  const value = readFlag(args, name);
  if (!value) {
    throw new Error(`Missing required flag ${name}`);
  }
  return value;
}

function parsePositiveIntegerFlag(args: string[], name: string, fallback: number): number {
  const value = readFlag(args, name);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer for ${name}, received "${value}"`);
  }
  return parsed;
}

function printTopHolders(limit: number, rows: Array<{ address: string; rawBalance: string }>): void {
  console.log(`Top ${limit} holders`);
  console.log("");
  rows.forEach((row, index) => {
    console.log(`${String(index + 1).padStart(2, " ")}. ${row.address}  ${row.rawBalance}`);
  });
}

function printBalance(address: string, balance: string, queryName: string): void {
  console.log(`Query: ${queryName}`);
  console.log(`Address: ${address}`);
  console.log(`Balance: ${balance}`);
}

function createWatchLabel(address: string): string {
  return `watch-${address.slice(0, 10)}`;
}

async function evaluateWatches(
  state: LocalState,
  eventCount: number | undefined,
): Promise<{ alerts: AlertRecord[]; nextState: LocalState }> {
  const config = resolveConfig();
  const nextState: LocalState = {
    ...state,
    watches: [...state.watches],
  };

  const alerts: AlertRecord[] = [];
  const snapshots = new Map<string, Awaited<ReturnType<typeof fetchBalanceSnapshot>>>();

  for (const watch of nextState.watches) {
    let snapshot = snapshots.get(watch.queryName);
    if (!snapshot) {
      snapshot = await fetchBalanceSnapshot(config, watch.queryName, config.scanLimit);
      snapshots.set(watch.queryName, snapshot);
    }

    const current = snapshot.get(normalizeAddress(watch.address));
    const currentBalance = current?.rawBalance ?? "0";

    if (currentBalance === watch.lastKnownBalance) {
      continue;
    }

    alerts.push({
      currentBalance,
      eventCount,
      id: randomUUID(),
      observedAt: new Date().toISOString(),
      previousBalance: watch.lastKnownBalance,
      queryName: watch.queryName,
      watchId: watch.id,
    });

    watch.lastKnownBalance = currentBalance;
    watch.updatedAt = new Date().toISOString();
  }

  return { alerts, nextState };
}

function printAlerts(state: LocalState, alerts: AlertRecord[]): void {
  if (alerts.length === 0) {
    console.log("No balance changes detected.");
    return;
  }

  for (const alert of alerts) {
    const watch = state.watches.find((candidate) => candidate.id === alert.watchId);
    const label = watch?.label ?? alert.watchId;
    const address = watch?.address ?? "unknown";
    const delta = BigInt(alert.currentBalance) - BigInt(alert.previousBalance);
    console.log(
      `[alert] ${label} (${address}) ${alert.previousBalance} -> ${alert.currentBalance} (delta ${delta >= 0n ? "+" : ""}${delta.toString()})`,
    );
  }
}

async function handleQuery(args: string[]): Promise<void> {
  const config = resolveConfig();
  const subcommand = readCommand(args, 1);
  const queryName = readFlag(args, "--query") ?? config.defaultQueryName;

  if (subcommand === "top-holders") {
    const limit = parsePositiveIntegerFlag(args, "--limit", 20);
    const rows = await executeSavedBalanceQuery(config, queryName, Math.min(limit, 100));
    printTopHolders(limit, selectTopPositiveHolders(rows, limit));
    return;
  }

  if (subcommand === "balance") {
    const address = requireFlag(args, "--address");
    const balance = await getAddressBalance(config, queryName, address);
    printBalance(balance.address, balance.rawBalance, queryName);
    return;
  }

  throw new Error(`Unknown query command: ${subcommand ?? "(missing)"}`);
}

async function handleWatch(args: string[]): Promise<void> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const subcommand = readCommand(args, 1);

  if (subcommand === "list") {
    if (state.watches.length === 0) {
      console.log("No watches registered.");
      return;
    }

    state.watches.forEach((watch) => {
      console.log(`${watch.id}  ${watch.label}  ${watch.address}  ${watch.lastKnownBalance}`);
    });
    return;
  }

  if (subcommand === "add") {
    const address = normalizeAddress(requireFlag(args, "--address"));
    const queryName = readFlag(args, "--query") ?? config.defaultQueryName;
    const label = readFlag(args, "--label") ?? createWatchLabel(address);
    const snapshot = await getAddressBalance(config, queryName, address);
    const existing = state.watches.find(
      (watch) => normalizeAddress(watch.address) === address && watch.queryName === queryName,
    );

    const now = new Date().toISOString();
    const watch: Watch = existing
      ? {
          ...existing,
          label,
          lastKnownBalance: snapshot.rawBalance,
          updatedAt: now,
        }
      : {
          address,
          createdAt: now,
          id: randomUUID(),
          label,
          lastKnownBalance: snapshot.rawBalance,
          queryName,
          updatedAt: now,
        };

    const nextState: LocalState = {
      ...state,
      watches: existing
        ? state.watches.map((candidate) => (candidate.id === existing.id ? watch : candidate))
        : [...state.watches, watch],
    };
    saveState(config.stateDir, nextState);
    console.log(`Saved watch ${watch.label} for ${watch.address} at balance ${watch.lastKnownBalance}`);
    return;
  }

  if (subcommand === "evaluate") {
    const { alerts, nextState } = await evaluateWatches(state, undefined);
    saveState(config.stateDir, nextState);
    appendAlerts(config.stateDir, alerts);
    printAlerts(nextState, alerts);
    return;
  }

  throw new Error(`Unknown watch command: ${subcommand ?? "(missing)"}`);
}

async function handleWebhook(args: string[]): Promise<void> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const subcommand = readCommand(args, 1);

  if (subcommand === "ensure") {
    const url = requireFlag(args, "--url");
    const label = readFlag(args, "--label") ?? "balance-watch";
    const webhook = await ensureEventWebhook(config, label, url);
    const nextState: LocalState = {
      ...state,
      webhook: {
        id: webhook.id,
        label: webhook.label,
        secret: webhook.secret ?? state.webhook?.secret,
        subscriptions: webhook.subscriptions,
        updatedAt: new Date().toISOString(),
        url: webhook.url,
      },
    };
    saveState(config.stateDir, nextState);
    console.log(`Webhook ready: id=${webhook.id} label=${webhook.label} url=${webhook.url}`);
    if (webhook.secret) {
      console.log("Stored webhook signing secret in local state.");
    }
    return;
  }

  if (subcommand === "serve") {
    const port = parsePositiveIntegerFlag(args, "--port", 8787);
    const requestPath = readFlag(args, "--path") ?? "/webhooks/multibaas";
    const secret = readFlag(args, "--secret") ?? state.webhook?.secret ?? process.env.MULTIBAAS_WEBHOOK_SECRET;

    if (!secret) {
      throw new Error(
        "Missing webhook secret. Run `npm run dev -- webhook ensure --url ...` first, or pass --secret / MULTIBAAS_WEBHOOK_SECRET.",
      );
    }

    const server = http.createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== requestPath) {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);

      const timestamp = request.headers["x-multibaas-timestamp"];
      const signature = request.headers["x-multibaas-signature"];

      const timestampValue = Array.isArray(timestamp) ? timestamp[0] : timestamp;
      const signatureValue = Array.isArray(signature) ? signature[0] : signature;

      if (!verifyWebhookSignature(body, timestampValue, signatureValue, secret)) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }

      let events: unknown[] = [];
      try {
        const parsed = JSON.parse(body.toString("utf8")) as unknown;
        if (Array.isArray(parsed)) {
          events = parsed;
        }
      } catch (error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: `Invalid JSON: ${String(error)}` }));
        return;
      }

      const latestState = loadState(config.stateDir);
      const { alerts, nextState } = await evaluateWatches(latestState, events.length);
      saveState(config.stateDir, nextState);
      appendAlerts(config.stateDir, alerts);
      printAlerts(nextState, alerts);

      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ alerts: alerts.length, received: events.length }));
    });

    server.listen(port, "0.0.0.0", () => {
      console.log(`Listening for MultiBaas webhooks on http://0.0.0.0:${port}${requestPath}`);
    });

    return;
  }

  throw new Error(`Unknown webhook command: ${subcommand ?? "(missing)"}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "query") {
    await handleQuery(args);
    return;
  }

  if (command === "watch") {
    await handleWatch(args);
    return;
  }

  if (command === "webhook") {
    await handleWebhook(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
