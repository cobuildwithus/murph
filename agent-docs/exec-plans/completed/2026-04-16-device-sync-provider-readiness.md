## Goal

Perform the final device-sync provider-readiness pass after the webhook/config cleanup lanes and lock the permanent provider-addition path into durable docs.

## Scope

- `docs/device-provider-contribution-kit.md`
- `packages/device-syncd/README.md`
- focused device-sync readiness readback only unless a non-UI architecture seam still forces provider-specific generic code

## Constraints

- Treat bespoke settings-page presentation as acceptable; do not churn UI-only provider labels in this pass.
- Do not implement Fitbit, Strava, Withings, or stub providers.
- Prefer documenting the permanent seam over adding new abstraction.
- Preserve unrelated in-flight work elsewhere in the tree.

## Verification

- `pnpm typecheck`
- `pnpm test:diff docs/device-provider-contribution-kit.md packages/device-syncd/README.md`
- readback of the updated readiness guidance
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
