# Junction Final Link Filter

## Goal

Land the final Junction Link provider-filter guardrail so explicit `JUNCTION_PROVIDER_FILTER` values cannot silently collapse SDK-only routes into an empty hosted Link picker.

## Constraints

- Keep Apple HealthKit, Health Connect, Samsung Health, and SDK/mobile-only sources out of hosted web Link support until a mobile SDK slice exists.
- Preserve the route-aware source catalog with `junction_link` and `junction_sdk` route types.
- Preserve unrelated dirty work in the checkout.
- Do not expose personal identifiers in docs, code, logs, or commits.

## Current Scope

- `packages/device-syncd/src/config/connect-routes.ts`
- `packages/device-syncd/src/providers/junction-connect-sources.ts`
- `packages/device-syncd/src/providers/junction.ts`
- Focused device-syncd and hosted web connect tests.

## Verification

- Focused Junction config/provider tests passed.
- Focused hosted `/connect` page test passed.
- Focused hosted runtime assistant phase test passed.
- Device-syncd typecheck passed.
- Repo-wide typecheck and diff-aware verification were blocked by unrelated active hosted-local/operator-config work.

Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
