---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ldl-chol-calc-nih
slug: biomarkers/ldl-chol-calc-nih
title: "LDL CHOL CALC (NIH)"
summary: "LDL CHOL CALC (NIH) estimates LDL cholesterol with the named NIH or Sampson equation, which matters because its formula-specific result is not interchangeable with other calculated LDL methods."
status: reviewed
quality: reviewed
aliases:
  - "ldl-cholesterol-calculated-nih"
  - "ldl-calc-nih"
  - "sampson-nih-ldl"
categories:
  - lab-metric
  - heart-and-lipids
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat LDL CHOL CALC (NIH) as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies to the named lipid analyte and method with fasting status, treatment, overall cardiovascular risk, and the source laboratory report retained."
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

LDL CHOL CALC (NIH) is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
