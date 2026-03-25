Goal (incl. success criteria):
- Prevent additive vault metadata contract changes from breaking older healthy vaults during read/startup flows.
- Success means `loadVault()` can normalize safe additive metadata defaults in memory, operators have an explicit `vault repair` command that persists the normalized metadata through the canonical write path, and the current local vault can be repaired without manual file edits.

Constraints/Assumptions:
- Preserve strict failures for incompatible or corrupted metadata values; only safe additive defaults should be auto-filled.
- Keep canonical vault writes inside `packages/core`.
- Avoid hand-editing the current vault; use the new repair path to persist any fix.

Key decisions:
- Add one core metadata compatibility helper that merges missing additive nested fields from the current canonical scaffold before schema validation.
- Surface compatibility repairs as warnings during validation so stale metadata is visible before it becomes a blocking problem.
- Add a dedicated `vault repair` CLI command instead of making read-only paths silently rewrite vault files.

State:
- completed

Done:
- Diagnosed the current startup failure as missing `idPolicy.prefixes.recipe` and `paths.recipesRoot` in `vault.json`.
- Confirmed the existing `vault update` path cannot repair stale metadata because it validates the existing file before writing.
- Added `packages/core/src/vault-metadata.ts` to normalize safe additive scaffold defaults before schema validation while preserving hard failures for incompatible values.
- Threaded normalized metadata through `loadVault()`, `validateVault()`, `updateVaultSummary()`, and the public core mutation surface.
- Added `vault repair` CLI plumbing, contract metadata updates, focused core/CLI regression tests, and repaired the current local vault through the new command without hand-editing files.
- Verified the original `healthybob run` metadata-validation failure is gone; the local runtime now proceeds far enough to report that the inbox daemon is already running.
- Ran focused regression verification: `pnpm exec vitest run packages/core/test/core.test.ts packages/cli/test/runtime.test.ts --no-coverage --maxWorkers 1` passed.
- Ran repo `pnpm test`; it failed in unrelated long-running CLI/importer suites with broad timeouts outside the vault metadata slice.
- Ran repo `pnpm test:coverage`; it failed before coverage execution because `pnpm build` currently fails in the unrelated setup-services lane (`packages/cli/src/setup-services.ts`, `packages/cli/src/setup-services/channels.ts`).
- Re-ran repo `pnpm typecheck`; it now fails for the same unrelated setup-services lane plus adjacent setup test typing (`packages/cli/test/setup-channels.test.ts`, `packages/cli/test/setup-cli.test.ts`).

Now:
- Close the execution plan, remove the active ledger row, and commit the scoped vault-compatibility files with the unrelated verification blockers recorded in handoff.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether future metadata evolution should eventually use an explicit migration registry keyed by metadata schema version once non-additive changes appear.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-25-vault-metadata-compat.md`
- `packages/core/src/vault-metadata.ts`
- `packages/core/src/vault.ts`
- `packages/core/src/domains/vault-summary.ts`
- `packages/core/src/public-mutations.ts`
- `packages/core/src/index.ts`
- `packages/contracts/src/constants.ts`
- `packages/contracts/src/command-capabilities.ts`
- `packages/contracts/generated/audit-record.schema.json`
- `packages/cli/src/commands/vault.ts`
- `packages/cli/src/usecases/{types.ts,integrated-services.ts,runtime.ts}`
- `packages/cli/src/vault-cli-command-manifest.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/core/test/core.test.ts`
- `packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts`
- `docs/contracts/03-command-surface.md`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `bash scripts/close-exec-plan.sh agent-docs/exec-plans/active/2026-03-25-vault-metadata-compat.md`
- `healthybob run`
Status: completed
Updated: 2026-03-25
Completed: 2026-03-25
