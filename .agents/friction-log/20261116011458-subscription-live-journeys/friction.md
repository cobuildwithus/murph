---
title: 'Subscription live journeys mount the developer''s own Codex MCP servers and app connectors'
severity: 'minor'
---

## Expected Behavior

A live journey run with `pnpm test:assistant:live` exposes the MCP servers that production would mount for the scenario and nothing else, so a reply that lists or chooses MCP tools can be judged against the production tool surface.

## Current Behavior

A subscription run keeps the developer's Codex home configuration. The model also sees every MCP server configured in that home and, with a ChatGPT login, the app connectors that login mounts as MCP tools. Production's provider-key runner has neither. A journey that asks Murph which MCP servers it has gets a reply listing those extra servers, and a reply-text assertion can pass on an ambient connector whose name matches the synthetic server.

## Possible Solution

Have the canonical live launcher replace the home's `mcp_servers` table and turn off `features.apps` for subscription runs, leaving only the mounts the production turn builder adds. Until then, a journey can turn off `features.apps` in its thread config, as the MCP servers journey does, but configured servers still appear.

## Minimal Reproducible Example

1. Configure any MCP server in the local Codex home used for subscription runs.
2. Run `pnpm test:assistant:live -- --test "MCP servers live"`.
3. Read the `[mcp-servers-live]` line: the listed servers include the locally configured server next to the synthetic Notes mount.

## Context

Found while proving that Murph links the MCP server settings page and stops calling its built-in `murph` tools an MCP server. The connect-link scenario is unaffected; the listing scenario can only be reported as developer-local evidence.
