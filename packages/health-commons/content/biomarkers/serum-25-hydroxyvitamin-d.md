---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:serum-25-hydroxyvitamin-d
slug: biomarkers/serum-25-hydroxyvitamin-d
title: Serum 25-Hydroxyvitamin D
summary: "Serum 25-hydroxyvitamin D measures the main circulating vitamin D status marker, which can add bone and nutrition context while testing indications and target thresholds differ across guidance."
status: draft
quality: usable
aliases:
  - 25(OH)D
  - 25-hydroxyvitamin D
  - serum 25OHD
  - plasma 25-hydroxyvitamin D
  - vitamin D status
categories:
  - nutrition
  - clinical-lab
  - vitamin-d
  - supplements
relations:

  -
    type: related_protocol
    target: protocol_variant:vitamin-d-supplementation/daily-vitamin-d3-supplementation
  -
    type: cites
    target: source_artifact:pmid-38828931
  -
    type: cites
    target: source_artifact:pmid-37764770
  -
    type: cites
    target: source_artifact:pmid-12499343
measurementContexts:
  - fasted_or_routine_clinical_lab
  - baseline_and_8_to_12_week_retest
unit: nmol/L or ng/mL
interpretationFrame:
  principle: Compare the same assay/unit when possible, and interpret the change alongside baseline level, dose, adherence, season, sun exposure, BMI/body size, diet, and supplement stacking.
  caveat: A rise in 25(OH)D indicates changed vitamin D status, not guaranteed improvement in fractures, symptoms, mood, infections, or other clinical outcomes.
biomarker:
  shortName: 25(OH)D
  displayName: Serum 25-Hydroxyvitamin D
  unit: nmol/L or ng/mL
  valuePrecision: 1
  direction:
    desired: mixed_or_contextual
    label: Contextual range, not simply higher.
    nuance: Very low values can support repletion decisions, but higher is not automatically better and safety concerns rise with excessive intake or calcium abnormalities.
  trendDefaults:
    latestWindowDays: 90
    comparisonWindowDays: 90
    minimumPoints: 2
    aggregation: mean
  measurement:
    bestContext: Baseline lab before starting or changing dose, then a follow-up lab after roughly 8–12 weeks of stable daily dosing.
    howToMeasure:
      - Use the same lab and unit where possible.
      - Record whether the result is ng/mL or nmol/L; do not compare units without conversion.
      - Retest after a stable dosing window rather than after a few days.
      - Log dose, missed doses, other supplements, sun/UV exposure, travel, season, and major diet changes.
    confounders:
      - assay/unit differences
      - season and latitude
      - sun or UVB exposure
      - diet and fortified foods
      - BMI/body size
      - adherence
      - supplement stacking
      - kidney disease or calcium disorders
referenceGuidance:
  classification: no_universal_range
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: evidence_limit
      guidance: "No universal numeric range is encoded for Vitamin D; use the named method, population, and source interpretation rather than a wellness “optimal” range."
      applicability: "Applies only to the named specimen, assay, units, collection conditions, supplements, diet, inflammation, kidney function, and source laboratory interpretation."
      source:
        title: "Vitamin D for the Prevention of Disease: An Endocrine Society Clinical Practice Guideline"
        organization: "Endocrine Society; Journal of Clinical Endocrinology & Metabolism"
        year: 2024
        sourceType: "clinical_guideline"
        url: "https://www.endocrine.org/clinical-practice-guidelines/vitamin-d-for-prevention-of-disease"
    - kind: decision_limit
      guidance: "The National Academies concluded that 20 ng/mL, equivalent to 50 nmol/L, meets the needs of nearly all people for bone-health outcomes, while the 2024 Endocrine Society guideline found no outcome-specific threshold for routine testing in generally healthy populations."
      applicability: "This records a real scope difference rather than choosing a false consensus: the National Academies threshold addresses population bone-health adequacy, while the Endocrine Society guidance addresses disease prevention and routine testing in generally healthy people."
      numericValues:
        - label: "National Academies concentration meeting needs of nearly all people for bone health"
          unit: "ng/mL"
          lowerBound:
            value: 20
            inclusive: true
        - label: "National Academies concentration meeting needs of nearly all people for bone health"
          unit: "nmol/L"
          lowerBound:
            value: 50
            inclusive: true
      source:
        title: "Dietary Reference Intakes for Calcium and Vitamin D"
        organization: "National Academies of Sciences, Engineering, and Medicine"
        year: 2011
        sourceType: "academic_reference"
        url: "https://nap.nationalacademies.org/catalog/13050/dietary-reference-intakes-for-calcium-and-vitamin-d"
---

Serum 25-hydroxyvitamin D is the main outcome for Daily Vitamin D3 Supplementation because direct daily-D3 trials repeatedly measure a change in this biomarker over weeks to months.

Use it as a **status and response marker**, not as proof that symptoms or disease risks changed. Thresholds and target ranges differ across sources, and assay/unit differences can make comparisons noisy.
