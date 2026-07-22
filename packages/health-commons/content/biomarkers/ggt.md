---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ggt
slug: biomarkers/ggt
title: "GGT"
summary: "GGT measures gamma-glutamyl transferase activity, which can add hepatobiliary context but is influenced by alcohol, medications, metabolic factors, and assay range."
status: reviewed
quality: reviewed
aliases:
  - "gamma-glutamyl-transferase"
  - "gamma_glutamyl_transferase"
categories:
  - lab-metric
  - liver
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for GGT; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
      applicability: "Applies with the reporting assay, age, sex, symptoms, medications, alcohol, exercise, and related liver or blood-count results considered."
      source:
        title: "ACG Clinical Guideline: Evaluation of Abnormal Liver Chemistries"
        organization: "American College of Gastroenterology; American Journal of Gastroenterology"
        year: 2017
        sourceType: "clinical_guideline"
        url: "https://pubmed.ncbi.nlm.nih.gov/27995906/"
        doi: "10.1038/ajg.2016.517"
        pmid: "27995906"
---

GGT is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
