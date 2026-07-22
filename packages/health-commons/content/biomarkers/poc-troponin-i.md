---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:poc-troponin-i
slug: biomarkers/poc-troponin-i
title: "POC Troponin I"
summary: "Point-of-care troponin I measures cardiac troponin I with a specific rapid assay, which can matter when interpreted against that assay’s cutoff, timing, serial change, and clinical context."
status: reviewed
quality: reviewed
aliases:
  - "troponin-i-poc"
  - "point-of-care-troponin-i"
categories:
  - lab-metric
  - heart-and-lipids
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Use the sex-specific 99th-percentile upper reference limit supplied for the exact point-of-care troponin I assay when available; values are not interchangeable across assays, and myocardial-infarction assessment requires a rise or fall pattern plus evidence of ischemia rather than one result alone."
      applicability: "Applies only to the named assay, instrument, specimen, sampling time, and population for which its upper reference limit was established; serial sampling, symptoms, electrocardiography, kidney function, and the source laboratory flag remain part of interpretation."
      source:
        title: "Fourth Universal Definition of Myocardial Infarction (2018)"
        organization: "ESC, ACC, AHA, and WHF; Journal of the American College of Cardiology"
        year: 2018
        sourceType: "consensus_statement"
        url: "https://www.jacc.org/doi/10.1016/j.jacc.2018.08.1038"
        doi: "10.1016/j.jacc.2018.08.1038"
---

POC Troponin I is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
