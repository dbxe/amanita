import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_WEBHOOK_PATH,
  DEFAULT_WEBHOOK_PORT,
  deriveDefaultWebhookUrl,
} from "./webhook-service.js";

test("deriveDefaultWebhookUrl uses loopback for host-run local MultiBaas", () => {
  assert.equal(
    deriveDefaultWebhookUrl("http://localhost:8080"),
    `http://127.0.0.1:${DEFAULT_WEBHOOK_PORT}${DEFAULT_WEBHOOK_PATH}`,
  );
  assert.equal(
    deriveDefaultWebhookUrl("http://127.0.0.1:8080/api"),
    `http://127.0.0.1:${DEFAULT_WEBHOOK_PORT}${DEFAULT_WEBHOOK_PATH}`,
  );
});

test("deriveDefaultWebhookUrl respects a public base override", () => {
  assert.equal(
    deriveDefaultWebhookUrl("http://localhost:8080", {
      port: 9999,
      publicBaseUrl: "http://host.docker.internal:8787",
      requestPath: "/custom/path",
    }),
    "http://host.docker.internal:8787/custom/path",
  );
});

test("deriveDefaultWebhookUrl declines to guess for non-local MultiBaas", () => {
  assert.equal(
    deriveDefaultWebhookUrl("https://mainnet.example.multibaas.com"),
    undefined,
  );
});
