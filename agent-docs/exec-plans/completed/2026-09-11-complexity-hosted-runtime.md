# Simplify hosted runtime invocation return policy

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce duplicated return-wake and invocation-response assembly in the hosted runtime while preserving wake precedence, checkpoint ordering, and foreground admission.

## Success criteria

- Seven return boundaries share retention wake selection without changing persisted wakes.
- Focused startup, system-mailbox, retention, and browser-refresh tests and package typecheck pass.
- Complexity guard passes with lower file debt; implementation is ready for parent-owned PR completion.

## Scope and owner

`packages/assistant-runtime/src/hosted-runtime.ts` remains the owner. No new state, public API, dependencies, assistant instructions, or workspace-assistant-phase edits.

## Evidence and decisions

Seven return branches copy runtime/retention wake selection; two also append browser timeout retries. Existing earliest-wake arbitration already owns ordering. A private pure helper removes the duplicated policy while retaining input order, null handling, and each caller's immediate-recheck decisions.

## Invariants and risks

Retention must compete only for the returned wake, never replace the separately persisted default wake. Preserve equal-time ordering and future-mailbox retry suppression. No await, external effect, checkpoint, retry, or deploy protocol changes are authorized by this refactor. Existing composed entrypoint tests cover the real return paths; add focused regression evidence only for uncovered cases.

## Tasks

1. Consolidate duplicated return assembly and inspect the complete diff.
2. Run focused tests, package typecheck, and complexity guard.
3. Commit and open draft PR; parent owns subsequent ReviewGPT and exact-head CI completion.

## Verification

- Passed: 113 tests across the startup, system-mailbox, and retention entrypoint suites with `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000 --reporter=verbose test/hosted-runtime-workspace-entrypoint-retention.test.ts test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts test/hosted-runtime-workspace-entrypoint-startup.test.ts`.
- Passed: `MURPH_TSC_PACKAGE_CHECKERS=1 pnpm --dir packages/assistant-runtime typecheck`.
- Passed: `pnpm complexity:diff`, file debt 546 to 514 (-32); maximum remains 252. Initial-import return falls 61 to 51, system-mailbox return 26 to 20, clean return 31 to 23, dirty return 39 to 31, and retention-only return 19 to 15. New private helpers score 3 and 9.
- Parent inspected the complete source diff and accepted the focused return-policy scope. Exact-head CI and final ReviewGPT remain parent-owned PR completion gates.
- An initial non-verbose test invocation was stopped after confirming ownership of its idle process tree; the bounded verbose rerun above completed successfully. No failing test or source workaround resulted.
- No changelog: internal behavior-preserving refactor. No provider-input, instruction, schema, or tool changes; no live-model run required.
Completed: 2026-09-11
