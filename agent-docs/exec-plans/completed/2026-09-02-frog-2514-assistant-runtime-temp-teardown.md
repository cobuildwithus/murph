# Fix assistant-runtime temp-root teardown race

Status: completed
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Keep the assistant-runtime collapse tests from deleting their temporary vault
  while an invocation started by that test can still enter assistant state work.

## Success criteria

- Every affected test retains the raw invocation promise, aborts it during
  cleanup, and awaits it before removing the temporary vault.
- The focused collapse suite remains green across repeated isolated runs.
- The assistant-runtime typecheck and repository diff checks pass.

## Scope

- In scope:
  - Test-owned invocation lifecycle in the two collapse cases added by the
    report-producing mailbox scheduling change.
- Out of scope:
  - Production runtime behavior, state-lock error tolerance, and unrelated
    timing thresholds.

## Constraints

- Technical constraints:
  - Preserve fake-timer behavior and abort before switching clocks or deleting
    the vault.
  - Join the raw invocation, not only its timeout wrapper.
- Product/process constraints:
  - Keep the patch test-only and avoid copying issue evidence into source text.

## Risks and mitigations

1. Risk: Cleanup changes could hide a real assertion failure.
   Mitigation: Catch only the invocation result during cleanup; all test-body
   assertions and timeout failures still propagate normally.

## Tasks

1. Prove the teardown owner from current code and matching historical evidence.
2. Add abort-and-join ownership to the affected collapse tests.
3. Run focused repeated proof, typecheck, and diff/privacy audits.
4. Commit, open a draft PR, complete required review and CI, then land only if
   every autonomous-merge gate remains satisfied.

## Decisions

- Do not weaken assistant state directory checks: ENOENT is evidence of an
  escaped test invocation, not a filesystem condition to tolerate.
- Do not drain production post-checkpoint work at every invocation return; that
  concurrency is intentional and separately covered.

## Verification

- Commands to run:
  - Repeated isolated collapse test file.
  - `pnpm --dir packages/assistant-runtime typecheck`.
  - `git diff --check` and scoped privacy/path scan.
- Expected outcomes:
  - No escaped invocation or state-lock filesystem error; all focused tests and
    typecheck pass.
- Results:
  - Untouched package baseline: 2,647 tests passed; one unrelated bridge timing
    assertion failed. The intermittent teardown error did not recur in this run.
  - Focused collapse suite: 22/22 passed in three consecutive isolated runs.
  - Assistant-runtime typecheck passed.
  - Complexity diff passed; the guard correctly classified the change as
    test-only with no authored source changes to analyze.
  - `git diff --check` and the scoped privacy/path scan passed.
Completed: 2026-09-02
