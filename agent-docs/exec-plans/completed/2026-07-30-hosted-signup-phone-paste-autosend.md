# Hosted signup phone paste auto-send

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Let the homepage login/signup phone form immediately request a verification
  code when a whole-field paste supplies a valid phone number.
- Keep ordinary typing on the existing button/Enter submission path.

## Success criteria

- Pasting a valid local or international number into an empty field or over a
  full-field selection uses the existing guarded Privy send-code path exactly
  once.
- International paste updates the country selector before the code-entry state
  is shown.
- Invalid pasted values, typed values, link flows, authenticated states,
  active attempts, pending actions, and interaction-gated flows do not
  auto-send.
- A pre-ready paste queues through the existing readiness owner and sends once
  when Privy becomes ready.
- Focused tests, typecheck, lint, and rendered desktop/mobile proof cover the
  changed behavior.

## Scope

- In scope: shared phone-input change metadata, the hosted phone-auth controller,
  the homepage auth opt-in, focused tests, and the existing design-catalog auth
  study.
- Out of scope: SMS provider behavior, server routes, invite masked-phone
  verification, phone validation rules, visual restyling, and auth copy.

## Constraints

- Reuse the existing controller queue, pending-action, readiness, and sendCode
  path.
- Do not add persisted state, a second side-effect owner, timers, or speculative
  sends from ordinary typing.
- Keep the behavior opt-in to the public login/signup modal.

## Tasks

1. Port the still-relevant behavior from the preserved historical task commit
   onto current main.
2. Detect a whole-field paste at the shared input boundary and carry the
   resolved country with the changed national number.
3. Auto-send from the input event through the current controller gates.
4. Add regressions for paste, typing, invalid values, gating, link intent,
   duplicate protection, and pre-ready queueing.
5. Run focused verification, rendered proof, required reviews, and the PR gates.

## Decisions

- Treat `insertFromPaste` as an explicit whole-value source only when the paste
  event targets an empty field or replaces the full current selection.
  Browser replacements and partial edits remain manual.
- Trigger the send from the input event rather than introducing candidate state
  and a second effect.
- Preserve the manual button as fallback and accessibility affordance.

## Verification

- Focused hosted phone-auth and auth-panel Vitest.
- `apps/web` typecheck and scoped ESLint.
- Frontend design-proof checks and desktop/mobile rendering of the existing
  auth study.
- Required preliminary specialist review, final exact-head ReviewGPT gate, and
  PR CI.

## Checkpoint evidence

- Homepage-owned auth compositions explicitly opt into pasted-phone auto-send.
  The reusable panel defaults to manual submission, with negative composition
  proof for generic, family-invite, and group-invite dialogs.
- The real phone input and hosted controller are exercised together for an
  invalid paste, ordinary typing, a valid suffix paste, a browser replacement,
  and a valid whole-field international paste that advances to code entry.
- Preliminary specialist ReviewGPT found that the original opt-in was owned too
  low in the generic panel and that input-type-only detection also classified
  partial edits as whole-value submission. Both findings were accepted and
  corrected without adding another state or side-effect owner. The review
  supplied no patch artifact.
- The required product-experience checklist was reapplied after remediation.
  No finding remains: the homepage whole-field paste removes one redundant
  action, partial edits retain the explicit send boundary, existing progress
  and error states remain owned by the phone-auth controller, and other auth
  journeys remain unchanged.
- Parent final review of the full base-to-head diff found no remaining
  correctness, privacy, product-experience, frontend, coverage, or scope
  finding. Current `main` merged cleanly; its intervening changes were isolated
  to Cloudflare CI and bundle-budget files.
- Passing local checks:
  - hosted phone-auth Vitest: 71 tests
  - auth surface composition Vitest: 45 tests across 6 files
  - `apps/web` typecheck
  - scoped `apps/web` ESLint
  - frontend design-proof tests
  - `git diff --check`
- Redacted rendered evidence:
  - `audit-packages/signup-phone-autosend-r2/desktop.png` at 1440x900
  - `audit-packages/signup-phone-autosend-r2/mobile.png` at 390x844
- The in-app browser had no available backend. The repository Playwright
  fallback captured both catalog viewports from the isolated frontend server.
- The full hosted-local stack was not needed for the screenshots and stopped
  during setup on a pre-existing Cloudflare runner bundle-size budget overage.
- The required Claude Fable UI review was attempted and ended at explicit usage
  credit exhaustion, so no Claude findings were available.
- The focused phone-flow, auth-surface, and design-proof suites passed again
  after merging current `main`. Exact-head CI and the final ReviewGPT gate
  continue after plan closure as the PR merge gates.
Completed: 2026-07-30
