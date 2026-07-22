# Biomarker UI and sourced reference guidance

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Prototype and approve a calmer, denser biomarker index and result-detail
  graph on `/design`, promote it to the production `/biomarkers` routes, then
  add sourced one-sentence descriptions and contextual
  reference guidance to the authored Health Commons biomarker pages needed by
  the saved-lab experience.

## Success criteria

- `/design?tab=sections` shows a complete desktop and mobile-ready biomarker
  index study with device readings, search and status controls, scannable
  health-area disclosures, and clear flagged-first results.
- The production `/biomarkers` index and lab-result detail routes use the
  approved hierarchy with live private data, while preserving auth, source
  flags, exact values, comparators, units, and empty/error behavior.
- The result-detail study shows the latest finding, a readable longitudinal
  plot, explicit source/lab reference context, and comparator-safe history
  without inferred trend copy or dashboard clutter.
- ReviewGPT returns evidence-backed threshold guidance and one plain-language
  sentence for every requested marker, with uncertainty, population, assay,
  sex, age, fasting, and unit caveats preserved instead of flattened into one
  universal healthy range.
- Authored Health Commons biomarker pages carry the reviewed sentence and
  structured contextual guidance needed by future UI consumers; generated
  catalog artifacts remain build outputs.
- Focused UI tests, Health Commons verification, truthful diff verification,
  browser proof, required frontend and coverage audits, second-model UI review,
  ReviewGPT, CI, and parent final review complete with no accepted finding.

## Scope

- In scope: `/design` biomarker studies, the production `/biomarkers` index and
  lab-result detail presentation, their shared chart/list seams, focused tests, authored Health
  Commons biomarker content/schema/generator changes required for descriptions
  and contextual ranges, and matching durable design/product documentation.
- Out of scope: overriding source-reported lab flags, diagnosing a member from
  a result, silently applying one population's thresholds to another, changing
  canonical lab identity or unit-conversion ownership.

## Constraints

- Keep source-reported flags authoritative in the saved-lab index; contextual
  research guidance is explanatory content, not a replacement reference range.
- Use official guidance, consensus guidelines, primary literature, and lab or
  assay documentation as appropriate. Record when no universal threshold is
  defensible.
- Preserve exact reported values, comparators, units, source ranges, and
  provenance. Do not plot qualitative or boundary results as exact numbers.
- Reuse the existing Murph paper system and shared components. Add no new
  frontend dependency, state owner, or health-data persistence path.

## Risks and mitigations

1. Risk: a polished graph implies more certainty than the evidence supports.
   Mitigation: label source ranges explicitly, keep excluded results visible in
   history, and distinguish source ranges from contextual guidance.
2. Risk: one-size-fits-all ranges are medically misleading.
   Mitigation: require per-marker applicability notes and allow a reviewed
   `no universal range` result rather than forcing numeric bounds.
3. Risk: bulk authored content becomes generic or inconsistent.
   Mitigation: ReviewGPT supplies sourced drafts; the parent checks schema,
   representative content, deterministic generation, and catalog verification.
4. Risk: the design study drifts from production data contracts.
   Mitigation: reuse production value/chart primitives and cover the study's
   interaction and responsive structure with focused tests and browser proof.

## Tasks

1. Trace the current biomarker index, result-detail chart, Health Commons page
   schema, and `/design` study seams; define the smallest design-only prototype.
2. Rebuild the `/design` list and detail studies around one editorial notebook
   hierarchy, including responsive and qualitative/boundary states.
3. Apply the approved presentation to the production `/biomarkers` index and
   private lab-result detail routes without copying synthetic data.
4. Send the exact requested marker inventory to ReviewGPT for deep sourced
   research, one-sentence descriptions, contextual thresholds, caveats, and an
   attachment-based patch for authored Health Commons pages.
5. Validate and apply the returned content/schema changes without overriding
   source flags or inventing universal thresholds.
6. Run focused tests, Health Commons verification, canonical diff verification,
   local desktop/mobile browser proof, required audits, and parent final review.
7. Close the plan with a scoped commit, push the task branch, open a PR, start
   ReviewGPT with CI on the exact head, and resolve every accepted finding.

## Decisions

- Stage the new interaction and visual hierarchy on `/design` first. The
  production route changed only after the user inspected the rendered proposal
  and explicitly asked to promote it; the restored pill filters remain.
- Omit verbose chart-explanation and comparator-rationale copy at the user's
  request. Exact comparator results remain visible in history and are still
  excluded from numeric plots.
- Keep controls and rows literal and scannable: centered pill contents with
  source-status dots, compact result-status rails, “From the lab” section copy,
  no inferred trend headline, and a full-width result ledger. On mobile,
  device summaries clamp to two lines while their icons remain visible.
- Route the individual-result “Chat with Murph” action through the existing
  contact resolver with a marker-specific draft. Only the public biomarker
  display name enters the compose URL; member values, dates, sources, ranges,
  and flags do not.
- Store research-backed descriptions and contextual guidance in authored Health
  Commons pages, not in browser runtime state or a frontend-only lookup table.
- Treat a lab's own reported reference range as the primary result-specific
  context. Cross-source guidance may explain the result but cannot relabel it.
- Collapse the 122 requested labels into 120 authored entities only where two
  labels are true aliases: MPV/Mean Platelet Volume and CO2/Carbon Dioxide.
  Keep explicit resolver mappings for the other production metric names so UI
  labels, canonical metric keys, and Commons entities do not drift.
- Record reviewed guidance even when no safe universal numeric interval exists.
  The completed research classifies 120 entities as generally applicable
  numeric (1), conditional numeric (11), calculated or method-specific (17),
  qualitative (3), source-range-only (52), or no universal range (36). Numeric
  bounds are structured only for the 14 entities where the evidence supports
  them; the remaining pages preserve assay, specimen, population, unit, and
  source-range constraints rather than manufacturing wellness targets.
- Keep the design fixture explicitly synthetic. The supplied health record is
  a visual reference only; its member-specific values and flags do not belong
  in committed source or durable task artifacts.

## Verification

- ReviewGPT research completed on the requested inventory with the configured
  Pro model and the exact completion marker. It covered 122 requested labels,
  resolved them to 120 authored entities, produced one reviewed sentence for
  each entity, and supplied contextual guidance plus source locators for every
  page. The deterministic coverage test proves all requested names, mappings,
  aliases, classifications, sources, comparators, and device entities.
- `pnpm --dir packages/health-commons verify` passed: typecheck, 18 files and
  85 tests, and deterministic generation check.
- The final canonical `pnpm test:diff ...` passed dependency policy, workspace
  boundaries, affected typechecks and package tests, 6,044 hosted-web tests,
  hosted-web dev smoke/lint/production build, 1,848 Cloudflare node tests, the
  Workers test, and package-boundary checks.
- `pnpm verify:acceptance` completed with exit code 0, including workspace
  typechecks, doc gardening, artifact hygiene, package coverage thresholds,
  hosted-web verification and production build, and Cloudflare verification.
- Focused web verification passed 51 biomarker tests; scoped web ESLint and web,
  Contracts, and health-metrics typechecks passed. The coverage-write audit
  added regression proof for the signed-out chat fallback, result rails/filter
  dots, and contradictory or unsourced guidance rejection.
- Desktop (1440 by 1000) and mobile (390 by 844) Playwright captures of the
  public `/design?tab=sections` study were inspected after client rendering.
  The device/lab headings match, mobile icons and two-line summaries remain
  legible, and the result plot uses the available width without the previous
  left gutter. The final frontend-review pass reported zero actionable
  findings.
Completed: 2026-07-21
