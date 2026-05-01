# Junction Connect Defaults

## Goal

Make the Junction default provider list cover every source shown on `/connect`, and have the backend plus `/connect` consume one shared Junction connect-source mapping.
Keep provider-filter normalization with that shared mapping so config/connect-target code does not import the full Junction provider module.

## Scope

- `packages/device-syncd` Junction provider/config exports.
- `packages/device-syncd` Junction connect-source/default-filter normalization.
- `apps/web` `/connect` page source availability mapping.
- Focused tests for Junction defaults and connect-page availability.

## Constraints

- Preserve active `connect-targets.ts` arbitration work already registered in the coordination ledger.
- Do not expose secrets or local personal identifiers.
- Avoid unrelated UI/design changes.

## Verification

- Focused package/app tests covering Junction defaults and `/connect`.
- Typecheck or diff-aware verification as time and current dirty-tree state allow.

