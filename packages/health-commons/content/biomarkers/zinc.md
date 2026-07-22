---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:zinc
slug: biomarkers/zinc
title: "Zinc"
summary: "Zinc measures zinc concentration in the tested specimen, which can add nutrition context but is sensitive to specimen type, collection contamination, fasting, inflammation, and time of day."
status: reviewed
quality: reviewed
aliases:
  - "serum-zinc"
  - "plasma-zinc"
categories:
  - lab-metric
  - nutrients-and-fatty-acids
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Zinc; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies only to the named specimen, assay, units, collection conditions, supplements, diet, inflammation, kidney function, and source laboratory interpretation."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Zinc is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
