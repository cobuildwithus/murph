---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ferritin
slug: biomarkers/ferritin
title: "Ferritin"
summary: "Ferritin measures an iron-storage protein, which can add iron-status context but also rises with inflammation, infection, liver injury, and other conditions."
status: reviewed
quality: reviewed
categories:
  - lab-metric
  - nutrients-and-fatty-acids
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "WHO uses ferritin below 15 µg/L to indicate iron deficiency in apparently healthy adults, while inflammation can require higher decision limits and concurrent inflammatory assessment."
      applicability: "Applies to serum or plasma ferritin in adults with inflammation, infection, liver disease, pregnancy, age, sex, and population context assessed; laboratory flags remain authoritative for the saved result."
      numericValues:
        - label: "Iron-deficiency decision limit in apparently healthy adults"
          unit: "µg/L"
          upperBound:
            value: 15
            inclusive: false
        - label: "Iron-deficiency decision limit in adults with infection or inflammation"
          unit: "µg/L"
          upperBound:
            value: 70
            inclusive: false
      source:
        title: "WHO Guideline on Use of Ferritin Concentrations to Assess Iron Status in Individuals and Populations"
        organization: "World Health Organization"
        year: 2020
        sourceType: "clinical_guideline"
        url: "https://www.who.int/publications/i/item/9789240000124"
---

Ferritin is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
