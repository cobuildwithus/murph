---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:gfr-mdrd-af-amer
slug: biomarkers/gfr-mdrd-af-amer
title: "GFR MDRD Af Amer"
summary: "GFR MDRD Af Amer is a historical race-coefficient MDRD estimate, which matters mainly for preserving the original calculation rather than treating it as interchangeable with race-free eGFR."
status: reviewed
quality: reviewed
aliases:
  - "gfr-mdrd-african-american"
  - "mdrd-gfr-af-amer"
categories:
  - lab-metric
  - kidneys
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat GFR MDRD Af Amer as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies with equation or assay, age, body-size context, hydration, medications, chronicity, and urine findings recorded; the source result range and flag remain authoritative."
      source:
        title: "A Unifying Approach for GFR Estimation: Recommendations of the NKF-ASN Task Force"
        organization: "National Kidney Foundation and American Society of Nephrology; American Journal of Kidney Diseases"
        year: 2021
        sourceType: "consensus_statement"
        url: "https://pubmed.ncbi.nlm.nih.gov/34563581/"
        doi: "10.1053/j.ajkd.2021.08.003"
        pmid: "34563581"
---

GFR MDRD Af Amer is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
