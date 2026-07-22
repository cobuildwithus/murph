---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:psa-free
slug: biomarkers/psa-free
title: "PSA free"
summary: "Free PSA measures the unbound fraction of prostate-specific antigen, which can add context alongside total PSA but depends on assay, age, prostate conditions, medications, and clinical purpose."
status: reviewed
quality: reviewed
aliases:
  - "free-psa"
  - "prostate-specific-antigen-free"
categories:
  - lab-metric
  - prostate-health
referenceGuidance:
  classification: no_universal_range
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: evidence_limit
      guidance: "No universal numeric range is encoded for PSA free; use the named method, population, and source interpretation rather than a wellness “optimal” range."
      applicability: "Applies with age, prostate history, symptoms, medications, recent procedures or infection, assay, and the clinical reason for testing recorded."
      source:
        title: "Early Detection of Prostate Cancer: AUA/SUO Guideline"
        organization: "American Urological Association and Society of Urologic Oncology"
        year: 2023
        sourceType: "clinical_guideline"
        url: "https://www.auanet.org/guidelines-and-quality/guidelines/early-detection-of-prostate-cancer-guidelines"
---

PSA free is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
