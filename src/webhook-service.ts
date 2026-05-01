import http from "node:http";

import type { NanoClawNotificationTarget } from "./nanoclaw-host.js";
import { sendNanoClawNotification } from "./nanoclaw-host.js";
import { resolveConfig } from "./config.js";
import { ensureEventWebhook, verifyWebhookSignature } from "./multibaas.js";
import { loadState, saveState, type LocalState } from "./state.js";
import { formatAlerts } from "./task-formatting.js";
import { evaluateBalanceWatches } from "./watch-service.js";

export const DEFAULT_WEBHOOK_LABEL = "balance-watch";
export const DEFAULT_WEBHOOK_PATH = "/webhooks/multibaas";
export const DEFAULT_WEBHOOK_PORT = 8787;

export interface WebhookEnsureResult {
  id: number;
  label: string;
  secret?: string;
  subscriptions: string[];
  updatedAt: string;
  url: string;
}

export interface WebhookServerOptions {
  nanoclawTarget?: NanoClawNotificationTarget;
  port: number;
  requestPath: string;
  secret?: string;
}

function normalizeRequestPath(requestPath: string): string {
  return requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
}

export function deriveDefaultWebhookUrl(
  multibaasBaseUrl: string,
  options: {
    port?: number;
    requestPath?: string;
    publicBaseUrl?: string;
  } = {},
): string | undefined {
  const requestPath = normalizeRequestPath(options.requestPath ?? DEFAULT_WEBHOOK_PATH);
  const port = options.port ?? DEFAULT_WEBHOOK_PORT;
  const publicBaseUrl = options.publicBaseUrl ?? process.env.MULTIBAAS_WEBHOOK_PUBLIC_URL;

  if (publicBaseUrl) {
    return new URL(requestPath, publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`).toString();
  }

  const url = new URL(multibaasBaseUrl);
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    return `http://127.0.0.1:${port}${requestPath}`;
  }

  return undefined;
}

export async function ensureBalanceWebhook(url: string, label = DEFAULT_WEBHOOK_LABEL): Promise<WebhookEnsureResult> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const webhook = await ensureEventWebhook(config, label, url);
  const result: WebhookEnsureResult = {
    id: webhook.id,
    label: webhook.label,
    secret: webhook.secret ?? state.webhook?.secret,
    subscriptions: webhook.subscriptions,
    updatedAt: new Date().toISOString(),
    url: webhook.url,
  };

  const nextState: LocalState = {
    ...state,
    webhook: result,
  };
  saveState(config.stateDir, nextState);
  return result;
}

export async function startWebhookServer(options: WebhookServerOptions): Promise<http.Server> {
  const config = resolveConfig();
  const state = loadState(config.stateDir);
  const secret = options.secret ?? state.webhook?.secret ?? process.env.MULTIBAAS_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error(
      "Missing webhook secret. Run `npm run dev -- webhook ensure --url ...` first, or pass --secret / MULTIBAAS_WEBHOOK_SECRET.",
    );
  }

  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== options.requestPath) {
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

    const result = await evaluateBalanceWatches(events.length);
    let notifyError: string | undefined;

    if (result.alerts.length > 0 && options.nanoclawTarget) {
      try {
        sendNanoClawNotification(
          options.nanoclawTarget,
          [`[MultiBaas alert]`, formatAlerts(result.state, result.alerts)].join("\n"),
        );
      } catch (error) {
        notifyError = error instanceof Error ? error.message : String(error);
        console.error(`Failed to deliver NanoClaw alert: ${notifyError}`);
      }
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ alerts: result.alerts.length, notifyError, received: events.length }));
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, "0.0.0.0", () => resolve());
  });

  return server;
}
