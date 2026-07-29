# Restore the solo-first homepage hero

Status: completed
Created: 2026-07-28
Updated: 2026-07-29

## Goal

- Make the public homepage lead with Murph as a private, solo personal health
  assistant again by restoring the one-question 1:1 text exchange and its
  solo-first supporting copy.
- Preserve current `main` changes that landed after the group-only hero commit,
  including responsive containment and unrelated homepage behavior.

## Success criteria

- The first hero act is a private Murph conversation driven by one health
  question, not an immediate group-chat composer.
- The solo exchange catalog and its experiment, bloodwork, and order-card
  renderers are restored with accessible topic controls.
- Group chat remains available as a later optional act/capability instead of
  the homepage's first and only framing.
- The real hero section is updated on `/design?tab=sections` and renders
  correctly at desktop and mobile widths.
- Focused tests, the canonical diff-aware verification lane, and the frontend
  design-proof guard pass.
- Required product, frontend, coverage, and second-model reviews have no
  unresolved accepted findings.

## Scope

- In scope:
  - Reverse the behavioral effect of `abf6373d53` on the current `origin/main`.
  - Resolve any conflicts in favor of the restored solo-first experience while
    retaining later bug fixes.
  - Update hero/page health-claim tests and the homepage design study.
  - Capture redacted desktop and mobile design-catalog proof.
- Out of scope:
  - Removing group-chat capabilities elsewhere on the homepage or in-product.
  - Reworking signup, billing, messaging delivery, or hosted runtime behavior.
  - Inventing a new hero design or new product claims.

## Constraints

- Technical constraints:
  - Reuse the existing pre-change hero implementation and current homepage
    component boundaries; add no dependency or new state owner.
- Keep reduced-motion, keyboard, responsive, and hydration behavior intact.
- Keep the solo-first hierarchy intact for reduced-motion visitors by rendering
  the completed first exchange statically instead of skipping to the group act.
- Product/process constraints:
- Direct signups remain private-first; social support stays optional and
  explicit.
- Personal health-topic floaters always resolve in a private 1:1 thread, even
  after the group demonstration has played.
  - Preserve unrelated work in the primary checkout.
  - Follow the frontend catalog, browser-proof, ReviewGPT, and PR requirements.

## Risks and mitigations

1. Risk: A mechanical revert could overwrite later responsive fixes.
   Mitigation: compare the target commit against its parent and current
   `origin/main`, resolve conflicts hunk by hunk, and verify both viewports.
2. Risk: Restored health claims could exceed current product evidence.
   Mitigation: restore only the previously shipped observation-level copy and
   keep the existing retired-claim guards.
3. Risk: The first act could become interactive but inaccessible.
   Mitigation: restore button semantics, keyboard activation, focus behavior,
   and reduced-motion tests alongside the component.

## Tasks

1. Inspect the target commit, its parent, and all later overlapping homepage
   changes.
2. Reverse the group-only hero change on current `origin/main` and resolve
   overlaps at the smallest component/test boundary.
3. Update the real hero design-catalog study and focused regression coverage.
4. Run focused verification and desktop/mobile browser proof.
5. Complete product-experience, preliminary specialist, Claude UI, parent
   final-review, CI, and mergeability gates.

## Decisions

- Treat `abf6373d53` as the exact change to reverse. It was a direct commit,
  not a merged pull request.
- Restore its parent behavior rather than create a third hero concept.
- Keep group chat as the second act because the requested change is solo-first,
  not group-feature removal.
- Do not recreate the deleted coordination ledger from current `main`.
- Keep the animated topic/member controls, but place them behind and after the
  primary hero controls so they cannot cover the phone or create a keyboard tab
  wall. Pause their motion on focus and keep one answer in flight at a time.

## Review dispositions

- Product-experience review: the initial two privacy findings were accepted and
  fixed by starting each group as a fresh conversation and returning every
  health-topic action to a private thread. A later remediation review found
  pointer-hit and group-reply gating gaps; both were accepted and fixed at the
  existing hero owner. The final follow-up returned no findings.
- Preliminary specialist review:
  - Accepted the moving-control occlusion, keyboard-order, focus-motion, and
    contrast finding. Fixed it without replacing the existing interaction model.
  - Accepted the interrupted-exchange finding. Topic/member controls now remain
    disabled until Murph finishes the current answer.
  - Accepted both coverage findings. Tests now assert active/inactive copy
    semantics and exercise the order and bloodwork branches.
- Claude Fable visual review: attempted once after the first browser proof, but
  the configured account reported exhausted credits. Per the verification
  policy, no fallback model was substituted.

## Verification

- Focused Vitest: 3 files, 14 tests passed after specialist remediation and
  product follow-up.
- Frontend design-proof guard: 10 tests passed.
- Canonical diff verification passed on the final merged head: 559 web test
  files passed, 16 skipped; 7,322 tests passed, 220 skipped; TypeScript, lint
  with warnings only, dev smoke, and the production build passed.
- Full remote acceptance passed on the remediation tree through the bounded
  Blacksmith Testbox lane, including workspace typecheck, package and app
  verification, coverage, and the production build.
- Browser proof:
  - Solo-first and group-second states verified at desktop and mobile widths.
  - Private topic return from the group, order-card, and bloodwork-card states
    verified.
  - Remediation checked at 1024px, 1280px, and 1440px with zero horizontal
    overflow; the composer remains the top hit target.
  - Real pointer clicks on one health topic and one group member succeeded at
    both 1024px and 1280px, producing the expected private reply and group
    transition.
  - At the 1280px member/phone overlap, the phone remains the top hit layer and
    its composer receives focus; the background member control cannot cover or
    intercept it.
  - Keyboard order reaches the CTA and message field before topic controls;
    focused topic motion pauses and shows a visible focus ring.
- Parent final review found no unresolved correctness, privacy, accessibility,
  or architecture issue.
- The branch includes current `origin/main`, and the non-mutating merge-tree
  proof passed. Final ReviewGPT and exact-head CI start from the pushed plan-
  closure commit, as required by the PR-lane workflow.
Completed: 2026-07-29
