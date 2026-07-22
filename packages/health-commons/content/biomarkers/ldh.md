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
  fallbackRanges:
    - label: "CSCC harmonized adult reference interval"
      unit: "U/L"
      lowerBound:
        value: 122
        inclusive: true
      upperBound:
        value: 235
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
