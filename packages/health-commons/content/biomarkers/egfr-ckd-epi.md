---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:egfr-ckd-epi
slug: biomarkers/egfr-ckd-epi
title: "eGFR (CKD-EPI)"
summary: "eGFR using CKD-EPI estimates filtration from a named equation and patient variables, which can add kidney-function context while preserving the equation version and inputs."
status: reviewed
quality: reviewed
aliases:
  - "estimated-gfr-ckd-epi"
  - "e-gfr-ckd-epi"
categories:
  - lab-metric
  - kidneys
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat eGFR (CKD-EPI) as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies with equation or assay, age, body-size context, hydration, medications, chronicity, and urine findings recorded; the source result range and flag remain authoritative."
      source:
        title: "KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease"
        organization: "Kidney Disease: Improving Global Outcomes; Kidney International"
        year: 2024
        sourceType: "clinical_guideline"
        url: "https://kdigo.org/guidelines/ckd-evaluation-and-management/"
---

eGFR (CKD-EPI) is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
