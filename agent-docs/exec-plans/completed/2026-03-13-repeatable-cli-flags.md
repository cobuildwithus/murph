Goal (incl. success criteria):
- Replace CSV-style multi-value CLI option parsing with repeatable flags on the affected read/import surfaces.
- Keep command behavior the same aside from argument shape: repeated flags should produce the same filters as the old comma-separated strings.
- Align docs, smoke fixtures, and tests with the repeatable-flag contract.

Constraints/Assumptions:
- Preserve adjacent edits in overlapping CLI/doc files already claimed by active rows.
- Keep scope limited to options that are already treated as multi-select plus `samples import-csv --metadata-columns`.
- Do not broaden into unrelated command additions, router changes, or README cleanup unless a touched contract reference requires it.

Key decisions:
- Use `z.array(z.string().min(1))` for repeatable options so the parser accepts `--flag a --flag b` directly.
- Normalize repeated values with de-duplication, stop splitting on commas, and reject stale comma-delimited tokens with a targeted migration error.
- Return filter arrays in command outputs where the CLI now accepts multiple values.

State:
- completed

Done:
- Read repo instructions, verification/runtime docs, completion workflow, and the active coordination ledger.
- Located the current CSV contract text, the local `parseCsvOption` helpers, and the main impacted CLI tests.
- Switched the affected multi-value CLI options to repeatable flags, removed CSV splitting, and added explicit migration errors for stale comma-delimited tokens.
- Updated docs, smoke scenarios, and CLI tests to cover repeatable flags and CSV rejection semantics.
- Ran required repo checks and direct CLI probes; recorded the current unrelated repo-red blockers.

Now:
- None.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether any external wrappers currently rely on passing comma-separated values and need a compatibility note beyond the contract update.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-repeatable-cli-flags.md`
- `packages/cli/src/option-utils.ts`
- `packages/cli/src/commands/search.ts`
- `packages/cli/src/commands/event.ts`
- `packages/cli/src/commands/provider-event-read-helpers.ts`
- `packages/cli/src/commands/samples.ts`
- `packages/cli/src/usecases/integrated-services.ts`
- `packages/cli/src/usecases/provider-event.ts`
- `packages/cli/src/vault-cli-contracts.ts`
- `packages/cli/test/search-runtime.test.ts`
- `packages/cli/test/list-cursor-compat.test.ts`
- `packages/cli/test/cli-expansion-provider-event-samples.test.ts`
- `packages/cli/test/cli-expansion-samples-audit.test.ts`
- `docs/contracts/03-command-surface.md`
- `e2e/smoke/scenarios/search.json`
- `e2e/smoke/scenarios/timeline.json`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
