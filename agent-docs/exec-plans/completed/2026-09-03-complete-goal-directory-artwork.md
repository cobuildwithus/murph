# Complete goal directory artwork and taxonomy

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Give every public goal a distinct, simple illustration and organize every
  category under plain, useful section labels with no more than 12 goal cards
  per section.

## Success criteria

- All 252 public goal route IDs resolve to a checked-in illustration.
- Nutrition, Strength, Mind, and Biomarkers use curated plain section labels;
  the existing Cardio, Sleep, and Life Stages taxonomies remain intact.
- Every section contains at most 12 cards, every goal appears exactly once,
  section labels are not links, and parent goals remain ordinary cards.
- New illustrations match the existing cream, sage, dark-green, and
  terracotta register; each is recognizable at card size and contains no text.
- Goal detail pages continue to reuse goal-specific card artwork and reserve
  category artwork for fallback only.
- Focused tests, Web typecheck, frontend design proof, complexity, SVG safety,
  privacy, and rendered desktop/mobile checks pass.

## Product UX Patch

- Outcome: people can scan a large category by intent without mistaking a
  category label for a selectable goal, while every goal gains a concrete
  visual cue.
- Reaches: signed-out and signed-in visitors browsing goal categories, search
  results, related-goal cards, and goal guides.
- Proof: verify exact category coverage and section sizes in tests, render each
  directory at desktop and phone widths, inspect illustration contact sheets at
  card size, and spot-check goal/card artwork continuity.

## Scope

- In scope: goal directory taxonomy data, category browse rendering tests, all
  missing goal SVGs, generated illustration manifest, changelog copy, visual
  proof, and focused verification.
- Out of scope: goal guide copy, new goals, runtime image generation, pushing,
  merging, or deployment.

## Constraints

- Keep taxonomy as one explicit source of truth and retain a visible catch-all
  for future unassigned goals.
- Reuse the existing Quiver SVG register and goal-card renderer; add no runtime
  file reads or dependencies.
- Avoid anatomy-heavy, clinical, stigmatizing, or abstract wellness imagery;
  prefer objects, activities, and compact scenes.
- Preserve the existing PR worktree and keep private identifiers and
  credentials out of generated files and commits.

## Tasks

1. Inventory all route IDs, existing assets, parent relationships, and current
   section sizes.
2. Extract and extend the curated directory taxonomy for all seven categories,
   ensuring complete one-time coverage and a maximum of 12 cards per section.
3. Assign a distinct concrete visual subject to each of the 179 missing goals
   and generate SVGs in bounded batches.
4. Review full-size and card-size contact sheets, then regenerate concrete
   failures only.
5. Copy accepted SVGs, regenerate the illustration manifest, and update the
   changelog entry.
6. Run focused tests, lint, typecheck, frontend design proof, complexity, SVG
   safety/coverage, privacy, and live desktop/mobile walkthroughs.
7. Close this plan and create one scoped commit on the existing PR branch.

## Decisions

- Use six sections each for Nutrition and Strength, eight for Biomarkers, and
  seven for Mind. Existing category section counts remain unchanged.
- Keep route assignment explicit because section membership is product
  taxonomy, not a title-matching heuristic.
- Move the static taxonomy out of the rendering component so the component
  remains focused on hierarchy and card layout.

## Outcome

- Added an explicit seven-category directory taxonomy that assigns all 252
  public goals exactly once across 44 plain, non-linked sections; every section
  contains between two and 12 goal cards.
- Replaced the old parent/child directory treatment with ordinary goal cards,
  while retaining bounded catch-all sections for future unassigned goals.
- Added 179 reviewed SVG illustrations, bringing goal-specific artwork coverage
  to 252 of 252 public goals. The accepted set uses concrete activities,
  equipment, food, devices, or compact scenes and remains legible at the real
  card thumbnail size.
- Regenerated the checked-in illustration manifest and updated the public
  changelog copy to describe full category grouping and artwork coverage.

## Verification

- Focused goal-page, visual, search, and client-privacy suites pass: 31 tests.
- Web TypeScript check and targeted ESLint pass.
- Frontend design proof passes: 12 tests.
- Cyclomatic complexity diff passes with no new debt.
- All 252 SVGs parse as XML and contain no text nodes, scripts, foreign objects,
  embedded images, JavaScript URLs, credentials, or local identifiers.
- Desktop and mobile browser walkthroughs pass for all seven category pages:
  all 252 card images load, desktop sections render in three columns, mobile
  sections render in one column, headers contain no links, the largest section
  contains 12 cards, and no page has horizontal overflow.
- `git diff --check` passes.

Completed: 2026-09-03
Completed: 2026-09-03
