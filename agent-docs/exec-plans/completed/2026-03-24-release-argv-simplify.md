Goal (incl. success criteria):
- Remove the duplicated hand-rolled argv loops in the three release-path scripts by introducing one tiny shared helper and declarative per-script option definitions.
- Success means `verify-release-target`, `pack-publishables`, and `publish-publishables` keep the same externally observable flag behavior, help output, defaults, and failure messages while sharing less parsing code.

Constraints/Assumptions:
- This is a behavior-preserving simplification pass on verified release tooling; release behavior must not change.
- Preserve exact script-local flag names, defaults, help usage strings, missing-value validation rules, and unknown-argument failures unless tests prove the behavior is already equivalent.
- Keep the shared helper small and local to the release scripts; do not introduce a generic CLI framework.
- Preserve current token consumption semantics where a flag that expects a value consumes the next argv token even if that token starts with `-`.

Key decisions:
- Add the shared helper to `scripts/release-helpers.mjs` so the release path keeps one small helper surface instead of another standalone utility module.
- Add focused regression tests that execute the scripts through Node so the current help/error semantics stay locked down across future edits.
- Avoid reshaping any pack/publish runtime logic; only the argv plumbing and its direct tests are in scope.

State:
- completed with unrelated repo verification failures still open in other lanes

Done:
- Read repo process docs, release-path docs, the current three script implementations, and the existing release workflow tests.
- Confirmed the duplicate parsers differ only by option schema/defaults and share the same ordered argv loop shape plus exact error strings.
- Added `parseReleaseArgs(...)` to `scripts/release-helpers.mjs` and rewired the three release scripts to declare their defaults, usage text, and option schema locally.
- Added focused regression coverage for `--help`/`-h`, unknown arguments, empty-string missing values, and the current "consume the next token even if it looks like a flag" behavior.
- Verified `node scripts/verify-release-target.mjs --json` passes.
- Verified `pnpm exec vitest run --no-coverage packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/release-workflow-guards.test.ts --maxWorkers 1` passes.
- Ran the user-requested `pnpm test -- --run packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/release-workflow-guards.test.ts`; it failed before reaching the targeted tests because the shared repo build is currently broken in `packages/core/src/bank/providers.ts`.
- Ran `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`; all failed for the same pre-existing `packages/core/src/bank/providers.ts` type errors, and the user-requested `pnpm test -- --run ...` additionally surfaced existing `@healthybob/runtime-state` resolution failures under `packages/cli`.

Now:
- None.

Next:
- Keep the unrelated `packages/core` and runtime-state verification failures in their existing active lanes; no further change is required for this release-script simplification slice.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-24-release-argv-simplify.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `scripts/release-helpers.mjs`
- `scripts/verify-release-target.mjs`
- `scripts/pack-publishables.mjs`
- `scripts/publish-publishables.mjs`
- `packages/cli/test/release-script-coverage-audit.test.ts`
- `packages/cli/test/release-workflow-guards.test.ts`
- `node scripts/verify-release-target.mjs --json`
- `pnpm test -- --run packages/cli/test/release-script-coverage-audit.test.ts packages/cli/test/release-workflow-guards.test.ts`
Status: completed
Updated: 2026-03-24
Completed: 2026-03-24
