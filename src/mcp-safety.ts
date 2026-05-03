export const MUTATION_CONFIRMATION_ENV = "LOGRUNNER_REQUIRE_MUTATION_CONFIRMATION";

export function isMutationConfirmationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[MUTATION_CONFIRMATION_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function formatMutationConfirmationRequired(operation: string): string {
  return [
    `Confirmation required: ${operation}.`,
    "This can mutate MultiBaas configuration or start historical indexing, which may take a while for large contracts.",
    "Ask the user to confirm before proceeding. Only call this tool again with `confirmed: true` after an explicit yes.",
  ].join("\n");
}
