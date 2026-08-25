# Compact multi-workout response cards

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make a small multi-workout comparison legible at a glance in the existing
  app-absent iMessage response-card presentation, without adding a new card
  kind or changing workout data ownership.

## Product UX

- Effort: Patch.
- Outcome: a short comparison uses one compact shared-header grid and does not
  repeat every row in Linq's outer caption.
- Reaches: a private-direct member viewing a generic response card without the
  Messages extension, including Messages on macOS; native-extension and plain
  semantic-text paths keep their existing behavior.
- Proof: render a synthetic two-row, three-set comparison through the real
  image route and inspect the raster at transcript width; verify a genuinely
  wide table still uses the full-width stacked fallback.

## Success criteria

- The production renderer reproduces the tall stacked layout for a synthetic
  two-workout comparison before the change.
- The same card renders as a shared-header grid after the change, with every
  row and set visible in a materially shorter raster.
- Generic Linq chrome stops duplicating table rows already present in the
  bitmap; deterministic complete semantic text remains unchanged.
- Dense and overwide contract-valid tables remain complete and legible through
  the existing stacked fallback.
- Focused tests, Web typecheck, visual inspection, exact-head CI, and the
  required Product UX/frontend/coverage ReviewGPT lenses pass.

## Scope

- In scope: compact generic-grid typography and gutters, generic Linq card
  chrome, focused response-card tests, one member-visible changelog item, and
  current response-card documentation.
- Out of scope: workout identity/state, native Messages-extension rendering,
  card schemas, provider delivery ownership, or a new comparison-specific UI.

## Constraints

- Technical constraints: reuse V3 generic cards, the existing grid/stacked
  layout owner, the existing stateless image route, and the existing semantic
  text fallback. Preserve measured wrapping and image-path bounds.
- Product/process constraints: keep private feedback and the supplied
  screenshot out of committed fixtures and review artifacts; use only
  synthetic data. Keep the complete answer available when image rendering is
  unavailable.

## Risks and mitigations

1. Risk: compacting every generic table could make genuinely wide content too
   dense.
   Mitigation: change only the grid's density; retain the existing exact-width
   test and stacked fallback for content that still does not fit.
2. Risk: removing duplicated provider detail could weaken recovery.
   Mitigation: leave the deterministic semantic text and value-free text
   recovery unchanged; only remove rows duplicated under a successfully
   rendered image.

## Tasks

1. Reproduce the tall two-row, three-column layout through the real image owner.
2. Add a focused synthetic regression test that proves the compact boundary.
3. Compact the existing grid and remove redundant generic provider detail.
4. Render and inspect the corrected raster plus a deliberately overwide case.
5. Run focused tests/typecheck, complete the Product UX walkthrough, commit,
   push, and run the required PR review and CI gates.

## Decisions

- Do not add presentation selection heuristics or another card kind. The current
  generic grid already owns this layout; its density is the defect.
- Keep stacked fields as the overflow layout rather than truncating or shrinking
  arbitrary content.

## Verification

- Exact local reproduction: the supplied comparison rendered through the real
  image route at 1,200 × 1,446 before the change and 1,200 × 528 after it. The
  supplied private content remains only in ignored local artifacts.
- Safe visual proof: a synthetic comparison rendered through the same route at
  1,200 × 488 and was inspected at native resolution; all row and set values
  are visible in one shared-header grid.
- Regression proof: the full real-font raster suite passed (12 tests), the full
  response-card image suite passed (24 tests), and the affected operator-config
  suites passed (29 tests).
- Static proof: Web and operator-config typechecks passed; affected Web ESLint
  paths and `git diff --check` passed. Changelog generation and its nine-test
  page suite also passed after adding the member-visible entry.
- Browser-catalog capture: the existing design study now includes the synthetic
  comparison at desktop and mobile scales. Two local Playwright launches were
  unable to reach the repo health endpoint after Next reported ready, so the
  current-branch preview remains the reviewer-openable browser proof.
- Candidate: draft PR #2285 is open with the implementation commit and
  member-visible changelog item.
- Remaining gates: preliminary ReviewGPT, final ReviewGPT, exact-head CI, final
  parent review, plan closure, and current-base merge-tree.

## Product UX walkthrough

- Result: Ready.
- Person and entry point: a private-direct member receives a generic response
  card in an app-absent iMessage client after asking for a small workout
  comparison.
- Feedback and continuation: the first balloon contains the complete compact
  comparison; no extra action or session state is introduced.
- Exclusions: native Messages-extension cards and structured workout cards keep
  their existing renderers and progress chrome.
- Recovery: complete deterministic semantic text remains unchanged when the
  image cannot be delivered or the member requests the text version.
- Difference from plan: none. The patch reuses the existing grid/stacked owner
  and removes duplicated provider chrome without adding a card kind, heuristic,
  or state owner.
