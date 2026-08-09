# Footer Online Copy And Shared Counter Follow-Up

## Goal

Update the shared footer to use the requested "Murph is online" all-clear copy,
reuse the homepage's existing client-side message counter presentation, preserve
non-blocking first paint, and merge the existing pull request after its required
verification and review gates pass.

## Scope

- Shared footer status presentation and focused component coverage.
- Reusable homepage message-count presentation shared by the trust line and
  footer.
- First-paint proof that message-volume and incident-summary requests begin only
  after client mount.
- Current-main integration, exact-head ReviewGPT/CI, PR merge, and worktree
  retirement.

## Constraints

- Preserve the static message-count fallback and neutral status fallback in the
  initial render.
- Keep both network reads in client effects; add no server-side fetch, proxy,
  polling loop, or new persisted state owner.
- Preserve current referral-link behavior and its design-catalog studies while
  integrating the footer layout.
- Keep the existing status request minimization and public disclosure intact.

## Plan

1. Rebase the existing PR onto current main while preserving referral behavior.
2. Apply the requested status copy and shared counter presentation.
3. Add focused first-paint and state coverage, then refresh rendered proof.
4. Run focused tests, typecheck, docs/design guards, and parent review.
5. Commit and push, complete ReviewGPT and exact-head CI, merge the PR, and
   retire the task worktree.

Status: in_progress
Updated: 2026-08-09
