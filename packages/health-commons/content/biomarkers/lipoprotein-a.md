---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:lipoprotein-a
slug: biomarkers/lipoprotein-a
title: "Lipoprotein(a)"
summary: "Lipoprotein(a) measures an inherited apoB-containing particle with apolipoprotein(a), which can add cardiovascular risk context when reported in assay-specific units."
status: reviewed
quality: reviewed
aliases:
  - "lp-a"
  - "lpa"
  - "lipoprotein(a)"
categories:
  - lab-metric
  - heart-and-lipids
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "The 2026 dyslipidemia guideline identifies at least 125 nmol/L or at least 50 mg/dL as risk-enhancing Lp(a) results; these are alternative assay-unit thresholds and must not be converted as exact equivalents."
      applicability: "Applies to Lp(a) cardiovascular risk assessment with assay units preserved; nmol/L particle concentration and mg/dL mass are not directly interchangeable because apo(a) isoform size affects conversion."
      numericValues:
        - label: "Risk-enhancing threshold in particle concentration"
          unit: "nmol/L"
          lowerBound:
            value: 125
            inclusive: true
        - label: "Risk-enhancing threshold in mass concentration"
          unit: "mg/dL"
          lowerBound:
            value: 50
            inclusive: true
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

Lipoprotein(a) is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
