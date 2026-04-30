import test from "node:test";
import assert from "node:assert/strict";

import { deriveContainerBaseUrl } from "./nanoclaw.js";

test("deriveContainerBaseUrl rewrites localhost for container access", () => {
  assert.equal(deriveContainerBaseUrl("http://localhost:8080"), "http://host.docker.internal:8080");
  assert.equal(deriveContainerBaseUrl("http://127.0.0.1:9000/api"), "http://host.docker.internal:9000/api");
});

test("deriveContainerBaseUrl preserves non-local hosts", () => {
  assert.equal(deriveContainerBaseUrl("https://example.multibaas.com"), "https://example.multibaas.com");
});
