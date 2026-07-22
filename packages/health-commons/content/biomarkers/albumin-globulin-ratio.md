---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:albumin-globulin-ratio
slug: biomarkers/albumin-globulin-ratio
title: "Albumin/Globulin Ratio"
summary: "The albumin-to-globulin ratio compares two protein fractions, which can add context about their balance but inherits variation in both measured or calculated components."
status: reviewed
quality: reviewed
aliases:
  - "a-g-ratio"
  - "albumin-to-globulin-ratio"
categories:
  - lab-metric
  - liver
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat Albumin/Globulin Ratio as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies with the reporting assay, age, sex, symptoms, medications, alcohol, exercise, and related liver or blood-count results considered."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

Albumin/Globulin Ratio is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
