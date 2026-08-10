# Biomarker fallback catalog expansion

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

Expand PR #1491 beyond the first eight page-authored published comparators while
preserving the rule that the reporting laboratory's own flag and range always
win.

## Requirement

When the latest comparable laboratory result includes a usable source range,
Murph uses that exact range. When the result has no source range, Murph may show
a reviewed Health Commons comparator only when its unit and coarse specimen kind
match exactly. A published comparator remains neutral context and never changes
the imported result's status.

## Outcome

The result-detail route now has reviewed comparator coverage for 30 canonical
biomarker identities through 33 exact-unit records:

- 8 existing page-authored comparators: chloride, LDH, phosphate, total protein,
  sodium, potassium, bicarbonate / total carbon dioxide, and total bilirubin;
- 22 additional catalog identities with 25 exact-unit records.

The additional catalog covers:

- albumin and anion gap;
- generic eGFR and 2021 CKD-EPI eGFR;
- total cholesterol, LDL-C, generic calculated LDL, NIH-calculated LDL,
  non-HDL cholesterol, triglycerides, ApoB, lipoprotein(a), and hs-CRP;
- ferritin and 25-hydroxyvitamin D;
- total iron-binding capacity and iron saturation;
- zinc and methylmalonic acid;
- rheumatoid factor, thyroglobulin antibodies, and thyroid peroxidase
  antibodies.

Vitamin D, total iron-binding capacity, and iron saturation include explicit
exact-unit alternatives used by current imports. No frontend unit conversion is
introduced.

## Architecture

Health Commons remains the only owner of reviewed public comparator values.
Page-specific comparators stay in biomarker frontmatter. The expanded common
set lives in one typed package catalog at
`packages/health-commons/src/biomarker-fallback-ranges.ts`, including exact
bounds, units, specimen eligibility, applicability text, and primary source
metadata.

The server-side biomarker context resolver asks Health Commons for catalog-backed
ranges and appends them after any page-authored ranges. It owns no values. The
existing detail resolver still enforces the complete priority order:

1. use a normalized numeric reporting-lab range when present;
2. preserve and display any qualified source range text without substituting a
   published comparator;
3. otherwise select one exact-unit, eligible-specimen Health Commons comparator;
4. otherwise remain neutral.

The chart continues to label published context separately, state that it is not
the reporting lab's range, and use neutral dashed boundaries rather than source
range shading.

## Source review

The common catalog uses current primary assay documentation from Mayo Clinic
Laboratories plus the 2020 WHO ferritin guideline. The reviewed values include
ordinary adult assay intervals and clearly labeled clinical or desirable-value
comparators. Clinical decision values are never presented as the reporting
laboratory's interval or as an individualized treatment goal.

The source set covers:

- Mayo albumin, basic metabolic panel, creatinine/eGFR, total cholesterol, lipid
  panel, ApoB, lipoprotein(a), hs-CRP, vitamin D, TIBC, iron saturation, zinc,
  methylmalonic acid, rheumatoid factor, and thyroid antibody documentation;
- WHO ferritin guidance for the apparently healthy adult iron-deficiency
  boundary, with inflammation explicitly called out as a different context.

## Deliberate omissions

The expansion still withholds comparators when the current private projection
cannot prove applicability. Important omissions include:

- POC troponin I without an assay or instrument identity;
- HbA1c and glucose when pregnancy, red-cell, assay, or fasting/random context is
  required;
- BUN/creatinine ratio and historical race-based MDRD outputs;
- raw random urine albumin without creatinine;
- sex- or age-dependent CBC, kidney, liver, hormone, and prostate intervals;
- immature granulocytes without analyzer context;
- proprietary OmegaCheck and related fatty-acid outputs;
- any unitless or unit-mismatched result.

These cases remain visible as saved results; they simply do not receive an
invented portable interval.

## Verification

- A Health Commons test validates all 22 common-catalog entity keys and 25
  exact-unit records through the shared fallback-range schema.
- The test requires bounded values, source locators, exact specimen eligibility,
  reporting-lab authority language, and the absence of wellness or diagnostic
  framing.
- A Web integration test proves page-authored and catalog-backed ranges merge
  through the production route resolver, including current calculated and
  parenthetical units.
- The integration test also proves POC troponin I, HbA1c, and free testosterone
  remain without fallback ranges under the current applicability boundary.

Executable repository verification is owned by exact-head GitHub CI for this
connector-authored patch.
