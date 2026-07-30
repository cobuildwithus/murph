# Hosted signup phone paste auto-send

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Let the homepage login/signup phone form immediately request a verification
  code when a paste or browser replacement supplies a valid phone number.
- Keep ordinary typing on the existing button/Enter submission path.

## Success criteria

- Pasting a valid local or international number uses the existing guarded
  Privy send-code path exactly once.
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
2. Detect paste/browser replacement at the shared input boundary and carry the
   resolved country with the changed national number.
3. Auto-send from the input event through the current controller gates.
4. Add regressions for paste, typing, invalid values, gating, link intent,
   duplicate protection, and pre-ready queueing.
5. Run focused verification, rendered proof, required reviews, and the PR gates.

## Decisions

- Treat `insertFromPaste` and `insertReplacementText` as explicit whole-value
  sources. A change without one of those browser input types remains manual.
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

- The public auth panel is the only caller that opts into pasted-phone
  auto-send. Settings and link flows retain manual submission.
- The real phone input and hosted controller are exercised together for an
  invalid paste, an ordinary typed value, and a valid international paste that
  advances to code entry.
- Passing local checks:
  - hosted phone-auth Vitest: 71 tests
  - hosted auth-panel Vitest: 23 tests
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
- Preliminary specialist ReviewGPT, exact-head CI, parent final review, plan
  closure, and the final ReviewGPT gate remain pending.
