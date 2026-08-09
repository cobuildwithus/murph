---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:carbon-dioxide
slug: biomarkers/carbon-dioxide
title: "Carbon Dioxide"
summary: "Total carbon dioxide measures mainly bicarbonate in serum or plasma, which can add acid-base and respiratory context but depends on specimen handling and related electrolytes."
status: reviewed
quality: reviewed
aliases:
  - "CO2"
  - "carbon-dioxide"
  - "total-co2"
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
        value: 22
        inclusive: true
      upperBound:
        value: 29
        inclusive: true
      applicability: "For published adult comparison on serum results from adults age 18 or older when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, and source-laboratory flags and per-result ranges remain authoritative."
      source:
        title: "Bicarbonate, Serum"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/Overview/876"
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Carbon Dioxide; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with specimen type and handling, hydration, albumin, kidney function, medications, acid-base context, calculation formula, and source laboratory interval retained."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Carbon Dioxide is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
