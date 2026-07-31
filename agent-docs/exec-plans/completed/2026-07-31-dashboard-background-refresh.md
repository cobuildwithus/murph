# Keep dashboard content visible during background refresh

Status: completed
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Keep already-authorized dashboard content mounted when the browser window
  regains focus and the private vault checks for newer data.

## Success criteria

- The first dashboard load still shows the existing loading state.
- Returning to an already-loaded dashboard does not replace content with a
  loading screen while the focus-triggered request is pending.
- Revoked, expired, or changed identity responses still clear private data and
  follow the existing recovery path.
- Focused tests, typecheck, and exact-head CI pass. The required managed final
  review is attempted and any infrastructure failure is recorded explicitly.

## Scope

- In scope: the shared browser-vault focus revalidation path and focused
  regression coverage.
- Out of scope: changing refresh frequency, caching private data outside the
  existing in-memory owner, or redesigning dashboard loading visuals.

## Constraints

- Preserve the initial mount and route-change authority fence.
- Preserve cross-tab invalidation and fail-closed identity handling.
- Prefer the shared provider fix over page-by-page loading exceptions.

## Tasks

1. Prove the shared focus handler causes the visible loading regression.
2. Revalidate on focus as a background refresh after current-route admission.
3. Add focused coverage for retained content and revoked-session cleanup.
4. Run scoped verification, review gates, commit, PR, and exact-head CI.

## Decisions

- Initial mount and internal route changes remain foreground authority checks.
- Window focus uses the existing background load path; terminal authority
  outcomes still clear or replace the admitted client.
- No design-catalog surface is added: the final patch changes provider timing,
  not a component, copy, layout, CSS, asset, or visual presentation.

## Verification

- Completed: 59 focused Browser Vault tests, changed-file ESLint, hosted-web
  typecheck, preliminary specialist review, and all required exact-head PR CI.
- Managed final ReviewGPT did not produce a model result: one packaging race and
  repeated managed-Brave attachment/target failures prevented staging the
  guarded snapshot. No run returned a substantive review or PASS; the failures
  are recorded in the PR body and task handoff rather than treated as evidence.
- Expected outcome: ready content stays visible during a pending focus request,
  while 401, 403, empty, and identity-change outcomes keep their current
  fail-closed behavior.
Completed: 2026-07-31
