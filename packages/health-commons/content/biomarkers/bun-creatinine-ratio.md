---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:bun-creatinine-ratio
slug: biomarkers/bun-creatinine-ratio
title: "BUN/Creatinine Ratio"
summary: "The BUN-to-creatinine ratio combines two blood measurements, which can add hydration and kidney context but inherits the limitations of both inputs and the reporting calculation."
status: reviewed
quality: reviewed
aliases:
  - "bun-creatinine-ratio"
  - "blood-urea-nitrogen-creatinine-ratio"
categories:
  - lab-metric
  - kidneys
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat BUN/Creatinine Ratio as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies with equation or assay, age, body-size context, hydration, medications, chronicity, and urine findings recorded; the source result range and flag remain authoritative."
      source:
        title: "Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory (EP28-A3c)"
        organization: "Clinical and Laboratory Standards Institute and IFCC"
        year: 2020
        sourceType: "consensus_statement"
        url: "https://clsi.org/shop/standards/ep28/"
---

BUN/Creatinine Ratio is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
