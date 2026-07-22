---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ldl-calculated
slug: biomarkers/ldl-calculated
title: "LDL Calculated"
summary: "LDL Calculated estimates LDL cholesterol from a lipid panel rather than measuring it directly, which matters because formula choice and triglyceride levels can change the result."
status: reviewed
quality: reviewed
aliases:
  - "calculated-ldl"
  - "ldl-c-calculated"
categories:
  - lab-metric
  - heart-and-lipids
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat LDL Calculated as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies to the named lipid analyte and method with fasting status, treatment, overall cardiovascular risk, and the source laboratory report retained."
      source:
        title: "2026 ACC/AHA/Multisociety Guideline on the Management of Dyslipidemia"
        organization: "American College of Cardiology, American Heart Association, and collaborating societies; Circulation"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001423"
        doi: "10.1161/CIR.0000000000001423"
---

LDL Calculated is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
