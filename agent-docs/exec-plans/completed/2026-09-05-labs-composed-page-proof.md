# Replace mock-only Labs page tests with composed journeys

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Prove authenticated lab discovery through the real Labs route and controls.
The current page test replaces the client with literal expected markup, while
client tests replace the input and catalog selector. Consolidate those owners
into one composed suite using the existing React DOM harness.

## Scope and invariants

Only Labs tests change. Production behavior, dependencies, API authority, and
provider transport remain unchanged. Authenticated page admission, hidden-page
metadata, discovery-only outcomes, input validation, session errors, retries,
independent forms, and stale-response rejection remain protected. Fetch and
page authentication are explicit external boundaries; production components
and response parsing remain real. No persisted product state is added.

## Tasks

1. Remove the whole-client and UI-control mocks; render the real async page.
2. Preserve existing meaningful journeys and add catalog selection through the
   real responsive control to its request body and visible outcome.
3. Run focused Labs tests and Web typecheck; review the candidate with the parent.

## Risks and mitigation

The DOM harness may lack browser APIs required by real controls. Reuse existing
browser shims or existing browser proof instead of introducing a new framework.
Keep all failure and stale-state cases; test cleanup cannot change their owner.

## Verification

- Focused Labs page and route tests.
- `pnpm --dir apps/web typecheck`.
- Parent candidate review before final commit and PR readiness.

## Progress

- Discovery confirmed the mock-only page proof and two mocked UI controls.
- Frozen dependency installation completed without lockfile changes.
- Consolidated both Labs suites around the real async page and production UI.
  Preserved all eleven client journeys plus metadata and unauthenticated admission.
- Added real catalog selection through POST `/api/labs`, filtered empty-state
  guidance, and a second selection that renders returned catalog results.
- Focused command passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/labs-page.test.tsx apps/web/test/labs-routes.test.ts`
  (23 tests across two files).
- `pnpm --dir apps/web typecheck` passed; after final test edits,
  `pnpm --dir apps/web typecheck:prepared` passed.
- `git diff --check` passed. Parent reviewed the complete candidate and approved
  the final scoped commit and PR.
- `pnpm complexity:diff` passed; no authored production JavaScript/TypeScript
  source changes were selected by the guard.
- Real Base UI imports now follow initial DOM installation. Reused the existing
  inline-style modal shim; no new dependencies or production behavior changes.
  Recorded the otherwise silent import-order limitation through Frog.
Completed: 2026-09-05
