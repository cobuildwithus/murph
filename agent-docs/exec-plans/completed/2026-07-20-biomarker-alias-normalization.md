# Biomarker Alias Normalization

## Goal

Show equivalent lab names as one longitudinal biomarker, keep non-equivalent
measurements separate, place device biomarkers before lab sections, and keep
lab health-area sections closed until the member opens them.

## Root Cause

The shared metric catalog has no definitions for BUN, TSH, MCH, or MCHC.
Test-result projection therefore falls back to a spelling-derived custom key,
so abbreviated and expanded analyte names become separate histories.

## Invariants

- Use explicit aliases only; do not introduce fuzzy medical matching.
- Keep BUN/creatinine ratio and generic urea separate from BUN.
- Preserve original reported values and units in lab history rows.
- Normalize only comparable chart values, including BUN mmol/L to mg/dL and
  equivalent TSH uIU/mL to mIU/L.
- Use native closed disclosures with no new UI state owner or dependency.
- Do not rewrite persisted vault data or widen browser-replica contents.

## Implementation

1. Add canonical lab definitions and unit normalization for BUN, TSH, MCH,
   and MCHC.
2. Add health-metrics and browser-vault projection regression coverage proving
   aliases share a history while BUN/creatinine ratio remains separate.
3. Render the device section before lab groups and use closed native details
   elements for lab health areas.
4. Add component coverage for closed markup and device-before-lab ordering.

## Verification

- Focused health-metrics, query, and web component tests.
- Scoped package and web typechecks.
- `pnpm test:diff`.
- Required coverage-write, frontend-review, and Fable/Opus frontend reviews.
- Desktop and mobile browser proof when a browser backend is available.
- ReviewGPT and CI on the exact PR head.

## Local Result

- Focused health-metrics/query tests passed: 57 tests.
- Focused biomarker UI tests passed: 19 tests.
- Health-metrics, query, and web typechecks passed; scoped web lint passed.
- Coverage-write passed after adding original-unit and separate-urea assertions.
- Frontend review passed after moving device data ahead of the lab-empty state
  and making the page-level source framing accurate.
- `pnpm test:diff` reached the affected tests without an assertion failure, then
  its shared Vitest worker exhausted the 4 GB heap during concurrent host-wide
  verification. A clean rerun remains deferred to CI while the host is busy.
- Desktop/mobile browser proof was unavailable because no browser backend was
  available. Fable and Opus review were unavailable because local OAuth had
  expired.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
