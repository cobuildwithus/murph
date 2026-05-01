# Junction Connect Defaults

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

## Verification Plan

- Run the focused Junction config/provider tests.
- Run the focused hosted `/connect` page test.
- Run typecheck unless blocked by unrelated dirty-tree state.
- Run required completion audits for health/provider connection behavior and coverage.
