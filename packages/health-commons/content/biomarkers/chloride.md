---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:chloride
slug: biomarkers/chloride
title: "Chloride"
summary: "Chloride measures a major extracellular electrolyte, which can add fluid and acid-base context when interpreted with sodium, bicarbonate, kidney function, and clinical circumstances."
status: reviewed
quality: reviewed
aliases:
  - "serum-chloride"
categories:
  - lab-metric
  - electrolytes
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  fallbackRanges:
    - label: "Mayo Clinic Laboratories adult serum reference interval"
      unit: "mmol/L"
      eligibleSpecimenKinds:
        - serum
      lowerBound:
        value: 98
        inclusive: true
      upperBound:
        value: 107
        inclusive: true
      applicability: "For contextual fallback display on serum results from adults age 18 or older when the saved result uses this exact unit and has no range; source-laboratory flags and per-result ranges remain authoritative."
      source:
        title: "Chloride, Serum"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/Overview/8460"
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Chloride; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with specimen type and handling, hydration, albumin, kidney function, medications, acid-base context, calculation formula, and source laboratory interval retained."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Chloride is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
