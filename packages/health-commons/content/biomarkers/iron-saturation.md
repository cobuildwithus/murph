---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:iron-saturation
slug: biomarkers/iron-saturation
title: "Iron saturation"
summary: "Iron saturation estimates the percentage of iron-binding sites occupied, which can add iron-status context but depends on serum iron, binding capacity, timing, and inflammation."
status: reviewed
quality: reviewed
aliases:
  - "iron-saturation"
  - "transferrin-saturation"
categories:
  - lab-metric
  - nutrients-and-fatty-acids
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat Iron saturation as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies only to the named specimen, assay, units, collection conditions, supplements, diet, inflammation, kidney function, and source laboratory interpretation."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Iron saturation is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
