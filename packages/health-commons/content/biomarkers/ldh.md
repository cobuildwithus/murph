---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ldh
slug: biomarkers/ldh
title: "LDH"
summary: "LDH measures lactate dehydrogenase activity from many tissues, which can add nonspecific tissue-injury context but is sensitive to hemolysis, exercise, illness, and assay range."
status: reviewed
quality: reviewed
aliases:
  - "lactate-dehydrogenase"
  - "lactic-dehydrogenase"
categories:
  - lab-metric
  - muscle-and-tissue
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for LDH; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with assay, exercise, muscle mass, symptoms, medications, hemolysis, and timing recorded; the reporting laboratory’s interval remains authoritative."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

LDH is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
