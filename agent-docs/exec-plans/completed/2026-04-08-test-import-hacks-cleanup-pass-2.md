# Clean up another pass of hacky import and mock patterns across package tests

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Run a second package-scoped cleanup pass on remaining test files that still use repetitive dynamic imports or reset/mock/import boilerplate.
- Prefer direct imports where mock timing is irrelevant.
- Where mocking still requires lazy imports, centralize the repeated reset/mock/import flow behind small package-local helpers when that clearly improves readability.

## Success criteria

- The targeted `setup-cli`, `assistant-cli`, `device-syncd`, and `inboxd` tests use clearer import patterns than the current ad hoc approach.
- Any new helper is package-local and test-only.
- Behavior remains unchanged and focused verification passes for the touched scopes.

## Scope

- In scope:
- `packages/setup-cli/test/**` for selected import-cleanup files
- `packages/assistant-cli/test/**` for selected import-cleanup files
- `packages/device-syncd/test/**` for selected import-cleanup files
- `packages/inboxd/test/**` for selected import-cleanup files
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-test-import-hacks-cleanup-pass-2.md}`
- Out of scope:
- app tests
- runtime source changes beyond the minimum seam strictly needed for test cleanup
- unrelated package coverage work already in flight

## Current state

- `packages/setup-cli/test/**` has repeated dynamic imports for modules whose mocks are already hoisted and stable.
- `packages/assistant-cli/test/assistant-package-surface.test.ts` still loads mocked package surfaces lazily inside the test body.
- `packages/device-syncd/test/bin.test.ts` and portions of `packages/device-syncd/test/http.test.ts` repeat the same mocked-import pattern around bin/http module loading.
- `packages/inboxd/test/inboxd-persist-quarantine-coverage.test.ts` repeats `vi.resetModules()` plus `vi.doMock("node:fs/promises")` plus `await import(...)` across multiple cases.

## Risks and mitigations

1. Risk:
   Breaking mock timing by pulling imports too early.
   Mitigation:
   Only switch to direct imports when mocks are already declared at module scope and do not vary per test.
2. Risk:
   Colliding with the dirty tree and active package lanes.
   Mitigation:
   Keep worker ownership disjoint by file cluster and stay test-only.
3. Risk:
   Introducing helpers that hide test intent.
   Mitigation:
   Add helpers only when the repeated pattern is real and local to the package.

## Tasks

1. Register the second cleanup pass in the coordination ledger.
2. Spawn five high-reasoning workers across disjoint package/file clusters.
3. Integrate the worker diffs and finish any remaining local cleanup.
4. Run focused verification plus the required final review audit.
5. Commit the scoped result.

## Verification

- `pnpm typecheck` if not blocked by a known unrelated workspace issue
- focused package-local typecheck/test commands for each touched package
Completed: 2026-04-08
