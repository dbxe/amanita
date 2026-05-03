import assert from "node:assert/strict";
import test from "node:test";

import {
  formatMutationConfirmationRequired,
  isMutationConfirmationRequired,
  MUTATION_CONFIRMATION_ENV,
} from "./mcp-safety.js";

test("isMutationConfirmationRequired accepts common truthy values only", () => {
  assert.equal(isMutationConfirmationRequired({ [MUTATION_CONFIRMATION_ENV]: "1" }), true);
  assert.equal(isMutationConfirmationRequired({ [MUTATION_CONFIRMATION_ENV]: "true" }), true);
  assert.equal(isMutationConfirmationRequired({ [MUTATION_CONFIRMATION_ENV]: "yes" }), true);
  assert.equal(isMutationConfirmationRequired({ [MUTATION_CONFIRMATION_ENV]: "on" }), true);
  assert.equal(isMutationConfirmationRequired({ [MUTATION_CONFIRMATION_ENV]: "0" }), false);
  assert.equal(isMutationConfirmationRequired({}), false);
});

test("formatMutationConfirmationRequired explains sync risk and explicit confirmation", () => {
  const text = formatMutationConfirmationRequired("linking contract ABIs");

  assert.match(text, /Confirmation required/i);
  assert.match(text, /linking contract ABIs/i);
  assert.match(text, /historical indexing/i);
  assert.match(text, /confirmed: true/i);
});
