Goal (incl. success criteria):
- Confirm whether Murph is already on the true current `incur` release and avoid unnecessary version churn if it is.
- Land the smallest useful incur-aligned follow-up that improves the shipped CLI surface, docs, or generated artifacts without changing unrelated behavior.
- Success means the final diff either updates `incur` if the repo is behind, or documents and implements a concrete current-incur feature adoption with verification.

Constraints/Assumptions:
- Preserve the existing command topology and operator-facing behavior unless a current incur feature requires a small, clearly justified migration.
- Keep scope inside the CLI packages plus the docs/tests/generated artifacts directly tied to incur.
- Preserve unrelated dirty worktree edits and avoid broad CLI refactors.

Key decisions:
- Treat the npm `latest` dist-tag as the source of truth for the "latest version" request.
- Prefer a useful incur-native capability over a no-op dependency touch if the repo is already on `latest`.
- Use the built `incur` generator from `packages/cli/node_modules/.bin/incur` instead of the TS source bin because the current Node runtime rejects type stripping inside `node_modules`.

State:
- in_progress

Done:
- Read the required repo routing, architecture, verification, testing, and completion-workflow docs.
- Confirmed the repo currently pins `incur` `0.3.13` in `packages/cli`, `packages/assistant-cli`, and `packages/setup-cli`.
- Confirmed via npm registry metadata that the current `latest` dist-tag is still `0.3.13`.
- Confirmed the root CLI already uses some recent incur features, including config loading and sync metadata.
- Verified the built generator is available at `packages/cli/node_modules/.bin/incur`.
- Added a package-local incur config-schema generation helper plus the `gen:config-schema` script.
- Generated and committed `packages/cli/config.schema.json`, added it to the published package files list, and documented the artifact in the package README.
- Added freshness guards in `packages/cli/scripts/verify-package-shape.ts` and focused schema coverage in `packages/cli/test/incur-smoke.test.ts`.
- Ran `pnpm typecheck`, `MURPH_TEST_LANES_PARALLEL=0 pnpm test`, `MURPH_TEST_LANES_PARALLEL=0 pnpm test:coverage`, `pnpm --dir packages/cli test`, and `pnpm --dir packages/cli gen:config-schema` successfully.
- Ran a direct built-CLI schema scenario check with `node packages/cli/dist/bin.js vault paths --schema --format json`.
- Completed the required final audit pass; it reported no findings and only suggested hardening the maintainer generator path against missing build artifacts.
- Hardened the incur config-schema helper to auto-build the CLI package when `dist/index.js` is missing and to fail clearly when the local incur binary is unavailable.
- Re-ran `pnpm typecheck`, `pnpm --dir packages/cli gen:config-schema`, and `pnpm exec vitest run packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1` successfully after that review-driven fix.
- Re-ran `pnpm --dir packages/cli test` after the review-driven fix; it failed in unrelated pre-existing assistant bootstrap tests (`packages/cli/test/assistant-runtime.test.ts`, `packages/cli/test/assistant-service.test.ts`) after the workspace rebuild picked up concurrent dirty assistant changes outside this task.

Now:
- Remove the active ledger row, close this plan, and create the scoped commit.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-04-06-incur-latest-alignment.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/cli/package.json`
- `packages/assistant-cli/package.json`
- `packages/setup-cli/package.json`
- `packages/cli/src/index.ts`
- `packages/cli/src/incur.generated.ts`
- `packages/cli/README.md`
- `packages/cli/test/incur-smoke.test.ts`
- `npm view incur version dist-tags repository.url homepage time --json`
- `packages/cli/node_modules/.bin/incur gen --help`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
