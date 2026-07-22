---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:mean-corpuscular-volume
slug: biomarkers/mean-corpuscular-volume
title: "Mean corpuscular volume"
summary: "Mean corpuscular volume estimates average red-cell size, which can help characterize red-cell patterns when interpreted with hemoglobin, RDW, and clinical context."
status: reviewed
quality: reviewed
aliases:
  - "mcv"
  - "mean-cell-volume"
  - "mean-corpuscular-volume"
categories:
  - lab-metric
  - blood
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Mean corpuscular volume; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies to venous whole-blood CBC results with age, sex, pregnancy, altitude, analyzer, specimen handling, and the local reference population considered."
      source:
        title: "Complete Blood Cell Count with Differential, Blood"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/overview/9109"
---

Mean corpuscular volume is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
