# Normalize biomarker display units

Status: completed
Created: 2026-07-20

## Goal

Show each biomarker history in one canonical unit whenever its saved numeric
results and numeric reference ranges can be converted safely.

## Success criteria

- Supported biomarkers render normalized values consistently in the overview,
  summary, chart, comparison, and all-results list.
- Numeric reference ranges, including common text-only lab ranges, are converted
  to the same canonical unit as the result.
- Qualitative ranges and unit-incompatible custom results remain visible without
  being converted or treated as comparable.
- The supplied Albumin history renders `49 g/L` as `4.9 g/dL` and its `34 - 50`
  range as `3.4 to 5 g/dL`.
- Focused tests, diff-aware verification, browser proof, and required completion
  reviews pass.

## Scope

- In scope: shared browser-vault lab-result presentation selection, safe numeric
  reference-range parsing and conversion, biomarker list/detail rendering, and
  focused package and web coverage.
- Out of scope: rewriting canonical vault records, guessing conversions for
  unknown units, changing lab flags, or redesigning the biomarker page.

## Constraints

- Keep raw lab-reported values and reference text unchanged in the canonical
  vault and browser-replica source rows.
- Use existing metric definitions and normalization ownership; add no persisted
  state, dependency, or client-only conversion table.
- Preserve qualitative and incompatible results rather than hiding them.
- Keep private reproduction data out of committed files and review artifacts.

## Risks and mitigations

1. Risk: parsing narrative reference text as a numeric range.
   Mitigation: accept only anchored numeric range or one-sided-boundary shapes;
   otherwise retain the original text unchanged.
2. Risk: converting the value but leaving its reference range on the reported
   scale.
   Mitigation: present normalized bounds only when every numeric boundary maps
   to the same normalized unit; otherwise retain the reported range and unit.
3. Risk: custom analytes with unrelated units are made falsely comparable.
   Mitigation: keep the existing incompatible-history path and normalize only
   rows whose metric owner proves a target unit.

## Tasks

1. Add focused query tests for normalized result presentation and reference
   ranges, including the supplied Albumin shape and qualitative fallbacks.
2. Implement shared range parsing/conversion at the browser biomarker selector
   boundary.
3. Render normalized fields consistently across list and detail surfaces and
   update the explanatory copy.
4. Run focused and diff-aware verification, direct browser proof, required
   specialist audits, parent review, commit, PR, CI, and ReviewGPT.

## Evidence

- The supplied private vault contains seven Albumin results across `g/L` and
  `g/dL`; its latest value and text-only range reproduce the inconsistent
  display shown in the screenshot.
- A private aggregate-only scan of the supplied vault found zero biomarker
  histories with mixed canonical units after the final normalization rules;
  no raw rows or direct identifiers were persisted.
- Owner coverage passed for health metrics (63 tests) and query (559 tests),
  scenario integrity passed for 204 scenarios, and the final hosted-web verify
  passed 5,936 tests with 148 skips, lint with zero errors, dev smoke, and the
  production build.
- `coverage-write` added structured-range and fail-closed fallback coverage.
  `frontend-review` found one comparator-semantics issue in one-sided chart
  lines; the chart now withholds those lines while keeping the exact comparator
  in summary/history, and the re-review returned no findings.
- The broad diff-aware lane typechecked every affected owner and reverse
  dependent, then an unrelated assistant-engine test process exhausted Node's
  4 GB heap. The required owner-coverage fallback above completed green.
- Rendered desktop/mobile inspection could not run because no browser surface
  was attached. The required Fable and Opus review attempts were also blocked
  by an expired Claude Code OAuth session; neither gap was treated as passing.
Updated: 2026-07-20
Completed: 2026-07-20
