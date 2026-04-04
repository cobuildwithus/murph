# Hosted Assistant Device Connect Plan

## Goal

Let the hosted assistant help a user connect a wearable by calling one first-class tool that returns a short-lived provider authorization URL the user can click.

## Scope

- Add one assistant tool surface for wearable connect initiation.
- Reuse the existing hosted device-sync control-plane/provider registry instead of adding provider-specific assistant logic.
- Keep hosted runner child processes away from hosted-web internal bearer credentials by routing through the existing Cloudflare worker proxy boundary.
- Add the smallest hosted web internal route needed to mint a connect link for a bound hosted user.

## Constraints

- Preserve the current secret boundary: the isolated hosted runner child must not receive `HOSTED_EXECUTION_INTERNAL_TOKENS` or direct hosted-web control credentials.
- Preserve existing browser-authenticated settings/device routes; do not weaken them or mix them with assistant/server auth.
- Keep the provider flow generic for WHOOP, Oura, Garmin, and future registry-backed providers.
- Preserve overlapping dirty-tree edits in hosted/device-sync/runtime files by porting this change onto the current file state.

## Intended Changes

- `packages/assistant-core`: add a hosted-capable assistant tool for wearable connect initiation.
- `packages/hosted-execution`: add a hosted web-control-plane client contract for device connect link creation.
- `apps/cloudflare`: proxy the new hosted device connect request at the worker boundary so the runner child still uses only the per-run proxy token.
- `apps/web`: add one internal hosted-execution-authenticated route that creates the provider authorization link for the bound user through the existing device-sync public-ingress/control-plane layer.
- Focused tests and minimal doc updates only where the new internal route/tool contract needs durable coverage.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused proof for the new hosted assistant device-connect path in touched package/app tests.

## Notes

- Prefer a fixed safe hosted return path such as `/settings?tab=wearables` on the server side over model-supplied arbitrary redirect targets.
- Return only link metadata and provider labels; never expose raw provider tokens or internal hosted connection ids.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
