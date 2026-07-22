---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:psa-total
slug: biomarkers/psa-total
title: "PSA total"
summary: "Total PSA measures free plus protein-bound prostate-specific antigen, which can add prostate context but varies with age, prostate volume, inflammation, procedures, medications, and assay."
status: reviewed
quality: reviewed
aliases:
  - "total-psa"
  - "prostate-specific-antigen-total"
categories:
  - lab-metric
  - prostate-health
referenceGuidance:
  classification: no_universal_range
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: evidence_limit
      guidance: "No universal numeric range is encoded for PSA total; use the named method, population, and source interpretation rather than a wellness “optimal” range."
      applicability: "Applies with age, prostate history, symptoms, medications, recent procedures or infection, assay, and the clinical reason for testing recorded."
      source:
        title: "Early Detection of Prostate Cancer: AUA/SUO Guideline"
        organization: "American Urological Association and Society of Urologic Oncology"
        year: 2023
        sourceType: "clinical_guideline"
        url: "https://www.auanet.org/guidelines-and-quality/guidelines/early-detection-of-prostate-cancer-guidelines"
---

PSA total is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
