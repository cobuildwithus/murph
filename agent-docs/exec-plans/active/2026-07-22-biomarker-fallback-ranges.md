# Biomarker fallback reference ranges

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Remove the redundant `Results over time` heading and single-result helper
  sentence from saved biomarker result pages.
- Plot source-reported one-sided numeric limits, including `<`, `<=`, `>`, and
  `>=`, instead of withholding them from the chart.
- When a comparable numeric result has no usable source range, show a clearly
  labeled, sourced Health Commons fallback interval or one-sided bound when a
  reasonable general reference can be defended.

## Success criteria

- Source-reported ranges remain primary, including exact comparator semantics.
- Authored fallbacks never relabel the source result or replace its source flag;
  they appear only when the latest comparable result has no usable numeric lab
  range and are labeled as general reference context.
- ReviewGPT researches the requested saved-lab biomarker inventory and returns
  scoped authored fallback ranges only where a defensible range or one-sided
  bound exists, with applicability and primary/authoritative source evidence.
- Focused contracts, Health Commons, query, and web tests prove bounded,
  upper-only, lower-only, source-first, fallback, and no-fallback behavior.
- Desktop and mobile browser proof, canonical verification, required product
  and UI reviews, the preliminary specialist pass, final ReviewGPT, CI, and
  mergeability gates complete with no accepted finding.

## Scope

- Health Commons biomarker guidance contracts, authored biomarker pages,
  generated web projections, and deterministic content coverage.
- Saved biomarker result page context, chart labeling, and focused tests.
- Matching measured-biomarker and design-system documentation.

## Constraints

- Keep the imported source flag and per-result reference range authoritative.
- Do not infer a diagnosis, an `In range` status, or an optimal target from a
  fallback.
- Do not choose among sex-, age-, pregnancy-, fasting-, specimen-, assay-, or
  risk-specific ranges without a fallback whose authored applicability makes
  the page's general display use defensible.
- Match fallbacks to the chart's comparable unit exactly; do not add frontend
  unit-conversion logic or a second biomarker identity catalog.
- Add no dependency, persisted member state, runtime owner, or generated
  artifact to version control.

## Tasks

1. Trace the chart, source-range normalization, Health Commons guidance schema,
   generated projection, and requested biomarker content coverage.
2. Add the smallest explicit fallback-range contract and generated projection
   seam, then consume it source-first on the saved result page.
3. Remove the two requested copy elements and admit exact one-sided source
   comparators to the chart overlay.
4. Ask ReviewGPT for a scoped, attachment-based content patch covering every
   requested lab biomarker where a reasonable fallback can be sourced; inspect
   and apply only validated authored content and tests.
5. Add focused regression proof and update durable UI/product contracts.
6. Run canonical verification, rendered desktop/mobile proof, required local
   product review, Claude UI double-check, preliminary specialist ReviewGPT,
   parent final review, final ReviewGPT, CI, and mergeability checks.
7. Close the plan through `scripts/finish-task`, push the final head, and keep
   the worktree while the PR remains open.

## Decisions

- Use a dedicated authored fallback-range field rather than guessing from
  generic decision thresholds. Existing contextual thresholds may describe a
  disease or treatment region whose bound direction is the opposite of a
  general reference interval.
- A usable latest source range wins. A fallback is eligible only for the exact
  comparable chart unit and only when the latest comparable row has no usable
  numeric lab range.
- One-sided source comparators are precise numeric limits, not ambiguous
  qualifiers. Preserve their `<`, `<=`, `>`, or `>=` label while plotting the
  bound as one dashed line.

## Evidence

- The current chart component already renders a one-sided bound, but the page
  resolver rejects normalized ranges carrying comparator metadata, so a source
  range such as `<5.7%` remains ledger-only.
- The existing Health Commons guidance model stores sourced numeric decision
  values but has no explicit marker for a safe general display fallback. Using
  the first numeric value would misread examples such as a deficiency region as
  a normal interval.
- ReviewGPT audited all 115 requested saved-lab entities and returned only five
  context-safe, exact-unit adult serum/plasma fallbacks from the 2025 CSCC
  harmonization guideline: calcium, chloride, LDH, phosphate, and total protein.
  The other candidates require context this page does not own, such as age,
  sex, pregnancy, fasting, specimen, assay, treatment, or risk category.
- Focused contracts, Health Commons, and Web tests plus affected typechecks pass
  on the implementation. The first broad diff-aware lane passed its guards,
  affected typechecks, and several reverse-dependent suites before unrelated
  CLI expansion/session tests simultaneously reached their 60-second timeout
  under shared-host contention.
- The first preliminary specialist ReviewGPT attempt was invalid: the guard
  rejected a sub-7.5-minute response, and the response correctly identified
  missing rendered desktop/mobile evidence. After the base advanced, the task
  rebased onto the new design-proof contract and added source-limit and fallback
  states to the Sections catalog. The user explicitly authorized local
  Playwright capture and requested a durable workflow clarification that a
  missing in-app Browser attachment must not block design proof when Playwright
  can reach the local catalog; rendered evidence and the valid preliminary retry
  remain open.
- Two screenshot-bearing preliminary retries were rejected for completing below
  the repository's 7.5-minute minimum. A third retry cleared the duration and
  model guards but returned `INVALID`: the guarded ZIP named ignored evidence
  copies that its pruned `audit-packages` directory did not include, and omitted
  the frontend lens's required `agent-docs/FRONTEND.md`. The next retry uses the
  supported `.artifacts/review-gpt` root. The packager now always includes the
  required frontend guidance and stages every validated evidence image into the
  guarded review-context directory so the manifest cannot name an ignored file
  that the ZIP scanner omitted.
- The next duration-valid retry proved the four packaged images were readable
  and then returned `INVALID` because the frontend packet still omitted root
  `PRODUCT.md`. The packager now always supplies the complete frontend context
  trio required by the repository: `agent-docs/FRONTEND.md`, `PRODUCT.md`, and
  `DESIGN.md`.
