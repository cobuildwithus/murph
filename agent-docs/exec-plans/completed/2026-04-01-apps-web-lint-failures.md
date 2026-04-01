# Apps Web Lint Failures

## Goal

Make the current `apps/web` ESLint run pass without changing hosted-onboarding or hosted-share behavior.

## Scope

- Fix the current blocking ESLint errors in `apps/web`.
- Keep changes limited to lint-only source/test cleanup and direct supporting proof.
- Preserve unrelated dirty work across active onboarding/share files.

## Constraints

- Do not broaden into product or architecture changes.
- Prefer narrow typing cleanups in tests over helper refactors unless repeated fixes clearly justify one.
- Commit only the exact touched files for this lint lane.

## Verification

- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web typecheck`
- Any focused test command needed for touched suites
- Repo baseline commands only if they become green or are required after the local lane is stable

## Notes

- Current lint failures are dominated by test-only `@typescript-eslint/no-explicit-any` plus two `prefer-const` violations in source/test files.
- Warnings outside the blocking error set are not the primary goal unless they are touched incidentally.
Status: completed
Updated: 2026-04-01
Completed: 2026-04-01
