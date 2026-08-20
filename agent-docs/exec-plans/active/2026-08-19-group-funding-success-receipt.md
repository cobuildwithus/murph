# Group funding success receipt redesign

Status: active
Created: 2026-08-19
Updated: 2026-08-20

## Goal

- Turn the verified group-funding success state into a compact, confident
  receipt that makes the next action obvious without changing payment,
  fulfillment, dismissal, or Messages-routing behavior.

## Success criteria

- The fulfilled group state no longer expands into an oversized two-section
  dialog on desktop or a full-height receipt drawer on mobile.
- One primary `Open Messages` action and one quiet dismissal path remain, with
  the existing `sms:` destination and accessible success announcement intact.
- The heading, supporting copy, and action fit without overflow at desktop and
  narrow-phone widths and preserve keyboard focus and close behavior.
- The compact success mark stands on its own without a redundant congratulatory
  label competing with the receipt headline.
- Focused component tests, Web typecheck, rendered browser proof, the applicable
  preliminary ReviewGPT lenses, exact-head CI, and parent final review pass.

## Scope

- In scope: the fulfilled group presentation in
  `HostedUsageTopUpDialog`, its focused tests, the matching design-system
  guidance, a public changelog item, and the task-owned Frog entry.
- Out of scope: Stripe/payment state, purchase polling, sponsorship selection,
  billing authority, group deep-link capability, and non-group success states.

## Constraints

- Technical constraints: reuse the existing shadcn Base UI Dialog, Drawer, and
  Button owners; add no dependency or new component; preserve semantic link and
  dialog title/description composition.
- Product/process constraints: Product UX Patch. Outcome: the receipt is calm,
  rewarding, and immediately legible. Reaches: existing desktop and phone group
  contribution returns. Proof: focused behavior tests plus real rendered
  desktop and mobile walkthroughs. Keep Murph's warm-paper palette, sage-only
  affirmative signal, restrained motion, and non-cheerleader voice.

## Risks and mitigations

1. Risk: collapsing the receipt could hide the fact that Messages cannot open
   the exact group thread.
   Mitigation: retain a concise chooser instruction immediately beside the
   primary action and keep the `sms:` link unchanged.
2. Risk: removing a visible `Done` action could weaken dismissal or keyboard
   control.
   Mitigation: keep the standard close control in the dialog and drawer, then
   prove both paths.

## Tasks

1. Inspect the current production state, component owners, tests, and design
   catalog at the exact `origin/main` base.
2. Implement the smallest compact fulfilled-state composition and align the
   focused assertions and durable design guidance.
3. Add the member-visible changelog item and verify public-data/privacy bounds.
4. Run focused tests, Web typecheck, and desktop/mobile browser walkthroughs.
5. Commit and push the candidate, open the PR, run preliminary specialist
   ReviewGPT with CI, resolve findings, close the plan, and prove current-base
   mergeability.

## Decisions

- Preserve the existing modal/drawer owner because fulfillment follows an
  external checkout return; this is a terminal receipt, not a simple inline
  edit that should be moved out of an overlay.
- Delete the desktop `Done` action instead of styling it. The standard close
  control already owns dismissal, while `Open Messages` owns continuation.
- Do not add illustration or celebratory motion. The success mark, type
  hierarchy, and tighter composition are sufficient and match Murph's explicit
  anti-gamification rules.
- Keep the confirmation mark but remove its visible kicker. The headline already
  communicates the success outcome, while the mark retains the visual and
  accessible status signal.

## Verification

- Commands to run: the focused hosted-usage dialog Vitest file, Web typecheck,
  `git diff --check`, and Playwright walkthroughs at desktop and narrow phone
  widths; exact-head required GitHub checks after push.
- Expected outcomes: unchanged payment behavior, one accessible success status,
  a semantic `sms:` continuation link, no duplicate desktop dismissal action,
  no overflow or clipped action on phone, and all routed review/CI gates green.

## Product UX walkthrough

- Desktop contributor: the production receipt study rendered a 512×346 dialog
  with one compact confirmation mark, one headline, one explanatory sentence,
  and the full-width Messages action. The standard close control remained the
  only separate exit.
- Phone contributor: the same study rendered a content-height 390×361 drawer.
  The mark centered with the phone headline, the chooser instruction wrapped
  without clipping, and the Messages action remained fully visible.
- Direct proof: 101 focused component tests passed; the fulfilled state retained
  one live status announcement and the semantic `sms:` link. Web typecheck,
  focused ESLint, Playwright desktop/mobile capture, and diff hygiene passed.
- Result: Ready. The follow-up removes repeated success copy without changing
  payment, routing, dismissal, or recovery behavior.
