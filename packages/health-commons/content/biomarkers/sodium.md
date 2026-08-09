---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:sodium
slug: biomarkers/sodium
title: "Sodium"
summary: "Sodium measures the main extracellular electrolyte concentration, which primarily reflects water balance and can add hydration, kidney, endocrine, and medication context."
status: reviewed
quality: reviewed
aliases:
  - "serum-sodium"
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
        value: 135
        inclusive: true
      upperBound:
        value: 145
        inclusive: true
      applicability: "For published adult comparison on serum results from adults age 18 or older when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, and source-laboratory flags and per-result ranges remain authoritative."
      source:
        title: "Sodium, Serum"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/Overview/602353"
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Sodium; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with specimen type and handling, hydration, albumin, kidney function, medications, acid-base context, calculation formula, and source laboratory interval retained."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Sodium is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
