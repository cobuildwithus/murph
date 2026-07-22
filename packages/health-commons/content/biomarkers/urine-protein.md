---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:urine-protein
slug: biomarkers/urine-protein
title: "Urine protein"
summary: "Urine protein reports whether or how much protein is detected in urine, which can add kidney context but may be qualitative, concentration-based, or method-specific."
status: reviewed
quality: reviewed
aliases:
  - "protein-urine"
  - "urine-protein-qualitative"
categories:
  - lab-metric
  - kidneys
referenceGuidance:
  classification: qualitative
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: qualitative_interpretation
      guidance: "Preserve the reported category, titer, or narrative interpretation for Urine protein; Commons must not manufacture a numeric interval or translate an absent source flag into “in range.”"
      applicability: "Applies with equation or assay, age, body-size context, hydration, medications, chronicity, and urine findings recorded; the source result range and flag remain authoritative."
      source:
        title: "KDIGO 2024 Clinical Practice Guideline for the Evaluation and Management of Chronic Kidney Disease"
        organization: "Kidney Disease: Improving Global Outcomes; Kidney International"
        year: 2024
        sourceType: "clinical_guideline"
        url: "https://kdigo.org/guidelines/ckd-evaluation-and-management/"
---

Urine protein is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
