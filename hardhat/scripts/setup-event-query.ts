/**
 * Register a named event query on MultiBaas.
 *
 * Usage:
 *   hardhat run scripts/setup-event-query.ts
 *
 * The query name is read from the QUERY_NAME env var (defaults to "helloworld_balance").
 * The query body is read from the QUERY_BODY env var (JSON string),
 * or from the QUERY_FILE env var pointing to a JSON file.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const networkName = process.env.HARDHAT_NETWORK ?? "development";
const configPath = path.resolve(__dirname, `../deployment-config.${networkName}.ts`);

const { deploymentConfig } = (await import(pathToFileURL(configPath).href)) as {
  deploymentConfig: {
    deploymentEndpoint: string;
    adminApiKey: string;
  };
};

const QUERY_NAME = process.env.QUERY_NAME || "helloworld_balance";

// Default query body (helloworld_balance: net balance per address for helloworld contract)
const defaultQueryBody = {
  order: "DESC" as const,
  groupBy: "address",
  orderBy: "balance",
  events: [
    {
      eventName: "Transfer(address,address,uint256)",
      select: [
        {
          name: "to",
          type: "input" as const,
          alias: "address",
          inputIndex: 1,
        },
        {
          name: "tokens",
          type: "input" as const,
          alias: "balance",
          aggregator: "add" as const,
          inputIndex: 2,
        },
      ],
      filter: {
        rule: "and",
        children: [
          {
            value: "helloworld",
            operator: "Equal",
            fieldType: "contract_address_alias",
          },
        ],
      },
    },
    {
      eventName: "Transfer(address,address,uint256)",
      select: [
        {
          name: "from",
          type: "input" as const,
          alias: "address",
          inputIndex: 0,
        },
        {
          name: "tokens",
          type: "input" as const,
          alias: "balance",
          aggregator: "add" as const,
          inputIndex: 2,
        },
      ],
      filter: {
        rule: "and",
        children: [
          {
            value: "helloworld",
            operator: "Equal",
            fieldType: "contract_address_alias",
          },
        ],
      },
    },
  ],
};

async function main() {
  // Resolve query body from env var, file path, or use default
  let queryBody: unknown;

  if (process.env.QUERY_FILE) {
    const fs = await import("node:fs");
    queryBody = JSON.parse(fs.readFileSync(process.env.QUERY_FILE, "utf-8"));
  } else if (process.env.QUERY_BODY) {
    queryBody = JSON.parse(process.env.QUERY_BODY);
  } else {
    queryBody = defaultQueryBody;
  }

  const baseUrl = deploymentConfig.deploymentEndpoint;
  const apiKey = deploymentConfig.adminApiKey;
  const url = `${baseUrl}/api/v0/queries/${encodeURIComponent(QUERY_NAME)}`;

  console.log(`Registering event query: ${QUERY_NAME}`);
  console.log(`Target: ${url}`);
  console.log(`Query body:`, JSON.stringify(queryBody, null, 2));

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(queryBody),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`HTTP ${response.status}: ${body}`);
    process.exit(1);
  }

  const result = await response.json();
  console.log("\n✅ Event query registered successfully:");
  console.log(JSON.stringify(result, null, 2));

  // Print the execute URL for quick testing
  console.log(`\nExecute with: GET ${baseUrl}/api/v0/queries/${QUERY_NAME}/results`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
