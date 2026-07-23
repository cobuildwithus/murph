---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:total-protein
slug: biomarkers/total-protein
title: "Total Protein"
summary: "Total protein measures albumin plus globulin in serum or plasma, which can add context about hydration, protein balance, inflammation, liver function, and protein loss."
status: reviewed
quality: reviewed
aliases:
  - "protein-total"
  - "serum-total-protein"
categories:
  - lab-metric
  - liver
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  fallbackRanges:
    - label: "Mayo Clinic Laboratories serum reference interval"
      unit: "g/dL"
      eligibleSpecimenKinds:
        - serum
      lowerBound:
        value: 6.3
        inclusive: true
      upperBound:
        value: 7.9
        inclusive: true
      applicability: "For published adult comparison on serum results from adults when the saved result uses this exact unit and has no range; the source establishes this interval for people age 1 or older, this comparator is not the reporting laboratory's range, and source-laboratory flags and per-result ranges remain authoritative."
      source:
        title: "Protein, Total, Serum"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/Overview/8520"
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Total Protein; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with the reporting assay, age, sex, symptoms, medications, alcohol, exercise, and related liver or blood-count results considered."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Total Protein is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
