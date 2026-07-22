---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:adjusted-calcium
slug: biomarkers/adjusted-calcium
title: "Adjusted Calcium"
summary: "Adjusted calcium estimates total calcium after applying an albumin-based correction, which can add context only within the named formula because it is not directly measured calcium."
status: reviewed
quality: reviewed
aliases:
  - "corrected-calcium"
  - "albumin-adjusted-calcium"
categories:
  - lab-metric
  - electrolytes
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat Adjusted Calcium as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies with specimen type and handling, hydration, albumin, kidney function, medications, acid-base context, calculation formula, and source laboratory interval retained."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Adjusted Calcium is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
