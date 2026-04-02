# Device-sync export surface cleanup

## Goal

Remove the leftover broad `@murphai/device-syncd` root and `public-ingress` exports so daemon and hosted callers stay on their intended ownership boundaries.

## Scope

- Narrow the `@murphai/device-syncd` root export away from the shared ingress surface.
- Stop re-exporting generic helpers such as `toIsoTimestamp` from `@murphai/device-syncd/public-ingress`.
- Update the hosted `apps/web` helper layer to own its local timestamp primitive directly.
- Refresh package docs/tests only where needed to reflect the narrowed public surface.

## Non-goals

- No behavior change to OAuth, webhook, or daemon runtime flows.
- No broader helper migration across unrelated hosted or local packages.
- No storage, schema, or trust-boundary redesign beyond the export cleanup itself.

## Verification

- Focused `device-syncd` and `apps/web` tests for the touched helper/package surfaces first.
- Then run the repo-required verification commands for `packages/device-syncd` changes and record any unrelated baseline failures explicitly.

## Notes

- Preserve unrelated dirty-tree edits already present elsewhere in the repo.
- Keep the change minimal: delete export leakage first, then add only the caller updates needed to keep the build green.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
