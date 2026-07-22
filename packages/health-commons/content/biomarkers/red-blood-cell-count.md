---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:red-blood-cell-count
slug: biomarkers/red-blood-cell-count
title: "Red blood cells"
summary: "Red blood cells measure the number of erythrocytes per blood volume, which can add oxygen-carrying and marrow context alongside hemoglobin, hematocrit, and cell indices."
status: reviewed
quality: reviewed
aliases:
  - "rbc"
  - "red-blood-cell"
  - "red-blood-cells"
categories:
  - lab-metric
  - blood
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Red blood cells; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies to venous whole-blood CBC results with age, sex, pregnancy, altitude, analyzer, specimen handling, and the local reference population considered."
      source:
        title: "Complete Blood Cell Count with Differential, Blood"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/overview/9109"
---

Red blood cells is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
