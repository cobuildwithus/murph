# Cloudflare Stable Outbound Handler Plan

## Goal

Fix the hosted runner outbound-handler failure by making the worker/container outbound interception contract rollout-safe and keeping the Cloudflare Containers design as simple as possible.

## Why

- Production is failing during `RunnerContainer.setOutboundByHosts()` because the worker/container boundary currently depends on multiple named outbound handlers.
- Cloudflare Containers roll Worker code immediately but update Container instances gradually, so that boundary must remain backward-compatible across rollouts.
- Murph only needs one trusted outbound proxy implementation that dispatches by hostname after request validation; multiple handler names add deploy risk without adding architectural value.

## Scope

1. Collapse the runner outbound contract to one stable handler name.
2. Keep internal-host routing and per-run proxy-token validation intact.
3. Add focused test coverage for the stable handler mapping and rollback-safe host assignment.
4. Verify the `apps/cloudflare` lane with the app-local verification surface.

## Non-goals

- No redesign of the hosted runner/container lifecycle.
- No change to the internal hostnames or outbound route semantics.
- No deploy automation rewrite beyond what is needed to document or support the stable contract.

## Intended design

- `RunnerContainer` exposes one stable named outbound handler for all internal worker-bound hosts.
- `setOutboundByHosts()` maps every internal host to that single handler and passes the existing per-run/user params.
- `handleRunnerOutboundRequest()` remains the sole hostname-based dispatcher for artifact, results, device-sync, and usage routes.
- Future internal-host additions extend hostname dispatch only, not the worker/container method-name contract.

## Verification target

- `pnpm --dir apps/cloudflare verify`
- Direct static proof from the updated runner container and tests that all internal hosts now map to one stable handler name.
Status: completed
Updated: 2026-04-13
Completed: 2026-04-13
