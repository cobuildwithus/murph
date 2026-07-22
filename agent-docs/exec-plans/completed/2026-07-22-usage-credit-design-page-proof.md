# Usage-credit UI and frontend design proof

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make the group usage-credit entry card and amount-selection dialog concise,
  legible, and visually consistent with Murph's product design system.
- Put reusable examples of both surfaces on the design page.
- Require frontend PRs that add or materially change reusable components or
  page UI to update the matching design-page component or section and include
  rendered screenshots from that design-page state in the PR description.

## Success criteria

- The entry card and selection dialog preserve the existing fixed amounts,
  checkout behavior, loading, disabled, close, and error states while improving
  hierarchy, copy, selection feedback, and responsive layout.
- The design page exposes reviewable examples of both surfaces in the correct
  component and section catalogs.
- Repository workflow guidance and a focused PR guard make the new design-page
  and screenshot evidence requirements explicit and mechanically checkable.
- Desktop and mobile browser proof is captured from the design page and linked
  in the PR body.
- Focused tests, diff-aware verification, frontend review, coverage review,
  second-model UI review, CI, and the selected cross-cutting review gate pass
  for the exact PR head.

## Scope

- Hosted Web group usage-credit presentation and its focused tests.
- The `/design` component and section catalogs.
- Frontend PR workflow documentation, PR-body contract, and the narrowest
  repository-owned validation needed to enforce it.

## Constraints

- Do not change Stripe checkout authority, fixed prices, webhook-only credit
  fulfillment, member or group authorization, or billing state ownership.
- Use existing shadcn/Base UI primitives and Murph tokens; add no dependency or
  second design-system abstraction.
- Preserve unrelated working-tree and coordination-ledger changes.
- Keep screenshots free of private user data and direct personal identifiers.

## Tasks

1. Trace the current group top-up UI, shared component boundaries, design-page
   catalogs, tests, PR template, and workflow checks.
2. Extract the smallest reusable presentation components and redesign the live
   entry and amount-selection states without changing billing behavior.
3. Add component and full-section examples to `/design` with stable screenshot
   states and focused regression coverage.
4. Add the frontend design-proof rule to the durable workflow and implement a
   focused PR validation gate for design-page coverage plus screenshot links.
5. Render desktop and mobile proof, run required verification and audits, close
   the plan, commit, push, open the PR with screenshots, and clear all PR gates.

## Evidence

- The supplied screenshots show weak hierarchy, long repetitive copy, small
  body and control typography, excessive empty modal space, and an inactive
  primary action that reads as enabled.
- Existing product rules require warm precision, short earned copy, familiar
  controls, responsive proof, and shared components to appear on `/design`.
- Final Playwright proof at 1440×1000 and 390×844 verified the shared card,
  default amount dialog, selected/error recovery state, dialog containment,
  stacked locked-error actions, and absence of horizontal overflow. Six
  redacted screenshots were captured from the Sections design study.
- Full app diff verification passed 489 test files and 6,130 tests, plus hosted
  Web typecheck, lint with zero errors, dev smoke, and production build. Final
  focused proof passed 43 UI tests, 6 design-proof guard tests, and the 411-test
  repo-tool lane.
- The coverage audits added focused boundary assertions. The first frontend
  review found three actionable gaps in PR-body edit events, locked-error action
  containment, and visual-asset detection; all were fixed, directly proven,
  and the fresh frontend review returned `NO FINDINGS`.
- The required Fable UI double-check was attempted after the final rendered
  evidence stabilized and reported explicit usage-credit exhaustion. Per the
  completion workflow, no further Claude request was made and the completed
  Codex frontend review is the substitute.
Completed: 2026-07-22
