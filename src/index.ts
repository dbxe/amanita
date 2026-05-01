import {
  formatContractAddressInvestigationResult,
  formatContractLookupResult,
  formatImportContractLookupCandidateResult,
  investigateContractAddress,
  importContractLookupCandidateForAddress,
  lookupContractCandidatesForAddress,
} from "./contract-lookup-service.js";
import {
  ensureContractInterfaceLink,
  formatContractInterfaceInspection,
  formatPreloadedInterfaceStatuses,
  getPreloadedInterfaceCatalogStatus,
  inspectContractInterfaces,
  preloadKnownInterfaces,
} from "./contract-interface-service.js";
import { listConfiguredBackends, resolveConfig } from "./config.js";
import { formatTokenControlEvents, getTokenControlEvents } from "./event-view-service.js";
import {
  formatEventCapabilityInspection,
  formatEventInvestigation,
  inspectEventCapabilities,
  runEventInvestigation,
} from "./event-intelligence-service.js";
import { evaluatePendingHolderQueries, requestTopHolders } from "./holder-query-service.js";
import { formatTokenInvestigation, investigateToken } from "./investigation-service.js";
import { formatConfiguredBackends, formatMultichainInspection, inspectTargetsAcrossBackends, type MultichainTargetInput } from "./multichain-service.js";
import { getAddressBalanceForTokenTarget, getHolderConcentrationForTokenTarget } from "./query-service.js";
import { sendNanoClawNotification } from "./nanoclaw-host.js";
import { configureNanoClawGroup } from "./nanoclaw.js";
import { createContractBalanceSource, getLatestBlockNumber } from "./multibaas.js";
import { loadState } from "./state.js";
import { formatAlerts, formatSavedWatch, formatTasks, formatWebhook, formatWatches } from "./task-formatting.js";
import {
  DEFAULT_WEBHOOK_LABEL,
  DEFAULT_WEBHOOK_PATH,
  DEFAULT_WEBHOOK_PORT,
  deriveDefaultWebhookUrl,
  ensureBalanceWebhook,
  startWebhookServer,
} from "./webhook-service.js";
import { evaluateBalanceWatches, listBalanceWatches, saveBalanceWatch } from "./watch-service.js";
import {
  formatAnalyticalViewResult,
  getTopHolders,
  getHolderConcentration,
  lookupBalance,
} from "./views.js";

function printUsage(): void {
  console.log(`Local MultiBaas agent loop

Usage:
  npm run dev -- query top-holders [--limit 20] [--query <saved-query>] [--contract 0x...]
  npm run dev -- query concentration [--limit 5] [--query <saved-query>] [--contract 0x...]
  npm run dev -- query balance --address 0x... [--query <saved-query> | --contract 0x...]
  npm run dev -- query controls [--contract 0x... | --token <name>] [--limit 20]
  npm run dev -- query event-capabilities [--contract 0x... | --token <name>]
  npm run dev -- query event-investigation --lead <lead-id> [--contract 0x... | --token <name>] [--limit 10]
  npm run dev -- query investigate [--contract 0x... | --token <name>] [--limit 5]
  npm run dev -- query multichain-inspect --targets mainnet-remote:0x...,arbitrum-one-remote:0x...
  npm run dev -- backend list
  npm run dev -- contract list-interfaces
  npm run dev -- contract latest-block
  npm run dev -- contract investigate --contract 0x...
  npm run dev -- contract lookup --contract 0x...
  npm run dev -- contract import-lookup --contract 0x... --candidate 0 [--label fiattokenv1] [--starting-block 0]
  npm run dev -- contract preload-interfaces [--labels erc20interface,fiattokenv2interface]
  npm run dev -- contract inspect --contract 0x...
  npm run dev -- contract ensure-interface --contract 0x... --label erc20interface [--starting-block 0]
  npm run dev -- watch add --address 0x... [--label whale] [--query <saved-query> | --contract 0x...]
  npm run dev -- watch list
  npm run dev -- watch evaluate
  npm run dev -- task list
  npm run dev -- task evaluate
  npm run dev -- webhook ensure [--url https://example.test/webhooks/multibaas] [--port ${DEFAULT_WEBHOOK_PORT}] [--path ${DEFAULT_WEBHOOK_PATH}] [--label ${DEFAULT_WEBHOOK_LABEL}]
  npm run dev -- webhook serve [--port ${DEFAULT_WEBHOOK_PORT}] [--path ${DEFAULT_WEBHOOK_PATH}] [--secret <secret>] [--nanoclaw-dir <path>] [--group-folder <folder>]
  npm run dev -- nanoclaw configure --nanoclaw-dir ~/git/dbxe/nanoclaw --group-folder cli-with-<name> [--write-allowlist]
  npm run dev -- nanoclaw notify --nanoclaw-dir ~/git/dbxe/nanoclaw [--group-folder dm-with-<name> | --agent-group-id ag-...] --text "test alert"
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

function parseMultichainTargets(value: string): MultichainTargetInput[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [left, contractAddress] = entry.split(":");
      if (!left || !contractAddress) {
        throw new Error(`Expected multichain target entries in the form profile:0x... or role@profile:0x..., received "${entry}"`);
      }

      const [role, profileName] = left.includes("@")
        ? left.split("@")
        : [undefined, left];
      if (!profileName?.trim() || !contractAddress.trim()) {
        throw new Error(`Expected multichain target entries in the form profile:0x... or role@profile:0x..., received "${entry}"`);
      }

      return {
        contractAddress: contractAddress.trim(),
        profileName: profileName.trim(),
        role: role?.trim() || undefined,
      };
    });
}

async function handleQuery(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);
  const queryName = readFlag(args, "--query");
  const contractAddress = readFlag(args, "--contract");
  const tokenName = readFlag(args, "--token");

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
      contractAddress
        ? await getHolderConcentrationForTokenTarget({ contractAddress, limit, tokenName })
        : formatAnalyticalViewResult(await getHolderConcentration(limit, queryName)),
    );
    return;
  }

  if (subcommand === "balance") {
    const address = requireFlag(args, "--address");
    console.log(
      contractAddress || tokenName
        ? await getAddressBalanceForTokenTarget({ address, contractAddress, tokenName })
        : formatAnalyticalViewResult(await lookupBalance(address, queryName)),
    );
    return;
  }

  if (subcommand === "controls") {
    const limit = parsePositiveIntegerFlag(args, "--limit", 20);
    console.log(
      formatTokenControlEvents(
        await getTokenControlEvents({
          contractAddress,
          limit,
          tokenName,
        }),
      ),
    );
    return;
  }

  if (subcommand === "investigate") {
    const limit = parsePositiveIntegerFlag(args, "--limit", 5);
    console.log(
      formatTokenInvestigation(
        await investigateToken({
          contractAddress,
          limit,
          tokenName,
        }),
      ),
    );
    return;
  }

  if (subcommand === "event-capabilities") {
    console.log(
      formatEventCapabilityInspection(
        await inspectEventCapabilities({
          contractAddress,
          tokenName,
        }),
      ),
    );
    return;
  }

  if (subcommand === "event-investigation") {
    const leadId = requireFlag(args, "--lead");
    const limit = parsePositiveIntegerFlag(args, "--limit", 10);
    console.log(
      formatEventInvestigation(
        await runEventInvestigation({
          contractAddress,
          leadId: leadId as Parameters<typeof runEventInvestigation>[0]["leadId"],
          limit,
          tokenName,
        }),
      ),
    );
    return;
  }

  if (subcommand === "multichain-inspect") {
    const targets = parseMultichainTargets(requireFlag(args, "--targets"));
    console.log(formatMultichainInspection(await inspectTargetsAcrossBackends(targets)));
    return;
  }

  throw new Error(`Unknown query command: ${subcommand ?? "(missing)"}`);
}

async function handleBackend(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);

  if (subcommand === "list") {
    console.log(formatConfiguredBackends(listConfiguredBackends()));
    return;
  }

  throw new Error(`Unknown backend command: ${subcommand ?? "(missing)"}`);
}

async function handleContract(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);

  if (subcommand === "list-interfaces") {
    console.log(formatPreloadedInterfaceStatuses(await getPreloadedInterfaceCatalogStatus()));
    return;
  }

  if (subcommand === "latest-block") {
    console.log(await getLatestBlockNumber(resolveConfig()));
    return;
  }

  if (subcommand === "lookup") {
    const contractAddress = requireFlag(args, "--contract");
    console.log(formatContractLookupResult(await lookupContractCandidatesForAddress(contractAddress)));
    return;
  }

  if (subcommand === "investigate") {
    const contractAddress = requireFlag(args, "--contract");
    console.log(formatContractAddressInvestigationResult(await investigateContractAddress(contractAddress)));
    return;
  }

  if (subcommand === "import-lookup") {
    const contractAddress = requireFlag(args, "--contract");
    const candidateIndex = Number.parseInt(requireFlag(args, "--candidate"), 10);
    if (!Number.isInteger(candidateIndex) || candidateIndex < 0) {
      throw new Error(`Expected a non-negative integer for --candidate, received "${readFlag(args, "--candidate")}"`);
    }

    console.log(
      formatImportContractLookupCandidateResult(
        await importContractLookupCandidateForAddress({
          address: contractAddress,
          candidateIndex,
          contractLabel: readFlag(args, "--label"),
          startingBlock: readFlag(args, "--starting-block"),
        }),
      ),
    );
    return;
  }

  if (subcommand === "preload-interfaces") {
    const labels = readFlag(args, "--labels")?.split(",").map((value) => value.trim()).filter(Boolean);
    console.log(formatPreloadedInterfaceStatuses(await preloadKnownInterfaces(labels)));
    return;
  }

  if (subcommand === "inspect") {
    const contractAddress = requireFlag(args, "--contract");
    console.log(formatContractInterfaceInspection(await inspectContractInterfaces(contractAddress)));
    return;
  }

  if (subcommand === "ensure-interface") {
    const contractAddress = requireFlag(args, "--contract");
    const label = requireFlag(args, "--label");
    const startingBlock = readFlag(args, "--starting-block");
    console.log(
      formatContractInterfaceInspection(
        await ensureContractInterfaceLink({
          addressOrAlias: contractAddress,
          label,
          startingBlock,
        }),
      ),
    );
    return;
  }

  throw new Error(`Unknown contract command: ${subcommand ?? "(missing)"}`);
}

async function handleWatch(args: string[]): Promise<void> {
  const subcommand = readCommand(args, 1);

  if (subcommand === "list") {
    console.log(formatWatches(listBalanceWatches()));
    return;
  }

  if (subcommand === "add") {
    const address = requireFlag(args, "--address");
    const contractAddress = readFlag(args, "--contract");
    const queryName = readFlag(args, "--query");
    const label = readFlag(args, "--label");
    console.log(
      formatSavedWatch(
        await saveBalanceWatch(address, label, contractAddress ? createContractBalanceSource(contractAddress) : queryName),
      ),
    );
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
    const port = parsePositiveIntegerFlag(args, "--port", DEFAULT_WEBHOOK_PORT);
    const requestPath = readFlag(args, "--path") ?? DEFAULT_WEBHOOK_PATH;
    const config = resolveConfig();
    const url =
      readFlag(args, "--url")
      ?? deriveDefaultWebhookUrl(config.baseUrl, {
        port,
        requestPath,
      });

    if (!url) {
      throw new Error(
        "Missing webhook callback URL. Pass --url explicitly, or set MULTIBAAS_WEBHOOK_PUBLIC_URL for non-local MultiBaas backends.",
      );
    }
    const label = readFlag(args, "--label") ?? DEFAULT_WEBHOOK_LABEL;
    console.log(formatWebhook(await ensureBalanceWebhook(url, label)));
    return;
  }

  if (subcommand === "serve") {
    const port = parsePositiveIntegerFlag(args, "--port", DEFAULT_WEBHOOK_PORT);
    const requestPath = readFlag(args, "--path") ?? DEFAULT_WEBHOOK_PATH;
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
    console.log(formatTasks({ tasks: loadState(resolveConfig().stateDir).tasks }));
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

  if (command === "contract") {
    await handleContract(args);
    return;
  }

  if (command === "backend") {
    await handleBackend(args);
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
