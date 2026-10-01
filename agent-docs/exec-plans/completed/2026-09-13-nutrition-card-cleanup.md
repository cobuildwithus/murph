# Simplify nutrition fallback card presentation

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Outcome

Restore the compact native calorie and macro hierarchy for totals-only static
nutrition cards. Remove repeated bitmap explanations and the blanket provider
subcaption. Reuse the existing short date and meal-count caption.

## Scope and invariants

- Owners: Web NutritionCardImage and the pure operator-config Linq layout builder.
- Preserve all-null goals, no target ring or judgments, unknown nutrient values,
  exact snapshot encoding, optional introduction, and actual partial-data notice.
- No changes to assistant instructions, model inputs, delivery decisions,
  canonical meals/goals, Telegram details, or semantic text recovery.
- No new state, dependencies, abstractions, requests, or awaited operations.
- Current source comparison attributes the redundant blocks to the totals-only
  presentation branch introduced by #3347.

## Product UX

Patch. Reaches private iMessage static cards with complete totals and no goals,
explicit partial cards, and existing goal-aware/historical cards. The bitmap
shows mark, calories, and macros. The caption stays short; only actual partial
coverage or the already-selected optional introduction adds supporting copy.

## Tasks

1. Remove duplicate presentation at its existing owners and update owner docs.
2. Update focused renderer/layout expectations and the existing design study.
3. Run focused tests, relevant typechecks, complexity review, and inspect real PNGs.
4. Review the scoped diff, record evidence, close the plan, and commit locally.

## Verification

- PASS: `pnpm --dir packages/operator-config test test/assistant-response-cards.test.ts`
  (20 tests): layout captions, complete and partial totals, historical inputs,
  optional introduction, and unchanged text/Telegram semantics.
- PASS: `pnpm --dir apps/web test:prepared imessage-nutrition-card-image.test.tsx imessage-compact-table-card-raster.test.tsx changelog-page.test.tsx`
  (47 tests): renderer, real-font PNG bounds, unknown values, and release-note rendering.
- PASS: `pnpm --dir packages/operator-config typecheck`.
- PASS: `pnpm --dir apps/web typecheck`.
- PASS: focused ESLint for the changed Web renderer, design study, and test.
- PASS: `pnpm complexity:diff`; no hotspots above 20. Renderer maximum
  complexity fell from 19 to 15; no new abstraction or duplicate layout owner.
- Rendered the actual GET image route with an independent synthetic complete
  all-null-goal card. Inspected the 1200 by 539 PNG: mark, calorie value and unit,
  four macro labels and values; no header, disclaimer, goal ring, or clipping.
  A scratch ESM named-import probe initially failed on CJS interop; rerunning
  with the module's default export rendered successfully.
- Product UX: Ready for this local presentation patch. Complete cards have only
  the compact date/meal caption, explicit partial cards retain actual coverage,
  missing nutrients remain unknown, and the fixed introduction stays optional.
- Parent review: scoped diff and privacy readback pass. Assistant instructions,
  model-visible inputs, authoring, effect ownership and recovery are untouched;
  no live-model journey or final external review is needed for this pure
  presentation correction. No new repository-actionable Frog entry was needed.
- Changelog: `2026-09-13 / compact-nutrition-card-previews`.
- No production send, branch publication, or deployment was performed. Native
  Swift sources are outside this checkout; visual parity uses the existing
  native-layout design contract. Handset/provider composition remains unverified.
- Deploying the Web renderer removes bitmap copy; the runtime layout builder
  must also ship to remove the provider subcaption from newly sent cards.
  The envelope and route are unchanged, so either deployment order remains
  readable. Existing sent provider captions are immutable.
Completed: 2026-09-13
