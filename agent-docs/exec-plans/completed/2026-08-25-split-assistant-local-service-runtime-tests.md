# Split Assistant Local-Service Runtime Tests

## Outcome

Make Assistant Engine coverage deterministic at the ordinary Node heap by replacing the 11,000-line local-service runtime test module with smaller behavior-owned test files that share one test-only harness.

## Scope

- Preserve every existing assertion and production behavior.
- Split `assistant-local-service-runtime.test.ts` into delivery, live-input, hosted-progress/tooling, failure/no-reply, and session-management owners.
- Extract the shared mocks, factories, cleanup hook, and dynamic module loader into one adjacent test harness.
- Remove the obsolete monolithic file and, once coverage proves the memory issue is resolved, delete the Assistant Engine-only 6 GiB CI/local heap exception.
- Record the recurring coverage-memory friction through Frog.

## Plan

1. Mechanically partition the existing tests at stable test boundaries and extract the shared harness without changing assertions.
2. Run the five focused files without coverage and repair only split-induced import or isolation errors.
3. Run full Assistant Engine coverage at the default heap; retain the existing heap exception unless that exact proof passes.
4. Update the focused workflow guards/docs only if the proven heap exception can be deleted.
5. Inspect the final diff, run required focused verification, commit, push, and complete the PR review/CI gates.

## Risks And Proof

- Test behavior could change through module/mock lifecycle differences. Preserve one harness cleanup hook and prove all 106 tests pass together.
- Smaller files might pass while package coverage still accumulates memory. Full package coverage at the default heap is the completion proof.
- Coverage thresholds or source accounting could drift. Require the ordinary package coverage report and thresholds to pass unchanged.

## Status

Complete.

## Evidence

- The five behavior-owned files preserve all 106 original `test(...)`
  declarations in their original order and share one cleanup/mock/module-load
  harness.
- The five-file focused run passed 106/106 before final import-only cleanup;
  the isolated live-input owner subsequently passed 24/24 with one worker.
- Full Assistant Engine coverage passed on the ordinary Node heap with 4,117
  active tests and every package threshold green (90.57% statements, 84.33%
  branches, 94.74% functions, and 90.60% lines).
- Assistant Engine typecheck, verification-script tests, workflow guards,
  shell syntax, durable-doc drift, and diff whitespace checks passed.
- A later shared-host package run timed out in an unrelated scripted-runtime
  owner; that exact 99-test file passed in isolation. Later focused retries also
  showed transform/import stalls above 100 seconds, so no timeout widening or
  production change was accepted for the host-contention artifact.
Status: completed
Updated: 2026-08-25
Completed: 2026-08-25
