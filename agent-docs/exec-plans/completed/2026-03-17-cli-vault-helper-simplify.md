# CLI vault helper simplify

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Remove duplicated helper implementations shared by `provider-event` and `experiment-journal-vault` by extracting the exact common subset into a CLI-private helper module.

## Success criteria

- `packages/cli/src/usecases/provider-event.ts` and `packages/cli/src/usecases/experiment-journal-vault.ts` stop carrying the duplicated helper block where semantics are identical.
- Link-kind classification and queryable-id checks keep each call site's current behavior, including the existing `prov_` and `current` differences.
- `resolveVaultRelativePath` keeps the current `VaultCliError` codes and messages, especially `invalid_path`.
- Existing targeted CLI/runtime tests stay green without widening accepted ids or changing visible outputs.

## Scope

- In scope:
- extract a CLI-private helper module used only by the two affected usecases
- preserve per-usecase behavior with explicit configuration or thin wrappers when shared helpers would otherwise drift
- touch targeted tests only if coverage needs to lock current semantics more directly
- Out of scope:
- replacing these helpers wholesale with `packages/cli/src/usecases/shared.ts` or `@healthybob/query` id-family helpers
- changing the third `resolveVaultRelativePath` copy in `packages/cli/src/commands/export-intake-read-helpers.ts`

## Constraints

- Keep the diff local to the two usecases plus the new helper module unless tests need narrow updates.
- Preserve current overlapping query-runtime typing edits in both usecase files.
- Follow the required completion workflow and repo verification commands for `packages/cli`.

## Risks and mitigations

1. Risk: centralizing link helpers could accidentally merge the differing `prov_` or `current` semantics.
   Mitigation: make the shared helper configurable or keep explicit per-call-site wrappers so each current output path stays exact.
2. Risk: shared path validation could change error text or which inputs fail.
   Mitigation: copy the current validation logic exactly and keep the caller-visible `VaultCliError` branches unchanged.
3. Risk: local ULID generation extraction could alter output format.
   Mitigation: move the existing implementation verbatim and leave the call pattern unchanged.

## Tasks

1. Compare the duplicated helpers and identify the exact common subset versus the current semantic differences.
2. Extract the shared subset into a CLI-private helper module with explicit configuration for the differing link rules.
3. Update both usecases to consume the new helpers and keep their current behavior intact.
4. Run simplify, coverage, and final review audit passes, rerun required checks, and commit only the scoped files.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused checks: targeted `packages/cli` tests that cover provider/event, experiment/journal, and runtime lookup-id enforcement during implementation
Completed: 2026-03-17
