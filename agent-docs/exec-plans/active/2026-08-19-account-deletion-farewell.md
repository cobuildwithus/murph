# Account deletion farewell

Status: active
Created: 2026-08-19
Updated: 2026-08-19

## Goal

- After account deletion succeeds, immediately replace the invalidated dashboard
  with a calm public farewell experience while preserving browser-session
  cleanup and the durable external-cleanup contract.

## Success criteria

- A successful delete never exposes the dashboard's signed-out error state.
- The departing member sees one public, responsive farewell page with a clear
  confirmation and a quiet route back to Murph.
- Privy browser logout still completes best effort before navigation, with a
  bounded fallback when its SDK does not settle.
- Pending external cleanup remains automatic and does not block the farewell.
- Focused component/page tests, Web typecheck, and phone/desktop browser proof
  pass.

## Scope

- In scope: the post-delete client handoff, a public `/farewell` page, focused
  regression coverage, and a member-visible changelog entry.
- Out of scope: changing deletion ownership, vendor cleanup ordering, retry
  semantics, retained exit-feedback policy, or authentication behavior for any
  other route.

## Constraints

- Technical constraints: preserve the authoritative app-session cookie clear
  and best-effort Privy logout; do not depend on deleted member state; keep the
  destination public and noindex; use existing design tokens and assets.
- Product/process constraints: no private feedback or identifying details in
  code, tests, docs, screenshots, or PR text; no additional ReviewGPT run per
  the user's instruction.

## Product UX plan

- Effort: Product change.
- Outcome: a departing member receives a composed ending instead of an error
  from a dashboard whose account was just removed.
- Entry and promise: completing the existing irreversible deletion flow moves
  directly into a full-page farewell, clears the remaining browser login best
  effort, and settles on the public `/farewell` route.
- Affected people: a departing member on a narrow phone or desktop, including
  both immediately completed cleanup and background-cleanup outcomes. A person
  who later visits the public page is not signed out or shown private state.
- Proof: render the public destination at phone and desktop widths; exercise the
  successful deletion state and prove Privy completion navigates immediately;
  prove the bounded fallback uses the same destination.
- Done when: no dashboard content is visible after success, the farewell copy
  remains legible and centered at both widths, navigation is public and
  history-replacing, and existing deletion failure/recovery states are
  unchanged.

## Risks and mitigations

1. Risk: navigating before Privy logout could leave a stale browser session.
   Mitigation: make the farewell a full-viewport takeover while the existing
   best-effort logout runs, then replace the URL immediately on completion.
2. Risk: a slow or unavailable Privy SDK could strand the member on an
   authenticated URL.
   Mitigation: retain the bounded hard-navigation fallback to the public page.
3. Risk: a public farewell route could become a logout-CSRF surface.
   Mitigation: keep logout ownership in the successful deletion component; the
   public page renders no logout side effect.

## Tasks

1. Verify the production deletion's canonical and external-cleanup state using
   aggregate, read-only evidence.
2. Add a reusable farewell presentation and public noindex page.
3. Replace the post-delete dashboard delay with an immediate full-page handoff
   and history-replacing navigation after Privy cleanup.
4. Add focused component/page coverage and a changelog entry.
5. Run focused tests, typecheck, direct browser proof, and completion checks.
6. Commit, open and merge the PR without another ReviewGPT run, verify the live
   route and deletion handoff contract, then retire the worktree.

## Decisions

- Keep browser logout on the successful deletion surface rather than on the
  public page, so an ordinary `/farewell` visit cannot sign out another member.
- Use a full-viewport takeover before navigation to hide invalidated dashboard
  state without introducing a second server-side session mechanism.

## Verification

- Commands to run: focused Vitest files for data-privacy settings and the
  farewell page; Web typecheck; relevant changelog validation; phone and desktop
  browser render; scoped diff/privacy inspection.
- Expected outcomes: immediate `/farewell` replacement after logout, bounded
  fallback, no dashboard error exposure, noindex metadata, responsive public
  rendering, and no regression in deletion error or retry behavior.
