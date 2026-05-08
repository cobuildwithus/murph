Goal (incl. success criteria):
- Fix the confirmed DeepSec bug findings from the second triage batch with minimal boundary-level changes.
- Success means the nine confirmed issues have focused regression coverage and the WHOOP Date finding remains unmodified because review found it is not currently valid.

Constraints/Assumptions:
- Preserve unrelated dirty worktree changes and active plan rows.
- Keep fixes small: normalize at input boundaries, validate before expansion, and rebuild stale projections safely.
- Do not add new dependencies or broad abstractions.

Key decisions:
- Treat `links: null` as a clear-links patch for goal upserts.
- Keep WHOOP `Date` handling unchanged unless a concrete failing path appears.

State:
- Handoff; implementation and focused verification complete.

Done:
- Static review confirmed 9 real issues and 1 likely false positive.
- Implemented focused boundary fixes and regressions for the 9 confirmed issues.
- Ran focused tests and touched-package typechecks.
- Added an explicit Health Commons `same_work_as` relation for an existing duplicate DOI exposed by the stricter source-identity validation.

Now:
- Scoped commit is blocked by unrelated dirty worktree changes, including overlapping edits in touched files.

Next:
- Handoff with verification notes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/cli/src/commands/record-mutation-command-helpers.ts`
- `packages/core/src/bank/goals.ts`
- `packages/device-syncd/src/store/sync-state.ts`
- `packages/health-commons/src/catalog.ts`
- `packages/health-commons/src/web-artifacts.ts`
- `packages/health-commons/content/sources/evening-screen-curfew/doi-10-1177-20501579211028647.md`
- `packages/importers/src/csv-sample-import-planner.ts`
- `packages/query/src/browser-replica/experiments.ts`
- `packages/query/src/experiment-adherence.ts`
- `packages/query/src/query-projection.ts`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/health-bank.test.ts` in `packages/core`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/importers.test.ts` in `packages/importers`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/store.test.ts` in `packages/device-syncd`
- `pnpm exec vitest run --config vitest.workspace.ts --no-coverage test/cli-expansion-provider-event-samples.test.ts` in `packages/cli`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/catalog-coverage.test.ts test/build-determinism.test.ts` in `packages/health-commons`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/experiment-adherence.test.ts test/browser-vault-experiment-results.test.ts test/query.test.ts` in `packages/query`
- Touched-package typechecks: `packages/cli`, `packages/core`, `packages/device-syncd`, `packages/health-commons`, `packages/importers`, `packages/query`
- `pnpm --dir packages/health-commons generate:check` is blocked by an unrelated malformed modified content file: `packages/health-commons/content/sources/dry-sauna/pmid-40332494.md`
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
