# Remove unused Web components and service APIs

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Remove the replaced ChatGPT settings component, unused generic UI primitives, orphan device webhook lock, obsolete Linq attempt writer and helper, unused invite/checkout APIs, and the unused second plan catalogue. Preserve all mounted components, live backend endpoints, dispatch claims, provider receipts, billing definitions, and authentication/transaction owners.

## Evidence and design

References were checked against tracked source and tests before deletion. The old attempt writer has only dedicated test callers; the transport uses provider dispatch claims. The removed UI components have no production or design consumers. These deletions add no state, migration, runtime protocol, schema, or deployment ordering requirement.

## Tasks and verification

1. Remove unused definitions and exclusive mocks while preserving acceptance, receipt, idempotency, and live billing assertions.
2. Run focused service and component tests, Web typecheck, and complexity guard.
3. Inspect the full diff and privacy boundary; commit and open the draft PR.
4. Run required CI and final ReviewGPT on the stable pushed candidate concurrently.

Internal-only cleanup; no rendered product change or member-visible changelog. Web typecheck passes. Six focused suites pass with 293 tests: Linq observability and transport, group-plan policy, billing plans, sidebar chat actions and dashboard sidebar. `pnpm complexity:diff` and `git diff --check` pass.

Parent candidate review verified removed-symbol references, current sidebar consumers, and preserved dispatch, receipt, authentication and checkout ownership. Existing complexity hotspots remain in unchanged live delivery and invite owner bodies; further rewrites are outside this deletion. No current rendered state or public endpoint changes. Exact-head CI and ReviewGPT remain PR gates.
Completed: 2026-09-10
