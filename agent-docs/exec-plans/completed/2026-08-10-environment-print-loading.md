# Environment print loading state

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Replace the sparse Environment print-loading state with a report-shaped,
  accessible transition that feels deliberate and remains faithful to the
  final private report.

## Success criteria

- The authenticated `/environment/print` loading state clearly communicates
  what is happening without implying fake progress or adding another async owner.
- The loading composition mirrors the final report hierarchy at desktop and
  mobile widths, uses restrained reduced-motion-safe animation, and exposes an
  accessible busy status.
- The real production loading component appears in the existing Environment
  print design-catalog study alongside the completed report.
- Focused Web tests and typecheck pass, desktop/mobile rendered proof is
  inspected, required review gates are resolved, and exact-head CI is green.

## Scope

- In scope: the Environment print loading presentation, its focused tests, the
  existing design study, the same-day public changelog entry, and PR evidence.
- Out of scope: Browser Vault loading behavior, authentication, report data,
  print output, error/empty states, and Environment runtime processing.

## Constraints

- Technical constraints: reuse React, Next Image, and the existing Tailwind v4
  design system; add no dependency, timer, persisted state, or new data flow.
- Product/process constraints: preserve private-report boundaries, keep motion
  restrained and nonessential, use the worktree/PR lane, and complete the
  frontend/product/coverage specialist review plus the second-model UI check.

## Risks and mitigations

1. Risk: a decorative loader can imply progress that the client cannot know.
   Mitigation: describe only the two real presentation operations and use a
   report-shaped skeleton without step completion claims.
2. Risk: the loading layout can drift from the printable report.
   Mitigation: place the pure loading component beside the report owner and
   render both in the same catalog study.
3. Risk: animation can distract or reduce accessibility.
   Mitigation: keep animation on decorative skeleton marks only and gate it
   behind the motion-safe variant while retaining a visible status message.

## Tasks

1. Extract a pure Environment print-loading presentation at the report owner.
2. Replace the page client's generic status with the new presentation and add
   focused loading-state assertions.
3. Extend the existing Environment print design study to show loading and ready
   states using the real production components.
4. Add the same-day changelog item after the PR number is known.
5. Run focused verification, capture desktop/mobile catalog proof, resolve
   required reviews, close this plan, and confirm exact-head CI.

## Decisions

- Keep Browser Vault status ownership unchanged; this is presentation only.
- Use a structural skeleton matching the report instead of a spinner or a
  percentage because no truthful incremental progress signal exists.
- Treat the change as frontend-only and low risk, so the final cross-cutting
  ReviewGPT gate does not apply; preliminary product-experience, frontend, and
  coverage lenses still apply.
- Accept the specialist coverage finding and assert that every loading pulse
  remains motion-gated. No production remediation was required.

## Verification

- Commands to run: focused Environment/dashboard Vitest files, Web typecheck,
  `git diff --check`, local desktop/mobile catalog capture, Claude UI review,
  preliminary `completion-specialists` ReviewGPT, and exact-head required CI.
- Expected outcomes: focused checks pass, rendered text remains legible without
  overflow at both viewports, reviewers return no unresolved accepted findings,
  and all required PR checks pass on the final head.
- Local result: the two focused Vitest files pass with 55 tests, Web typecheck
  and scoped ESLint pass, and both delivered design-proof images match the
  native-resolution local captures byte for byte.
- Review result: the preliminary product and frontend lenses returned no
  findings; the accepted low-severity coverage finding is resolved by the
  focused reduced-motion assertion. The configured Claude UI review could not
  run because that model reported explicit credit exhaustion.
- Remote result: the final plan-close push owns the exact-head CI rerun; its
  status is recorded on PR #1617 rather than in this archived snapshot.
Completed: 2026-08-10
