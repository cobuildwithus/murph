# Hosted run docs and stale-name guard cleanup

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Remove stale live hosted-wake framing from active docs/process artifacts and add a production-only guard that fails if deleted hosted-wake surfaces are reintroduced.

## Success criteria

- Live reference docs and the active coordination ledger describe the hosted path in hosted-run / hosted-ingress terms, not as a live hosted-wake model.
- Repo tooling fails when production code reintroduces the deleted `apps/web/app/api/internal/hosted-wake` or `apps/web/src/lib/hosted-wake` paths, or the blocked stale hosted-wake field/type names from the review note.
- The guard allows existing grandfathered test-only and historical-plan residue while blocking new production/runtime drift.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/references/data-model-seams.md`
- `docs/hosted-hard-cut-migration-guide.md`
- `packages/hosted-execution/README.md`
- `README.md`
- `scripts/check-hosted-run-stale-residue.ts`
- `scripts/check-hosted-run-stale-residue.test.ts`
- `scripts/workspace-verify.sh`

## Constraints

- Keep this a docs/process/tooling cleanup only; do not broaden into runtime protocol or schema changes.
- Preserve factual grandfathered file paths in active-plan snapshots or test-only scopes when that path still exists on disk.
- Block only production/runtime code, not tests, review docs, or immutable completed plans.
- Treat the existing `packages/assistant-runtime/src/hosted-runtime/execution.ts` `assistantNextWakeAt` alias as an explicit temporary grandfather until the separate runtime naming lane lands, rather than folding that dirty-file rename into this task.

## Verification

- planned: `pnpm typecheck`
- planned: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/check-hosted-run-stale-residue.test.ts --no-coverage`
- planned: `git diff --check`

## Notes

- The canonical source of truth is `agent-docs/references/hosted-run-protocol.md`.
- The lower-priority `completedAt` quarantine semantics note is not part of this cleanup unless live docs still contradict the current protocol.
Completed: 2026-04-20
