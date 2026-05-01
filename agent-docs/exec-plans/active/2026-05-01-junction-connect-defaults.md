# Junction Connect Defaults

## Goal

Make the Junction default provider list cover every source shown on `/connect`, and have the backend plus `/connect` consume one shared Junction connect-source mapping.

## Scope

- `packages/device-syncd` Junction provider/config exports.
- `apps/web` `/connect` page source availability mapping.
- Focused tests for Junction defaults and connect-page availability.

## Constraints

- Preserve active `connect-targets.ts` arbitration work already registered in the coordination ledger.
- Do not expose secrets or local personal identifiers.
- Avoid unrelated UI/design changes.

## Verification

- Focused package/app tests covering Junction defaults and `/connect`.
- Typecheck or diff-aware verification as time and current dirty-tree state allow.

