---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:total-globulin
slug: biomarkers/total-globulin
title: "Globulin"
summary: "Globulin reports the non-albumin portion of measured serum protein, which can add context about immune proteins and protein balance but is often calculated."
status: reviewed
quality: reviewed
aliases:
  - "globulin"
  - "globulin-total"
categories:
  - lab-metric
  - liver
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Globulin; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with the reporting assay, age, sex, symptoms, medications, alcohol, exercise, and related liver or blood-count results considered."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Globulin is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
