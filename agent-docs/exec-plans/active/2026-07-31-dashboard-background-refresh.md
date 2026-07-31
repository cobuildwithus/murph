# Keep dashboard content visible during background refresh

Status: active
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
- Focused tests, typecheck, rendered proof, review gates, and exact-head CI pass.

## Scope

- In scope: the shared browser-vault focus revalidation path, focused regression
  coverage, and the existing dashboard load-state design study.
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
4. Update the existing design study and capture desktop/mobile proof.
5. Run scoped verification, review gates, commit, PR, and exact-head CI.

## Decisions

- Initial mount and internal route changes remain foreground authority checks.
- Window focus uses the existing background load path; terminal authority
  outcomes still clear or replace the admitted client.

## Verification

- Commands to run: focused browser-vault context tests, hosted-web typecheck and
  lint or the routed diff-aware lane, frontend design proof, desktop/mobile
  browser proof, preliminary ReviewGPT, and required PR CI.
- Expected outcome: ready content stays visible during a pending focus request,
  while 401, 403, empty, and identity-change outcomes keep their current
  fail-closed behavior.
