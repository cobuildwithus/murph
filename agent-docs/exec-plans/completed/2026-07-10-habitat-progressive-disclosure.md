# Distill Habitat with progressive disclosure

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make Habitat substantially faster to scan by collapsing category detail and
  replacing bullet-like evidence lists with aligned, icon-led data rows.

## Success criteria

- The default page shows eight compact category summaries with category icon,
  coverage, direct target score, missing count, and the highest-value next
  focus.
- Full scenes, equipment, targets, known facts, unknown facts, and skipped facts
  remain accessible through native inline disclosure.
- Evidence uses aligned rows rather than visual bullet lists.
- Desktop and mobile remain readable and keyboard-accessible.

## Scope

- `/environment` information density, disclosure behavior, category iconography,
  evidence layout, concise copy, and focused tests.

## Constraints

- Reuse existing Habitat data and visuals, add no dependency or client state,
  preserve direct-only scoring, and preserve unrelated working-tree changes.

## Tasks

1. Reduce page-level explanatory copy.
2. Convert category modules to compact native disclosures.
3. Replace evidence lists with aligned status/data rows.
4. Verify browser behavior, focused tests, Impeccable detector, and required
   frontend reviews.

## Verification

- Focused tests: 17/17 passed across the Habitat page and browser-vault page
  coverage.
- Full apps/web typecheck: passed.
- Focused ESLint and `git diff --check`: passed.
- Impeccable detector: `[]` for the changed Habitat UI files.
- Browser QA: compact and expanded states verified at 1440×1000 and 390×844
  without runtime errors. Enter opened the outer disclosure and Space opened the
  nested facts disclosure.
- Coverage-write replaced brittle string-only checks with DOM proof for eight
  closed outer disclosures and eight closed nested disclosures.
- Frontend-review findings were accepted: summary content is phrasing-only,
  statuses have visible labels, Next wraps in full, and secondary fact counts
  are named distinctly.
- The fresh final frontend review found no remaining P0, P1, or P2 issues;
  neutral `No open gaps` copy avoids implying a health grade for unscored data.
Completed: 2026-07-10
