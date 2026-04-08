# Clean up another batch of hacky import and mock patterns across package tests

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Run a third package-scoped cleanup pass on remaining test files that still use repetitive dynamic imports or duplicated reset/mock/import setup.
- Prefer direct imports when mocks are stable at module scope.
- When mocking must stay lazy, centralize repeated module-loading boilerplate behind small test-local helpers.

## Success criteria

- The targeted test files in `operator-config`, `assistantd`, `setup-cli`, and `inboxd` read more directly than the current ad hoc lazy-import patterns.
- Any helper introduced is package-local and test-only.
- Focused verification passes for each touched package.

## Scope

- In scope:
- `packages/operator-config/test/**` for selected import-cleanup files
- `packages/assistantd/test/**` for selected import-cleanup files
- `packages/setup-cli/test/**` for selected import-cleanup files
- `packages/inboxd/test/**` for selected import-cleanup files
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-test-import-hacks-cleanup-pass-3.md}`
- Out of scope:
- packages already cleaned in the earlier passes unless a newly selected file still has obvious duplicated boilerplate
- runtime source changes beyond the minimum seam needed for test readability
- unrelated coverage work already in flight elsewhere in the tree

## Current state

- `packages/operator-config/test/setup-runtime-env-prompt.test.ts` and `packages/operator-config/test/imessage-readiness.test.ts` still use per-test dynamic imports for seams that may be centralizable.
- `packages/operator-config/test/http-linq-device-runtime*.test.ts` and `packages/operator-config/test/device-daemon-runtime.test.ts` still repeat module-reset and child-process mocking flows.
- `packages/assistantd/test/bin.test.ts` repeats the same mocked bin-load path with query-string imports.
- `packages/setup-cli/test/setup-assistant-wizard-flow.test.ts` repeatedly imports the same wizard module after stable mocks are configured.
- `packages/inboxd/test/linq-webhook-connector.test.ts` still repeats reset/mock/import boilerplate around the HTTP seam.

## Risks and mitigations

1. Risk:
   Breaking mock timing by importing too early.
   Mitigation:
   Only switch to direct imports where mocks are declared once at module scope and do not vary per test.
2. Risk:
   Colliding with unrelated in-flight work.
   Mitigation:
   Keep worker ownership disjoint by file cluster and stay inside untouched test files.
3. Risk:
   Over-abstracting tests.
   Mitigation:
   Use helpers only when they remove repeated setup without hiding the test intent.

## Tasks

1. Register the third cleanup pass in the coordination ledger.
2. Spawn five high-reasoning workers across disjoint file clusters.
3. Integrate the worker diffs and finish any remaining local cleanup.
4. Run focused verification plus the required final review audit.
5. Commit the scoped result.

## Verification

- `pnpm typecheck` if still green for the workspace
- focused package-local test and typecheck commands for each touched package
Completed: 2026-04-08
