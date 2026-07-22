---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:lymphocyte-percentage
slug: biomarkers/lymphocyte-percentage
title: "Lymphocytes"
summary: "Lymphocyte percentage measures lymphocytes as a share of white blood cells, which can add immune context but may change when other leukocyte populations shift."
status: reviewed
quality: reviewed
aliases:
  - "lymphocyte"
  - "lymphocyte-percent"
  - "lymphocyte-pct"
  - "lymphocyte_pct"
  - "lymphocyte-percentage"
  - "lymphocytes-percent"
  - "lymphocytes-pct"
  - "lymphocytes"
categories:
  - lab-metric
  - blood
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Lymphocytes; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies to venous whole-blood CBC results with age, sex, pregnancy, altitude, analyzer, specimen handling, and the local reference population considered."
      source:
        title: "Complete Blood Cell Count with Differential, Blood"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/overview/9109"
---

Lymphocytes is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
