Goal (incl. success criteria):
- Prevent reverse-dependent CLI tests selected by `pnpm test:diff` from contending on the worker-local runtime-artifact repair lock.
- Success means the official diff lane prepares shared CLI runtime artifacts once under its existing workspace lock, propagates only the artifact-trust marker to package fanout, and never enables real release packaging outside explicit CLI acceptance or coverage lanes.

Constraints/Assumptions:
- Preserve the source-first package-local CLI test loop.
- Keep direct CLI artifact-sensitive changes on the existing `verify:cli` route.
- Reuse the existing workspace artifact lock and runtime preparation helper; add no new lock or dependency.
- Preserve unrelated work and keep private identifiers out of durable artifacts.

Key decisions:
- Detect reverse-dependent CLI selection in `run_test_diff_package_tests`, prepare the shared runtime once, and pass `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1` only to the affected package fanout.
- Separate runtime-artifact trust from release-test admission with `MURPH_CLI_RELEASE_TARBALL_TEST=1` set only by explicit CLI acceptance and coverage entrypoints.
- Exercise a real Health Commons diff-scope mapping in the focused orchestration regression.

State:
- Implementation and focused verification are complete. A local commit is blocked by unmanaged external temporary clones detected by the repository worktree guard.

Done:
- Added centralized runtime preparation and trust-marker propagation for reverse-dependent CLI package fanout.
- Added the distinct release-tarball admission marker across package-local, root verification, and CI coverage entrypoints.
- Added focused Health Commons reverse-dependent scope coverage and updated verification docs.
- Passed the focused workspace verifier regression, targeted CLI test assertions, tooling typecheck, CLI typecheck, shell syntax, and diff checks.
- Passed prepared-runtime generation, CLI package-shape verification, docs drift, and docs gardening with zero issues.

Now:
- Preserve the verified uncommitted diff without bypassing or mutating the external guard blockers.

Next:
- Commit the exact scoped diff through the repository wrapper once the external worktree guard is legitimately clear.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `scripts/workspace-verify.sh`
- `scripts/workspace-verify.test.ts`
- `packages/cli/package.json`
- `packages/cli/scripts/verify-package-shape.ts`
- `packages/cli/test/release-script-coverage-audit.test.ts`
- `packages/cli/test/host-support-workflow-guards.test.ts`
- `.github/workflows/host-support.yml`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/workspace-verify.test.ts`
Status: completed
Updated: 2026-08-13
Completed: 2026-08-13
