# Keep consent handoff terminal until navigation commits

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- After launch consent succeeds, keep the authenticated handoff terminal until
  the owning navigation or route refresh replaces the dialog. The stale login
  form must never reappear between consent and the destination.

## Success criteria

- A regression test proves that a successful downstream completion leaves the
  consent handoff mounted and cannot reveal stale auth controls.
- A failed downstream completion remains retryable without repeating consent
  writes.
- Declining consent still resets the panel for a fresh authentication attempt.
- Focused web tests, web typecheck, frontend design proof, and desktop/mobile
  browser evidence pass.
- Exact-head CI and required ReviewGPT gates are green or any external blocker
  is reported with evidence.

## Scope

- In scope: hosted auth panel consent-to-navigation state ownership, focused
  regression coverage, and the existing design-catalog auth study.
- Out of scope: provider authentication behavior, consent persistence, session
  issuance, redirect destination policy, or new UI styling.

## Constraints

- Technical constraints: preserve retry after handoff failure, prevent duplicate
  completion callbacks, and use the existing consent card as the only terminal
  state owner.
- Product/process constraints: preserve auth, launch-consent, invite, and
  initial-visit routing invariants; use the frontend worktree/PR lane.

## Risks and mitigations

1. Risk: an embedded auth consumer expects the login form to reappear after a
   successful completion callback.
   Mitigation: inspect every callback; all current consumers navigate or refresh,
   while failure remains the explicit retry path.
2. Risk: retaining the consent state invokes completion twice.
   Mitigation: clear only the pending completion ref after success and cover a
   late requirement-change callback.

## Tasks

1. Add a failing regression assertion to the existing hosted-auth-panel journey.
2. Keep the accepted consent handoff mounted after downstream completion.
3. Expose the terminal handoff state in the existing design catalog study.
4. Run focused tests, typecheck, design proof, and browser verification.
5. Commit, publish a PR, and complete CI plus preliminary/final ReviewGPT gates.

## Decisions

- Keep the existing callback contract. Successful callbacks already own terminal
  navigation or refresh; the panel should not invent a second post-success state.
- Do not reset completion state on success. Reset remains decline-only because
  decline is the sole supported path back into authentication in the same panel.

## Verification

- Passed: focused hosted auth, consent, and dialog-provider Vitest coverage
  (52 tests); full `apps/web` typecheck; focused ESLint; frontend design-proof
  script tests; and `git diff --check`.
- Direct regression proof: the new assertion failed before the fix because the
  phone auth form remounted, then passed after the consent state remained owned
  through the completion handoff.
- Browser verification gap: the isolated local web server reached ready state,
  but no controllable browser was attached to this session, so desktop/mobile
  screenshots and the dependent visual double-check could not run locally.
- Remaining: committed-range design-proof validation, exact-head CI, and
  preliminary/final ReviewGPT.
Completed: 2026-07-30
