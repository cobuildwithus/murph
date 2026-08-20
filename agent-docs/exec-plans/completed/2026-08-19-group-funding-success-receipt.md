# Group funding success receipt redesign

Status: completed
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
  guidance, a public changelog item, and the existing Frog registry review.
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
- Let each responsive surface own alignment: the fulfilled drawer header
  centers the mark and headline at every drawer width, while the desktop dialog
  retains its left-aligned hierarchy. Do not couple this boundary to a smaller
  unrelated Tailwind breakpoint.
- The initial redesign landed in PR #2034. Follow-up PR #2046 owns the final
  hierarchy polish and preserves both source PRs in the existing changelog item.

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
- Intermediate-width contributor: a 700×900 Playwright viewport still selected
  the drawer and directly proved that the mark and headline content share the
  same horizontal center.
- Direct proof: the fulfilled state retained one live status announcement and
  the semantic `sms:` link. Web typecheck, focused ESLint, Playwright responsive
  capture, and diff hygiene passed.
- Preliminary ReviewGPT returned two accepted findings: the mark crossed to
  left alignment before the drawer ended, and the icon-only status semantics
  were under-asserted. The drawer now owns centering throughout its range, the
  success title drops obsolete close-button padding, and the focused test pins
  the exact label, polite live region, hidden icon, and one-status invariant.
- Remediation proof: 108 focused component and changelog tests, Web typecheck,
  focused ESLint, diff hygiene, and Playwright captures at 1440×900, 700×900,
  and 390×844 passed.
- Shipping proof: the preview reached Ready and its authenticated design-study
  route returned HTTP 200. All required checks passed on the exact code head;
  the parent review found no remaining product issue, and the current-base
  merge-tree was clean.
- Result: Complete. The follow-up removes repeated success copy without
  changing payment, routing, dismissal, or recovery behavior.
Completed: 2026-08-20
