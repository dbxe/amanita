import http from "node:http";

import type { NanoClawNotificationTarget } from "./nanoclaw-host.js";
import { sendNanoClawNotification } from "./nanoclaw-host.js";
import { listConfiguredBackends, resolveConfig } from "./config.js";
import { evaluateEventMonitors, formatEventMonitorAlerts } from "./event-monitor-service.js";
import { ensureEventWebhook, verifyWebhookSignature } from "./multibaas.js";
import { loadState, saveState, type LocalState } from "./state.js";
import { formatAlerts } from "./task-formatting.js";
import { evaluateBalanceWatches } from "./watch-service.js";
import {
  DEFAULT_WEBHOOK_LABEL,
  DEFAULT_WEBHOOK_PATH,
  DEFAULT_WEBHOOK_PORT,
  deriveDefaultWebhookUrl,
} from "./webhook-url.js";
export {
  DEFAULT_WEBHOOK_LABEL,
  DEFAULT_WEBHOOK_PATH,
  DEFAULT_WEBHOOK_PORT,
  deriveDefaultWebhookUrl,
} from "./webhook-url.js";

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

function configuredWebhookSecrets(primaryState: LocalState, explicitSecret?: string): string[] {
  const secrets = new Set<string>();
  if (explicitSecret) {
    secrets.add(explicitSecret);
  }
  if (primaryState.webhook?.secret) {
    secrets.add(primaryState.webhook.secret);
  }
  if (process.env.MULTIBAAS_WEBHOOK_SECRET) {
    secrets.add(process.env.MULTIBAAS_WEBHOOK_SECRET);
  }
  for (const value of (process.env.MULTIBAAS_WEBHOOK_SECRETS ?? "").split(",")) {
    const trimmed = value.trim();
    if (trimmed) {
      secrets.add(trimmed);
    }
  }

  for (const backend of listConfiguredBackends()) {
    try {
      const state = loadState(backend.stateDir);
      if (state.webhook?.secret) {
        secrets.add(state.webhook.secret);
      }
    } catch {
      // Ignore unreadable optional profile state; explicit/default secrets still apply.
    }
  }

  return [...secrets];
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
  const secrets = configuredWebhookSecrets(state, options.secret);

  if (secrets.length === 0) {
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

    if (!secrets.some((secret) => verifyWebhookSignature(body, timestampValue, signatureValue, secret))) {
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

    const balanceResult = await evaluateBalanceWatches(events.length);
    const eventMonitorResult = evaluateEventMonitors(events);
    const alertText = [
      balanceResult.alerts.length > 0 ? formatAlerts(balanceResult.state, balanceResult.alerts) : undefined,
      eventMonitorResult.alerts.length > 0
        ? formatEventMonitorAlerts(eventMonitorResult.state, eventMonitorResult.alerts)
        : undefined,
    ].filter((value): value is string => Boolean(value));
    let notifyError: string | undefined;

    if (alertText.length > 0 && options.nanoclawTarget) {
      try {
        sendNanoClawNotification(
          options.nanoclawTarget,
          [`[MultiBaas alert]`, ...alertText].join("\n"),
        );
      } catch (error) {
        notifyError = error instanceof Error ? error.message : String(error);
        console.error(`Failed to deliver NanoClaw alert: ${notifyError}`);
      }
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      alerts: balanceResult.alerts.length + eventMonitorResult.alerts.length,
      balanceAlerts: balanceResult.alerts.length,
      eventAlerts: eventMonitorResult.alerts.length,
      notifyError,
      received: events.length,
    }));
  });

  await new Promise<void>((resolve) => {
    server.listen(options.port, "0.0.0.0", () => resolve());
  });

  return server;
}
