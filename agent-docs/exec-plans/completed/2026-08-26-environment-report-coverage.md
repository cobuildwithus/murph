# Complete Environment report coverage and clarify first-run copy

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make the main Environment voice interview cover every condition counted by
  the report, so complete answers can reach 100% coverage.
- Make the first-run page state plainly explain what the member fills in and
  what useful report they receive.

## Success criteria

- Missing gradeable low-priority conditions appear in the main voice script.
- A complete main voice interview and report coverage use the same gradeable
  condition set.
- The first-run page removes the Habitat eyebrow, repeated page description,
  and redundant privacy label.
- The first-run headline, body, and CTA clearly promise an Environment report
  about sleep, air quality, and focus.
- Focused tests, TypeScript checks, desktop and phone browser proof, required
  specialist review, and exact-head CI pass.

## Scope

- In scope: Environment voice-script selection, regression tests, first-run
  Environment page copy and hierarchy, existing design representation.
- Out of scope: report scoring changes, catalog priority changes, new fields,
  assistant persistence changes, and visual redesign outside this first-run
  state.

## Constraints

- Technical constraints: reuse the catalog and existing interview field list;
  do not add another coverage owner or dependency.
- Product/process constraints: Product UX Product change. Preserve decline
  behavior, category-specific capture, accessibility, responsive layout, and
  existing report behavior for members with data.

## Risks and mitigations

1. Risk: The main interview starts asking optional or informational questions
   that do not affect the promised report coverage.
   Mitigation: include every gradeable condition regardless of priority, while
   keeping informational low-priority fields optional and outside the main
   completion set.
2. Risk: Copy promises more insight than the report provides.
   Mitigation: name only the existing grade, report, and practical checks.

## Tasks

1. Completed: align the main voice script with gradeable report coverage.
2. Completed: add regression tests for the two low-priority gradeable conditions and the
   complete-to-100% invariant.
3. Completed: remove redundant first-run labels and replace the headline, body, and CTA.
4. Completed: verify focused behavior, types, desktop and phone rendering, and the final
   diff.
5. Completed: run the required specialist ReviewGPT pass and exact-head CI.

## Decisions

- Keep the existing five topic groups and realtime interview. Change only field
  selection and copy.
- Use `Fill in my report` as the action. It states the task without repeating
  the result promised by the headline.
- Treat stored `null` values as missing, so an unanswered condition is asked
  again instead of appearing covered.
- Use one dynamic `Fill in the remaining N details` line for partial reports
  and rename the recommendation strip to the neutral `What to review next`.
- Keep the remaining-detail count in the partial-report action. The specialist
  review warned that a large count can look like a completion quota, but the
  member explicitly requested this single-line count. The card remains an
  optional continuation action outside onboarding.
- The member-started main voice walkthrough is the bounded exception to the
  normal context-only rule for low-priority gradeable conditions. Update the
  Habitat product spec in the same change.

## Verification

- Focused Environment voice/page tests: 118 passed across 8 files.
- Hosted Web TypeScript check: passed.
- Browser proof: empty, partial, and populated report states checked at desktop
  and 390×844 phone widths.
- Product UX Product change walkthrough: Ready. The zero-data and partial-report
  member journeys now state the task and outcome directly. No material
  exclusions or changes from the approved scope.
- Preliminary specialist ReviewGPT: completed on `5f279a90d9a0`. Prompt,
  frontend, and coverage lenses reported no findings. One Product UX finding
  about the explicit remaining-detail count was rejected for the reason above.
- Pull request evidence check: passed on `5f279a90d9a0`.
Completed: 2026-08-26
