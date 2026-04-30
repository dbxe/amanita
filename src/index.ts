import {
  DEFAULT_WEBHOOK_LABEL,
  ensureBalanceWebhook,
  evaluatePendingHolderQueries,
  evaluateBalanceWatches,
  formatAlerts,
  formatSavedWatch,
  formatTasks,
  formatWebhook,
  formatWatches,
  listTasks,
  listBalanceWatches,
  requestTopHolders,
  saveBalanceWatch,
  startWebhookServer,
} from "./agent-tools.js";
import { handleIntent } from "./intent.js";
import { sendNanoClawNotification } from "./nanoclaw-host.js";
import { configureNanoClawGroup } from "./nanoclaw.js";
import {
  formatAnalyticalViewResult,
  getContractHolderConcentration,
  getHolderConcentration,
  getTopHolders,
  lookupBalance,
} from "./views.js";

function printUsage(): void {
  console.log(`Local MultiBaas agent loop

Usage:
  npm run dev -- query top-holders [--limit 20] [--query helloworld_balance] [--contract 0x...]
  npm run dev -- query concentration [--limit 5] [--query helloworld_balance] [--contract 0x...]
  npm run dev -- query balance --address 0x... [--query helloworld_balance]
  npm run dev -- watch add --address 0x... [--label whale] [--query helloworld_balance]
  npm run dev -- watch list
  npm run dev -- watch evaluate
  npm run dev -- task list
  npm run dev -- task evaluate
  npm run dev -- webhook ensure --url https://example.test/webhooks/multibaas [--label ${DEFAULT_WEBHOOK_LABEL}]
  npm run dev -- webhook serve [--port 8787] [--path /webhooks/multibaas] [--secret <secret>] [--nanoclaw-dir <path>] [--group-folder <folder>]
  npm run dev -- agent "<natural language intent>"
  npm run dev -- nanoclaw configure --nanoclaw-dir ~/git/qwibitai/nanoclaw --group-folder cli-with-<name> [--write-allowlist]
  npm run dev -- nanoclaw notify --nanoclaw-dir ~/git/qwibitai/nanoclaw [--group-folder dm-with-<name> | --agent-group-id ag-...] --text "test alert"
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

async function handleQuery(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);
  const queryName = readFlag(args, "--query");
  const contractAddress = readFlag(args, "--contract");

  if (subcommand === "top-holders") {
    const limit = parsePositiveIntegerFlag(args, "--limit", 20);
    console.log(
      contractAddress
        ? (
            await requestTopHolders({
              contractAddress,
              limit,
              rawText: `Give me the top ${limit} holders for token ${contractAddress}`,
            })
          ).responseText
        : formatAnalyticalViewResult(await getTopHolders(limit, queryName)),
    );
    return;
  }

  if (subcommand === "concentration") {
    const limit = parsePositiveIntegerFlag(args, "--limit", 5);
    console.log(
      formatAnalyticalViewResult(
        contractAddress
          ? await getContractHolderConcentration(contractAddress, limit, queryName)
          : await getHolderConcentration(limit, queryName),
      ),
    );
    return;
  }

  if (subcommand === "balance") {
    const address = requireFlag(args, "--address");
    console.log(formatAnalyticalViewResult(await lookupBalance(address, queryName)));
    return;
  }

  throw new Error(`Unknown query command: ${subcommand ?? "(missing)"}`);
}

async function handleWatch(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);

  if (subcommand === "list") {
    console.log(formatWatches(listBalanceWatches()));
    return;
  }

  if (subcommand === "add") {
    const address = requireFlag(args, "--address");
    const queryName = readFlag(args, "--query");
    const label = readFlag(args, "--label");
    console.log(formatSavedWatch(await saveBalanceWatch(address, label, queryName)));
    return;
  }

  if (subcommand === "evaluate") {
    const result = await evaluateBalanceWatches();
    console.log(formatAlerts(result.state, result.alerts));
    return;
  }

  throw new Error(`Unknown watch command: ${subcommand ?? "(missing)"}`);
}

async function handleWebhook(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);

  if (subcommand === "ensure") {
    const url = requireFlag(args, "--url");
    const label = readFlag(args, "--label") ?? DEFAULT_WEBHOOK_LABEL;
    console.log(formatWebhook(await ensureBalanceWebhook(url, label)));
    return;
  }

  if (subcommand === "serve") {
    const port = parsePositiveIntegerFlag(args, "--port", 8787);
    const requestPath = readFlag(args, "--path") ?? "/webhooks/multibaas";
    const secret = readFlag(args, "--secret");
    const nanoclawDir = readFlag(args, "--nanoclaw-dir");
    const groupFolder = readFlag(args, "--group-folder");
    const agentGroupId = readFlag(args, "--agent-group-id");
    const sessionId = readFlag(args, "--session-id");
    await startWebhookServer({
      nanoclawTarget:
        nanoclawDir && (groupFolder || agentGroupId || sessionId)
          ? {
              agentGroupId,
              groupFolder,
              nanoclawDir,
              sessionId,
            }
          : undefined,
      port,
      requestPath,
      secret,
    });
    console.log(`Listening for MultiBaas webhooks on http://0.0.0.0:${port}${requestPath}`);
    return;
  }

  throw new Error(`Unknown webhook command: ${subcommand ?? "(missing)"}`);
}

async function handleTask(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);

  if (subcommand === "list") {
    console.log(formatTasks(listTasks()));
    return;
  }

  if (subcommand === "evaluate") {
    const result = await evaluatePendingHolderQueries();
    console.log(result.messages.length > 0 ? result.messages.join("\n\n") : "No pending holder queries completed.");
    return;
  }

  throw new Error(`Unknown task command: ${subcommand ?? "(missing)"}`);
}

async function handleNanoClaw(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);

  if (subcommand === "configure") {
    const nanoclawDir = requireFlag(args, "--nanoclaw-dir");
    const groupFolder = requireFlag(args, "--group-folder");
    const writeAllowlist = args.includes("--write-allowlist");
    const result = configureNanoClawGroup({
      groupFolder,
      nanoclawDir,
      writeAllowlist,
    });

    console.log(`Updated ${result.containerConfigPath}`);
    console.log(`Configured MCP server "${result.serverName}" at ${result.mountPath}`);
    console.log(`Container MultiBaas base URL: ${result.containerBaseUrl}`);
    if (result.allowlistPath) {
      console.log(`Updated mount allowlist: ${result.allowlistPath}`);
    }
    return;
  }

  if (subcommand === "notify") {
    const nanoclawDir = requireFlag(args, "--nanoclaw-dir");
    const text = requireFlag(args, "--text");
    const groupFolder = readFlag(args, "--group-folder");
    const agentGroupId = readFlag(args, "--agent-group-id");
    const sessionId = readFlag(args, "--session-id");
    const result = sendNanoClawNotification(
      {
        agentGroupId,
        groupFolder,
        nanoclawDir,
        sessionId,
      },
      text,
    );

    console.log(`Queued NanoClaw notification ${result.messageId}`);
    console.log(`Target session: ${result.sessionId}`);
    console.log(`Target route: ${result.channelType} ${result.platformId}`);
    return;
  }

  throw new Error(`Unknown NanoClaw command: ${subcommand ?? "(missing)"}`);
}

async function handleAgent(args: string[]): Promise<void> {
  const text = args.slice(1).join(" ").trim();
  if (!text) {
    throw new Error('Missing intent text. Example: npm run dev -- agent "Give me the top 5 holders"');
  }

  console.log(await handleIntent(text));
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

  if (command === "task") {
    await handleTask(args);
    return;
  }

  if (command === "agent") {
    await handleAgent(args);
    return;
  }

  if (command === "nanoclaw") {
    await handleNanoClaw(args);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
