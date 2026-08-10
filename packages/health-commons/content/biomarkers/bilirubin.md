---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:bilirubin
slug: biomarkers/bilirubin
title: Bilirubin
summary: "Total bilirubin measures conjugated and unconjugated bilirubin together, which can add context about red-cell breakdown, liver processing, and bile flow."
status: draft
quality: usable
categories:
- health-marker
- protein-floor
relations:
-
  type: related_protocol
  target: protocol_variant:high-protein-intake/protein-floor-high-protein-intake
unit: clinical lab
interpretationFrame:
  principle: Compare baseline and intervention windows using the same measurement method and context.
  caveat: This marker is part of interpretation or safety context; abnormal clinical labs or symptoms should be reviewed with an appropriate clinician.
biomarker:
  direction:
    desired: stable
    label: Stay within the lab reference range; large excursions should be reviewed with a clinician.
referenceGuidance:
  classification: source_range_only
  reviewStatus: reviewed
  use: context_only
  fallbackRanges:
    - label: "Mayo Clinic Laboratories adult serum reference interval"
      unit: "mg/dL"
      eligibleSpecimenKinds:
        - serum
      lowerBound:
        value: 0
        inclusive: true
      upperBound:
        value: 1.2
        inclusive: true
      applicability: "For published adult comparison on serum results from adults age 18 or older when the saved result uses this exact unit and has no range; this comparator is not the reporting laboratory's range, and source-laboratory flags and per-result ranges remain authoritative."
      source:
        title: "Bilirubin, Total, Serum"
        organization: "Mayo Clinic Laboratories"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.mayocliniclabs.com/test-catalog/Overview/81785"
  items:
    - kind: reference_interval
      guidance: "Use the reporting laboratory’s reference interval for Total bilirubin; Commons does not replace the source range because reference limits depend on assay, specimen, and reference population."
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

Optional liver-context safety lab interpreted by a clinician when relevant.

For the Protein Floor protocol, treat this marker as an exposure, outcome, interpretation, or safety-context signal according to the protocol test plan rather than as a stand-alone diagnosis.
