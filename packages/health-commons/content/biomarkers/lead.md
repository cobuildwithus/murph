---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:lead
slug: biomarkers/lead
title: "Lead"
summary: "Blood lead measures recent circulating lead exposure, which matters because public-health action levels vary by age and context and are not boundaries of safety."
status: reviewed
quality: reviewed
aliases:
  - "blood-lead"
  - "blood-lead-level"
categories:
  - lab-metric
  - environmental-exposure
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "CDC uses 3.5 µg/dL as a blood lead reference value to identify children with levels higher than most US children; it is a population action reference, not a safe-versus-unsafe boundary."
      applicability: "Applies specifically to blood lead in children ages 1 through 5 in US public-health guidance; adult occupational, pregnancy, capillary-screening, and confirmatory venous contexts use additional guidance."
      numericValues:
        - label: "CDC childhood blood lead reference value"
          unit: "µg/dL"
          lowerBound:
            value: 3.5
            inclusive: true
      source:
        title: "Guidelines and Recommendations: Childhood Lead Poisoning Prevention"
        organization: "US Centers for Disease Control and Prevention"
        year: 2025
        sourceType: "regulatory_guidance"
        url: "https://www.cdc.gov/lead-prevention/php/guidelines/index.html"
---

Lead is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
