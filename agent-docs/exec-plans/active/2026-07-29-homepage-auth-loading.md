# Keep homepage auth progress in place

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Keep homepage signup visually stable from authentication through consent: the
  active authentication button owns post-auth progress, and the consent loading
  placeholder matches the rendered consent prompt's size and structure.

## Success criteria

- The standalone "Setting things up" auth dialog state is removed.
- Telegram, email, and resumable-auth completion keep the auth surface mounted,
  disable competing actions, and show progress on the active button.
- The compact consent loading placeholder mirrors the rendered title,
  description, assurances, document links, and actions at desktop and mobile
  widths without a visible dialog-size jump.
- Focused hosted-web tests and typecheck pass, the design catalog covers the
  changed states, and desktop/mobile browser proof is captured.

## Scope

- In scope:
  - Homepage hosted auth panel completion presentation.
  - Shared compact launch-consent skeleton.
  - Focused component tests and design-catalog studies.
- Out of scope:
  - Provider authentication or account-provisioning behavior.
  - Invite-page full-screen provisioning loaders.
  - Consent copy, documents, or acceptance semantics.

## Constraints

- Technical constraints:
  - Keep `useHostedAuthCompletion` as the single post-Privy completion owner.
  - Reuse the existing button and spinner primitives.
  - Preserve the consent gate's fail-closed behavior.
- Product/process constraints:
  - Prefer deletion over another transition state.
  - Keep unrelated worktree changes untouched.
  - Complete required frontend catalog, browser, specialist, CI, and review
    proof before handoff.

## Risks and mitigations

1. Risk: Keeping the form mounted could leave another auth method actionable
   during completion.
   Mitigation: Disable every competing auth action while marking only the active
   method as busy.
2. Risk: A hand-tuned skeleton could drift from the real consent card again.
   Mitigation: Mirror the production component's existing layout groups and
   token classes, with focused structural coverage and a catalog study.

## Tasks

1. Remove the finishing panel view and route completion state into existing auth
   controls.
2. Align the consent skeleton with the rendered launch-consent structure.
3. Update focused tests and the reusable-component design catalog.
4. Run focused tests, hosted-web typecheck, and desktop/mobile browser proof.
5. Complete required frontend review, preliminary specialist review, exact-head
   PR review, CI, and scoped commit/PR workflow.

## Decisions

- Do not introduce a replacement loader component; the initiating button is the
  only post-auth progress surface.
- Do not change phone-auth finalization here because it already owns its pending
  state inside the phone flow.

## Verification

- Commands to run:
  - Focused Vitest files for auth panel, auth dialog, email/Telegram buttons,
    verification-code rendering, and legal consent.
  - Hosted-web typecheck or the narrowest documented equivalent.
  - Desktop and mobile `/design` catalog browser checks and screenshots.
- Expected outcomes:
  - No standalone finishing notice renders from homepage auth.
  - The active completion button remains visible, disabled, and busy.
  - The consent skeleton and prompt retain the same dialog footprint.
