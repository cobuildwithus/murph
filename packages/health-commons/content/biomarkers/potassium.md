---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:potassium
slug: biomarkers/potassium
title: "Potassium"
summary: "Potassium measures a key intracellular electrolyte in blood, which can add cardiac, kidney, and medication context while collection hemolysis can create misleading results."
status: reviewed
quality: reviewed
aliases:
  - "serum-potassium"
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
        value: 3.6
        inclusive: true
      upperBound:
        value: 5.2
        inclusive: true
      applicability: "For published adult comparison on serum results from adults age 18 or older when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, and source-laboratory flags and per-result ranges remain authoritative."
      source:
        title: "Potassium, Serum"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/Overview/602352"
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Potassium; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with specimen type and handling, hydration, albumin, kidney function, medications, acid-base context, calculation formula, and source laboratory interval retained."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Potassium is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
