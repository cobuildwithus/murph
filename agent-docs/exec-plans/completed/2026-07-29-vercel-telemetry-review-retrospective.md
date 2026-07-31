# Vercel telemetry review retrospective

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Resolve the third-round ReviewGPT retrospective by reducing the telemetry
  change to the smallest architecture that preserves the requested privacy
  boundary.
- Remove review-driven support code that is not justified by the product
  requirement.

## Trigger

The third substantive final-review round triggered a mandatory retrospective.
That round also found that the telemetry-specific frontend design-proof
classifier could ignore a source line beginning with two plus characters. The
classifier therefore did not provide the fail-closed behavior claimed in the
pull request.

## Original requirement

- Enable Vercel Analytics and Speed Insights only for an explicit set of
  approved routes.
- Add public routes beyond the supplied patch only when they do not expose
  sensitive product context.
- Strip query strings and fragments and reject unknown or malformed events.

## Review-driven additions

1. Preliminary review added strict URL parsing and exhaustive ownership
   coverage. Retain both because they directly prove the privacy boundary.
2. Final round 1 added three page-test mocks after route-local telemetry mounts
   pulled `usePathname` into server-page suites. Delete the mocks by deleting
   the route-local mounts.
3. Exact-head CI remediation added a telemetry-specific design-proof
   classifier, its tests and docs, and moved the pitch mount to shape the diff.
   Delete all of this machinery rather than broaden a repository-wide visual
   proof policy for one invisible component.

## Architecture decision

- Keep the existing root-layout telemetry owner.
- Make the client component fail closed before either vendor component mounts.
- Use one exported pathname allowlist for both render-time suppression and
  send-time event rejection.
- Keep `/`, `/changelog`, `/clubs`, `/home`, and `/pitch` as the complete
  allowlist. Every other route remains suppressed.
- Retain URL-state stripping, malformed-input rejection, and Speed Insights
  route/URL agreement checks.

This ownership is selected from the product requirement: the telemetry
component itself is the privacy boundary, while route pages remain presentation
owners. It also avoids route-level test coupling and changes no user-facing UI
file relative to the task base.

## Tasks

1. Restore the root layout as the single telemetry owner and remove all
   route-local mounts.
2. Remove the page-test shims and telemetry-specific design-proof changes.
3. Update ownership coverage to require exactly one root import and mount.
4. Run focused telemetry and affected-page tests, design-proof tests, lint,
   typecheck, docs drift, final ReviewGPT, and exact-head CI.

## Verification

- Focused telemetry suite: 8 tests passed.
- Affected page suites: 3 files and 53 tests passed without telemetry mocks.
- Frontend design-proof suite: 10 tests passed after restoring the original
  guard.
- Exact base-to-head design-proof check: no user-facing hosted Web UI changes.
- Web typecheck: passed.
- Focused ESLint: passed.

Completed: 2026-07-29
