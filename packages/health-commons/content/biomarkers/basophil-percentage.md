---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:basophil-percentage
slug: biomarkers/basophil-percentage
title: "Basophils"
summary: "Basophil percentage measures basophils as a share of white blood cells, which can add differential-count context but can shift when other leukocyte populations change."
status: reviewed
quality: reviewed
aliases:
  - "basophils"
  - "basophils-percent"
  - "basophils-relative"
categories:
  - lab-metric
  - blood
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Basophils; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies to venous whole-blood CBC results with age, sex, pregnancy, altitude, analyzer, specimen handling, and the local reference population considered."
      source:
        title: "Complete Blood Cell Count with Differential, Blood"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/overview/9109"
---

Basophils is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
