---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:hba1c
slug: biomarkers/hba1c
title: "HbA1c"
summary: "HbA1c estimates average glucose exposure over roughly two to three months from glycated hemoglobin, which can add longer-term context while red-cell turnover and assay factors remain important."
status: reviewed
quality: reviewed
aliases:
  - "a1c"
  - "hb-a1c"
  - "hb-a1c-ngsp"
  - "hb-a1c-si"
  - "hba1c"
  - "hba1c-ngsp"
  - "hba1c-si"
  - "hemoglobin-a-1c"
  - "hemoglobin-a1c"
  - "hemoglobin_a1c"
categories:
  - lab-metric
  - blood-sugar
referenceGuidance:
  classification: generally_applicable_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "ADA decision guidance uses 5.7% through 6.4% for increased diabetes risk and at least 6.5% as a diabetes decision threshold, with confirmation unless hyperglycemia is unequivocal."
      applicability: "For nonpregnant people using an NGSP-certified assay; altered red-cell turnover, hemoglobin variants, recent blood loss or transfusion, pregnancy, and kidney disease can make HbA1c discordant."
      numericValues:
        - label: "Increased-risk interval"
          unit: "%"
          lowerBound:
            value: 5.7
            inclusive: true
          upperBound:
            value: 6.4
            inclusive: true
        - label: "Diabetes decision threshold"
          unit: "%"
          lowerBound:
            value: 6.5
            inclusive: true
        - label: "Diabetes decision threshold"
          unit: "mmol/mol"
          lowerBound:
            value: 48
            inclusive: true
      source:
        title: "2. Diagnosis and Classification of Diabetes: Standards of Care in Diabetes—2026"
        organization: "American Diabetes Association; Diabetes Care"
        year: 2026
        sourceType: "clinical_guideline"
        url: "https://diabetesjournals.org/care/article/49/Supplement_1/S27/163926/2-Diagnosis-and-Classification-of-Diabetes"
---

HbA1c is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
