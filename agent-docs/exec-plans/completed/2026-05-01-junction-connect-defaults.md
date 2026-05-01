# Junction Connect Defaults

## Goal

Make Junction connect routing use one neutral source/route registry shared by backend connect-targets and `/connect`.
Keep hosted Link defaults to the Link-eligible subset only, while preserving SDK/local/non-Link entries as explicit non-Link routes.

## Scope

- `packages/device-syncd` Junction provider/config exports.
- `packages/device-syncd` neutral connect-route registry and Junction connect-source/default-filter normalization.
- `apps/web` `/connect` page source availability mapping.
- Focused tests for Junction defaults and connect-page availability.

## Constraints

- Preserve active `connect-targets.ts` arbitration work already registered in the coordination ledger.
- Do not expose secrets or local personal identifiers.
- Avoid unrelated UI/design changes.
- `JUNCTION_DEFAULT_PROVIDER_FILTER` must remain exactly the hosted Link-eligible provider slug subset; SDK/local routes must be rejected even when explicitly configured.

## Verification

- Focused package/app tests covering Junction defaults and `/connect`.
- Typecheck or diff-aware verification as time and current dirty-tree state allow.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
