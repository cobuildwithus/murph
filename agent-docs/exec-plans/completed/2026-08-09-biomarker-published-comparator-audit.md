# Biomarker published comparator audit

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

Audit every canonical saved-lab biomarker behind `/biomarkers`, expand the
reviewed published-comparator catalog where a portable adult serum interval is
truthful, and keep context-dependent measurements from acquiring misleading
fallback ranges merely because an imported result says `Reported`.

## Existing product behavior

- The reporting source's flag and per-result interval are authoritative.
- A Health Commons fallback is display-only context. It never changes the saved
  result flag or becomes the reporting laboratory's range.
- A fallback can render only when the latest comparable result has no usable
  source range, the canonical unit is an exact match, and the imported coarse
  specimen kind is explicitly eligible.
- The chart labels the context `Published adult comparator`, states that it is
  not the reporting lab's range, and uses neutral boundaries rather than the
  semantic source-range bands.
- Missing specimen context, a qualified source range, or a unit mismatch fails
  closed.

## Audit method

The audit started from all 115 canonical saved-lab identities covered by the
requested biomarker registry and reviewed their Health Commons classification,
unit, specimen requirements, calculation or assay identity, and the population
requirements attached to any numeric limits. A fallback was accepted only when
all of the following were true:

1. the value is a measured analyte rather than a named calculation or risk goal;
2. one interval covers the full adult population without sex, pregnancy,
   reproductive-stage, fasting, treatment, or risk stratification;
3. the published source names an eligible serum assay and Murph already has the
   exact canonical unit;
4. the result can still be presented honestly as cross-laboratory context with
   the reporting-lab disclaimer;
5. the interval does not convert a diagnostic or treatment threshold into a
   general reference range.

## Added comparators

The existing catalog contained chloride, LDH, phosphate, and total protein. The
audit adds four more Mayo Clinic Laboratories adult serum comparators:

| Biomarker | Exact unit | Published interval | Source |
| --- | --- | --- | --- |
| Sodium | mmol/L | 135–145 | Sodium, Serum; Mayo Clinic Laboratories |
| Potassium | mmol/L | 3.6–5.2 | Potassium, Serum; Mayo Clinic Laboratories |
| Carbon dioxide / bicarbonate | mmol/L | 22–29 | Bicarbonate, Serum; Mayo Clinic Laboratories |
| Total bilirubin | mg/dL | 0.0–1.2 | Bilirubin, Total, Serum; Mayo Clinic Laboratories |

Source catalog entries reviewed on 2026-08-09:

- https://www.mayocliniclabs.com/test-catalog/Overview/602353
- https://www.mayocliniclabs.com/test-catalog/Overview/602352
- https://www.mayocliniclabs.com/test-catalog/Overview/876
- https://www.mayocliniclabs.com/test-catalog/Overview/81785

Each authored range remains serum-only, exact-unit-only, and explicitly says
that source-laboratory flags and per-result ranges remain authoritative.

## Intentionally withheld fallbacks

The audit treats the following as correct omissions, not missing work:

| Measurements | Reason a portable fallback is unsafe |
| --- | --- |
| Calculated VLDL, calculated LDL, NIH LDL calculation | Formula identity and cardiovascular-risk context matter; decision thresholds are not reporting-lab reference intervals. |
| ApoB, LDL-C, triglycerides, hs-CRP and similar risk markers | Guideline limits are risk-enhancing factors, treatment goals, or decision thresholds rather than universal normal ranges. |
| POC troponin I | The upper reference limit is the assay-specific 99th percentile and can vary by instrument, generation, and sex. |
| BUN/creatinine ratio and anion gap | Both are calculations whose formula, input methods, albumin context, and local laboratory interval matter. |
| GFR MDRD African American and non-African American | These are historical named equations retained for provenance; current U.S. guidance recommends race-free eGFR equations rather than attaching a new fallback to legacy outputs. |
| Random urine albumin without creatinine | Concentration changes with hydration and urine concentration; albumin-to-creatinine ratio is the preferred portable assessment. |
| Immature granulocyte percentage and absolute count | Analyzer and local laboratory reference-population differences matter. |
| Estradiol, FSH, LH, prolactin | Sex, age, reproductive stage, pregnancy, time, medication, and assay context can change the relevant interval. |
| Omega-6 total, OmegaCheck total, and related proprietary fatty-acid outputs | Panel method and laboratory-specific interpretation are part of the result identity. |
| Creatinine, BUN, calcium, alkaline phosphatase, hemoglobin and other demographic intervals | Adult limits differ by sex, age, pregnancy, or other context that the portable comparator gate intentionally does not own. |
| Albumin, free T4 and other method-sensitive assays | Cross-method harmonization is insufficient for an exact portable display range under the current gate. |
| Mercury and other specimen-dependent exposure tests | The generic identity does not preserve the specimen or chemical species required for a numeric comparator. |

Supporting authorities include the ACC discussion of assay-specific troponin
99th-percentile limits, NIDDK guidance on race-free eGFR equations, and NIDDK
and National Kidney Foundation guidance preferring urine albumin-to-creatinine
ratio over raw urine albumin concentration:

- https://www.acc.org/Latest-in-Cardiology/ten-points-to-remember/2022/07/14/18/12/High-Sensitivity-CTn-and-2021-Chest-Pain
- https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations
- https://www.niddk.nih.gov/health-information/professionals/clinical-tools-patient-management/kidney-disease/identify-manage-patients/evaluate-ckd/assess-urine-albumin
- https://www.kidney.org/kidney-failure-risk-factor-urine-albumin-creatinine-ratio-uacr

## Architecture decision

Keep one authored source of truth: `referenceGuidance.fallbackRanges` in Health
Commons content. Do not add a web-only range table, infer intervals from the
member's current flag, convert guideline decision values into display ranges,
or add laboratory/assay matching machinery. The generated web artifact and
existing result-detail resolver continue to project and apply these ranges.

## Verification added

- Pin all eight authored comparator entities, exact bounds, exact units, source
  titles, source URLs, 2026 review year, and serum eligibility.
- Require every authored comparator to retain the reporting-lab authority
  disclaimer and avoid diagnostic, optimal, or wellness language.
- Expand explicit omission coverage across calculated lipids, legacy eGFR,
  random urine albumin, POC troponin, immature granulocytes, reproductive
  hormones, proprietary fatty-acid panels, anion gap, and other context-heavy
  measurements.
- Keep decision thresholds from becoming fallback ranges.

## Outcome

Murph now has eight reviewed portable published comparators. The expansion is
large enough to cover the common serum electrolyte/liver cases that were safe to
add, while the `Reported` measurements in the supplied example remain neutral
when the missing interval is genuinely assay-, formula-, demographic-, or
collection-dependent.
