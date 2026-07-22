---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:psa-percent-free
slug: biomarkers/psa-percent-free
title: "PSA percent free"
summary: "Percent-free PSA calculates free PSA as a percentage of total PSA, which can add risk-stratification context in selected settings but has no universal standalone cutoff."
status: reviewed
quality: reviewed
aliases:
  - "percent-free-psa"
  - "free-psa-percent"
categories:
  - lab-metric
  - prostate-health
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat PSA percent free as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies with age, prostate history, symptoms, medications, recent procedures or infection, assay, and the clinical reason for testing recorded."
      source:
        title: "Early Detection of Prostate Cancer: AUA/SUO Guideline"
        organization: "American Urological Association and Society of Urologic Oncology"
        year: 2023
        sourceType: "clinical_guideline"
        url: "https://www.auanet.org/guidelines-and-quality/guidelines/early-detection-of-prostate-cancer-guidelines"
---

PSA percent free is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
