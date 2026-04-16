## Goal

Make the `vault-cli meal` command surface truthful and self-explanatory for lightweight meal capture.

## Why

- `meal list` currently hides the shared `--limit` option even though the underlying list result already carries a default limit.
- `meal add --schema` currently exposes only the CLI flags, which makes the structured `--input` payload path too easy to misread.
- The fix should stay narrow: improve the existing meal command surface instead of adding a second command or new abstraction.

## Scope

- `packages/cli/src/commands/meal.ts`
- `packages/cli/test/cli-expansion-document-meal.test.ts`
- Generated CLI metadata only if the command surface changes require it

## Constraints

- Keep the change inside `packages/cli`.
- Preserve the existing lightweight `--photo` / `--audio` / `--note` flow.
- Prefer descriptive schema/help text over new command topology.

## Verification

- Focused `packages/cli` tests covering meal schema/help behavior and meal list runtime behavior
- Required `packages/cli` verification lane for the touched files
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
