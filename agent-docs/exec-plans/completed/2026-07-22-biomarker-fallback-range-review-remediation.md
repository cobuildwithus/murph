# Biomarker fallback range review remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Resolve the accepted final ReviewGPT findings on PR 871 without widening the
saved-biomarker result-page feature.

## Success criteria

- Every authored fallback uses the query projection's canonical unit.
- A specimen-specific fallback appears only when the imported result carries a
  matching normalized specimen kind; missing or different specimens fail closed.
- Source numeric or qualified reference text remains authoritative and blocks a
  fallback.
- Production-path tests cover normalization, browser-vault projection, and page
  fallback selection.
- Focused verification, canonical acceptance, final ReviewGPT remediation review,
  CI, and mergeability gates pass with no accepted finding.

## Scope

- Health Commons fallback-range contracts, sourced content, generated projection,
  and validation.
- Query browser-vault lab-result rows and saved biomarker detail-page selection.
- Focused contracts, Health Commons, query, and Web tests plus PR documentation.

## Constraints

- Keep source-reported ranges and flags authoritative.
- Carry only a coarse allowlisted specimen kind into the browser replica; do not
  expose raw imported specimen text or test-category metadata.
- Do not add profile age state, UI unit conversion, a dependency, or a second
  biomarker identity catalog.
- Withhold a fallback when its source requires context the page does not own.

## Tasks

1. Replace incompatible or age-conditioned fallbacks with exact canonical-unit,
   adult, specimen-specific intervals from authoritative laboratory sources.
2. Add structured eligible specimen kinds to the authored and generated contract.
3. Project a coarse normalized specimen kind into browser-vault lab-result rows
   and require an exact eligible match before fallback display.
4. Add production-faithful normalization/projection and page-selection tests.
5. Run focused and canonical verification, update the PR, and run final ReviewGPT
   remediation review against the exact pushed head.

## Accepted findings

- Calcium and total-protein fallbacks were authored in units that production
  normalization converts away, making those ranges unreachable.
- Applicability was prose-only, so a serum/plasma fallback could be selected for
  a result with a different or missing specimen, and age-conditioned ranges could
  appear without an authoritative age fact.

## Decisions

- Remove calcium rather than add age and sex state to a context-free result page.
- Retain only four Mayo Clinic Laboratories serum intervals whose published units
  exactly match the query projection's canonical units: chloride, LDH, phosphate,
  and total protein.
- Project only `serum`, `plasma`, or `null` into the browser replica. Raw specimen
  text and test-category metadata remain excluded, and unknown values fail closed.
- Keep legacy browser-replica parsing compatible by treating a missing additive
  `specimenKind` field as `null` while rejecting invalid present values.

## Evidence

- Focused contracts, Health Commons, query, and Web tests passed, including the
  canonical imported-event to normalized metric to browser replica to page path.
- Relevant package typechecks and Web lint passed; lint reported only pre-existing
  warnings and no errors.
- Frontend design proof passed 9/9. Desktop and mobile Playwright captures were
  refreshed for the biomarker overview and result-detail states and inspected.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed in Blacksmith
  Testbox `tbx_01ky69aqpvxxre54h2q5r5j5m1` on 2026-07-22.
- The staged diff passed `git diff --cached --check` and the privacy scan found no
  direct personal identifiers in the patch.
Completed: 2026-07-22
