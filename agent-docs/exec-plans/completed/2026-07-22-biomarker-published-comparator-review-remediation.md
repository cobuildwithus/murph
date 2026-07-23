# Biomarker published comparator review remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

Resolve ReviewGPT round 2's review-induced assay-applicability finding by making
the authored range an explicitly named published comparator rather than implying
that it is the reporting laboratory's general reference range.

## Success criteria

- The UI labels authored context as a published adult comparator and states that
  it is not the reporting lab's range.
- The source label, exact canonical unit, adult coverage, and specimen eligibility
  remain visible and enforced.
- Source numeric or qualified ranges still win and imported flags remain unchanged.
- Production-path coverage proves an unrelated-lab serum result sees the explicit
  comparator meaning while urine and missing specimens fail closed.
- Desktop/mobile Playwright proof, focused and canonical verification, CI, and a
  later ReviewGPT correction round complete without an accepted finding.

## Constraints

- Do not add laboratory, assay, method, profile-age, or new persisted-state
  ownership.
- Keep raw specimen and test-category metadata outside the browser replica.
- Do not relabel the imported result or imply the comparator is its lab range.
- Preserve the exact first-reviewed-head baseline and recorded round-2
  retrospective decision.

## Tasks

1. Replace the misleading `General adult reference` UI meaning with an explicit
   published-comparator label and reporting-lab disclaimer.
2. Align Health Commons applicability copy and durable product/design contracts.
3. Update production-path, component, and design-study proof.
4. Refresh and inspect desktop/mobile Playwright evidence.
5. Run focused and canonical verification, commit/push, update the PR, and run
   ReviewGPT round 3 against the remediation delta.

## Review finding and retrospective

- Round 2 found that Mayo assay-documentation ranges were shown as a general
  adult reference for unrelated laboratories without assay authority.
- The PR retrospective chooses a named published comparator, explicitly not the
  reporting lab's range, using only the page's existing adult, unit, and coarse
  specimen facts. It rejects additional assay or laboratory matching machinery.

## Decisions

- Treat the authored range as a named `Published adult comparator`, never as the
  reporting laboratory's reference range.
- Show `not the reporting lab's range` beside the exact source label wherever
  the comparator is rendered.
- Keep the applicability gate deliberately small: exact canonical unit, adult
  coverage, and an eligible serum/plasma specimen are required; unknown or
  mismatched specimens fail closed.
- Preserve source numeric and qualified ranges as the first authority and never
  derive or overwrite imported result flags from the comparator.
- Keep the reporting laboratory in the production-path fixture intentionally
  unrelated to prove that the cross-laboratory comparison is disclosed rather
  than silently treated as assay-specific authority.

## Evidence

- ReviewGPT round 2: `RETROSPECTIVE_REQUIRED`; the review-induced applicability
  finding and approved decision were recorded on PR #871 before remediation.
- Product-experience review of the exact remediation and refreshed screenshots:
  `NO FINDINGS`.
- Focused web verification: 3 files / 50 tests and 3 files / 49 chart, page,
  UI, and design-study tests passed.
- Health Commons verification: typecheck, generated-artifact check, and 19 files
  / 90 tests passed.
- Web typecheck and lint passed; lint reported 11 unrelated existing warnings
  and zero errors. Targeted web lint passed.
- Frontend design proof passed 9/9 checks. Desktop and mobile reference-context
  and result-detail screenshots were captured with the repo Playwright harness
  and visually inspected, including the mobile source/disclaimer wrapping.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed in
  Blacksmith Testbox `tbx_01ky6c95jp4rdafk1t78g37x3y` with exit 0 in 5m28s.
Completed: 2026-07-22
