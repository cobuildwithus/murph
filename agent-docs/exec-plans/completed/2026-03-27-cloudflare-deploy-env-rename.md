# Cloudflare Deploy Env Rename

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Rename the new Cloudflare deploy-automation env contract to drop the `HB_` prefix while keeping the change scoped to the deploy helper, workflow, tests, and deploy docs.

## Success criteria

- Replace `HB_CF_*` with `CF_*` across the deploy-automation workflow, helper, tests, and deploy guide.
- Replace `HB_INSTALL_PADDLEOCR` with `INSTALL_PADDLEOCR` in the deploy-automation workflow, docs, and runner image build arg.
- Remove the old `HB_CF_*` / `HB_INSTALL_PADDLEOCR` names from this scoped deploy surface instead of carrying dual-name aliases.
- Avoid broad unrelated runtime renames such as `HB_HOSTED_BUNDLE_KEY` or the `HB_USER_` per-user env prefix.

## Constraints

- Keep the rename scoped to the deploy-automation surface added in the previous Cloudflare deploy commit.
- Preserve concurrent dirty worktree edits outside this scope.
- Re-run focused verification plus the required repo commands and required audit passes.

## Verification

- Focused helper suite: `pnpm --dir ../.. exec vitest run apps/cloudflare/test/deploy-automation.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1` passed after the final follow-up with 10 tests.
- Direct scenario proof:
  - rendered `.deploy/wrangler.generated.jsonc`, `.deploy/worker-secrets.json`, and `.deploy/runner.env` from isolated sample `CF_*` inputs and confirmed the expected worker name, worker URL, runner URL, and `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=45000`
  - rendered `.deploy/runner.env` again with only `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=45000`
  - rendered `.deploy/runner.env` with blank `CF_RUNNER_COMMIT_TIMEOUT_MS` plus `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=45000` and confirmed the runtime fallback still won
- Required repo checks:
  - `pnpm typecheck` failed in unrelated in-flight `packages/cli/src/usecases/record-mutations.ts` JSON typing (`JsonObject` / `JsonValue`) work.
  - `pnpm test` failed on the same unrelated `packages/cli/src/usecases/record-mutations.ts` JSON typing errors while building `packages/cli`.
  - `pnpm test:coverage` failed on the same unrelated `packages/cli/src/usecases/{event-record-mutations.ts,record-mutations.ts}` JSON typing errors while building `packages/cli`.
- Mandatory audit passes:
  - `simplify`: one simplification issue found and fixed locally by removing the duplicate workflow timeout export and simplifying the allowlist normalization / deploy-input handling.
  - `test-coverage-audit`: added positive coverage for `CF_ALLOWED_USER_ENV_KEYS` / `CF_ALLOWED_USER_ENV_PREFIXES`, plus negative coverage that legacy `HB_CF_*` deploy inputs are rejected and legacy `HB_CF_*` runner aliases are ignored.
  - `task-finish-review`: initially found runner commit-timeout fallback regressions, all fixed locally; final rerun reported no findings.

## Outcome

- The Cloudflare deploy workflow, helper module, tests, Docker build arg, and deploy guide now use the `CF_*` / `INSTALL_PADDLEOCR` deploy contract consistently.
- Legacy `HB_CF_*` inputs no longer work on this scoped deploy surface, with focused tests keeping that boundary locked.
- The runner env render path still preserves the non-`HB_` runtime fallback for `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS`, including blank preferred-input handling, so the rename does not break existing local/manual runner env rendering.
