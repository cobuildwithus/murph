---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:hs-crp
slug: biomarkers/hs-crp
title: "hs-CRP"
summary: "High-sensitivity CRP measures low concentrations of an inflammation-related protein, which can add cardiovascular risk context when acute illness and other inflammatory causes are considered."
status: reviewed
quality: reviewed
aliases:
  - "crp"
  - "hscrp"
  - "hs_crp"
  - "high-sensitivity-crp"
  - "high_sensitivity_crp"
  - "c-reactive-protein"
categories:
  - lab-metric
  - inflammation-and-immune
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "The 2026 dyslipidemia guideline lists hs-CRP at or above 2.0 mg/L on more than one occasion as a cardiovascular risk-enhancing factor in selected prevention discussions."
      applicability: "Applies when repeat measurements are clinically appropriate and acute infection, injury, inflammatory disease, and recent strenuous exercise are not driving the result."
      numericValues:
        - label: "Cardiovascular risk-enhancing threshold"
          unit: "mg/L"
          lowerBound:
            value: 2.0
            inclusive: true
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

hs-CRP is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
