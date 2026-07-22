---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:insulin
slug: biomarkers/insulin
title: "Insulin"
summary: "Insulin measures the hormone concentration at collection, which can help contextualize glucose handling but depends strongly on fasting state, timing, medications, and assay method."
status: reviewed
quality: reviewed
aliases:
  - "serum-insulin"
  - "fasting-insulin"
categories:
  - lab-metric
  - blood-sugar
referenceGuidance:
  classification: no_universal_range
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: evidence_limit
      guidance: "No universal numeric range is encoded for Insulin; use the named method, population, and source interpretation rather than a wellness “optimal” range."
      applicability: "Applies only with specimen, collection timing, fasting status, concurrent glucose, medications, and assay method recorded; the saved laboratory range and flag remain authoritative."
      source:
        title: "2. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026"
        organization: "American Diabetes Association; Diabetes Care"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://diabetesjournals.org/care/article/49/Supplement_1/S27/163926/2-Diagnosis-and-Classification-of-Diabetes"
---

Insulin is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
