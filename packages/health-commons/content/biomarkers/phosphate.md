---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:phosphate
slug: biomarkers/phosphate
title: "Phosphate"
summary: "Phosphate measures inorganic phosphorus in blood, which can add bone, kidney, parathyroid, nutrition, and cellular-shift context and varies with age and timing."
status: reviewed
quality: reviewed
aliases:
  - "phosphorus"
  - "serum-phosphate"
categories:
  - lab-metric
  - electrolytes
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  fallbackRanges:
    - label: "CSCC harmonized adult reference interval"
      unit: "mmol/L"
      lowerBound:
        value: 0.8
        inclusive: true
      upperBound:
        value: 1.5
        inclusive: true
      applicability: "For contextual fallback display on serum or plasma results from adults ages 19 through 79 when the saved result uses this exact unit and has no range; the interval was harmonized from Canadian data, and source-laboratory flags and per-result ranges remain authoritative."
      source:
        title: "Best practice guidelines on reference interval harmonization in Canada: Evidence-based recommendations from the CSCC working group on reference interval harmonization (CSCC WG-hRI)"
        organization: "Canadian Society of Clinical Chemists"
        year: 2025
        sourceType: "consensus_statement"
        url: "https://cscc-sccc.ca/wp-content/uploads/Best-practice-guidelines-on-reference-interval-harmonization-in-Canada.pdf"
        doi: "10.1016/j.clinbiochem.2025.110986"
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Phosphate; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with specimen type and handling, hydration, albumin, kidney function, medications, acid-base context, calculation formula, and source laboratory interval retained."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Phosphate is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
