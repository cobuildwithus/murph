# Restore pre-allocation hosted-local barrier controls

Status: completed
Created: 2026-09-17

## Outcome and invariant

Unblock hosted foreground/checkpoint deployment evidence by allowing test barrier
setup before a runner exists. Keep lifecycle mutations on the selected physical
target, with the existing authentication and test-entrypoint restrictions.

## Cause and smallest correction

A synthetic idle Postgres owner with no target makes six barrier setup cases
return HTTP 500. The default route fixture always provided a target and masked
this failure. Existing barrier RPCs only update test-isolate memory; restore
their stable member-keyed addressing and remove unnecessary owner reconciliation.
No new state, scheduler, target allocation, production fallback, or dependency.

## Proof and completion

- Six regression cases failed before the fix with the selected-target error.
- Initial route and real barrier-wrapper suites: 184 tests pass; typecheck passes.
- Extend proof to status/release without allocation and reject physical shutdown
  without a selected target. Preserve selected standby shutdown and auth coverage.
- Run final focused checks, complexity, docs drift, and parent review.
- Close the plan, open a scoped PR, complete exact-head CI, merge, and observe the
  fresh hosted admission workflow. Local mocks alone do not prove admission.

## Boundaries

Internal test infrastructure only; no member-facing changelog or runtime behavior
change. Production admission remains fail-closed. No rollback or Temporal workflow
mutation. Full hosted scenarios run through the existing private admission owner.

## Final local evidence

All 189 route and barrier-wrapper tests pass, including ten pre-allocation
controls and fail-closed physical shutdown. Cloudflare typecheck, docs drift,
and complexity pass; changed-file debt remains zero, max complexity 18.
Parent review confirms test-entrypoint-only addressing, no authorization change,
and selected-target lifecycle operations remain intact. Final external review
is exempt for this isolated test-infrastructure change. Exact-head CI and real
hosted admission remain pending after local implementation completion.
Updated: 2026-09-17
Completed: 2026-09-17
