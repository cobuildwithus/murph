# Keep homepage auth progress in place

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Keep homepage signup visually stable from authentication through consent: the
  active authentication button owns post-auth progress, and the completion
  response hands the already-read consent status directly to the consent prompt
  instead of flashing an intermediate loader.

## Success criteria

- The standalone "Setting things up" auth dialog state is removed.
- Telegram, email, and resumable-auth completion keep the auth surface mounted,
  disable competing actions, and show progress on the active button.
- The normal homepage completion path renders the correct consent variant
  immediately, without a second consent-status request or an intermediate
  skeleton.
- Focused hosted-web tests and typecheck pass, the design catalog covers the
  changed states, and desktop/mobile browser proof is captured.

## Scope

- In scope:
  - Homepage hosted auth panel completion presentation.
  - Hosted auth-completion consent-status handoff.
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
2. Risk: Returning consent status with auth completion could change fail-closed
   behavior if that read fails.
   Mitigation: Keep the status optional and preserve the existing unconsented
   fallback, which lets the consent card load status through its normal route.

## Tasks

1. Remove the finishing panel view and route completion state into existing auth
   controls.
2. Reuse the consent status already read by the completion endpoint so the
   consent view does not need an immediate duplicate request.
3. Update focused tests and the reusable-component design catalog.
4. Run focused tests, hosted-web typecheck, and desktop/mobile browser proof.
5. Complete required frontend review, preliminary specialist review, exact-head
   PR review, CI, and scoped commit/PR workflow.

## Decisions

- Do not introduce a replacement loader component; the initiating button is the
  only post-auth progress surface.
- Pass completion consent status through the existing payload as optional data;
  preserve the current fail-closed fallback when the status read is unavailable.
- Do not change phone-auth finalization here because it already owns its pending
  state inside the phone flow.

## Verification

- Passed: nine focused hosted-web Vitest files, 166 tests.
- Passed: specialist-requested `hosted-auth-panel.test.ts`, 14 tests, including
  pending locks and post-failure recovery at the panel boundary.
- Passed: scoped hosted-web ESLint and `pnpm --dir apps/web typecheck:prepared`.
- Passed: `git diff --check`.
- Passed: `/design?tab=components` returned HTTP 200 at 1440px and 390px.
  Rendered proof covers the production Telegram, verification-code, and
  resumable pending presentations plus combined, health-data-only, and
  legal-only consent.
- Passed: exact-head product-experience review returned no findings.
- Preliminary specialist review accepted the frontend and API design and
  returned one medium coverage finding. Its test-only patch was inspected,
  applied, and verified with the requested focused command.
Completed: 2026-07-29
