# Exposed agent surface

This document describes what the NanoClaw-mounted Logrunner MCP server exposes during the hackathon demo.

The short version: judges can ask for typed blockchain intelligence over the configured MultiBaas deployments. They cannot run arbitrary shell commands, send onchain transactions, disconnect synced contracts, delete MultiBaas resources, or call arbitrary contract methods.

## Runtime boundary

NanoClaw talks to Logrunner through the stdio MCP server in `dist/mcp.js`. The MCP server exposes named tools from `src/mcp.ts`; it does not expose a generic HTTP client, a shell, or raw MultiBaas admin access.

The runtime uses the configured MultiBaas backend profiles, currently Ethereum mainnet and Arbitrum One in the demo setup. MultiBaas credentials stay outside this repo and are injected into NanoClaw through the configured runtime path.

## Read-oriented tools

These tools are intended to be safe to call from ordinary judge prompts:

- `list_configured_backends`
- `list_preloaded_interfaces`
- `inspect_arbitrum_dao`
- `summarize_governance_incident`
- `verify_governance_control_activity`
- `check_governance_proposal_status`
- `plan_governance_proposal_monitor`
- `inspect_targets_across_backends`
- `lookup_contract_candidates`
- `inspect_contract_interfaces`
- `resolve_contract_target`
- `get_token_metadata`
- `inspect_event_capabilities`
- `run_event_investigation`
- `get_token_control_events`
- `investigate_token`
- `get_top_holders` for already known token names such as `ARB`
- `get_address_balance`
- `get_holder_concentration`
- `list_tasks`
- `list_balance_watches`

Some read tools call fixed contract read methods under the hood. For example, ERC-20 metadata can read `name`, `symbol`, `decimals`, and `totalSupply` through a typed wrapper. That is not a generic method-call surface.

## Mutating tools

The MCP server has a small number of mutating tools:

- `monitor_governance_proposal` registers or reuses the configured MultiBaas `event.emitted` webhook and persists the Arbitrum frozen ETH proposal monitor. This is part of the demo path.
- `create_balance_watch` persists local watch state for a balance monitor.
- `evaluate_tasks` and `evaluate_balance_watches` update local task/watch/alert state.
- `investigate_contract_address` may import/link a clear verified contract lookup candidate.
- `import_contract_lookup_candidate` imports a selected ABI candidate and links it to an address.
- `ensure_contract_interface` links a preloaded interface to an address.
- `get_top_holders` with a raw contract address may alias/link an ERC-20 interface and start historical event indexing when the contract is not already linked.
- `ensure_event_webhook` registers or updates a generic MultiBaas event webhook URL.

Judge-facing NanoClaw sessions set `LOGRUNNER_REQUIRE_MUTATION_CONFIRMATION=1`. With that enabled, contract ABI import/linking, raw-contract holder onboarding for not-yet-linked contracts, and arbitrary webhook registration require an explicit user confirmation before the agent retries the tool with `confirmed: true`.

This preserves useful exploration while avoiding accidental indexing work or webhook reconfiguration from a casual prompt.

## What is not exposed

Logrunner does not expose tools to:

- disconnect, unlink, or delete synced contracts
- delete contract definitions
- delete or disable MultiBaas webhooks
- send blockchain transactions
- sign messages
- call arbitrary contract methods by selector or ABI
- make arbitrary MultiBaas REST requests
- execute shell commands from the chat agent
- read local secret files through MCP

The strongest protection is still credential scoping on the MultiBaas side. The MCP surface narrows what the agent can ask MultiBaas to do, but backend API-key permissions remain the outer authorization boundary.
