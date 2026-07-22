---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:fib4
slug: biomarkers/fib4
title: "FIB-4"
summary: "FIB-4 combines age, AST, ALT, and platelet count to estimate liver-fibrosis risk, which can support triage only within the population and age limits of the calculation."
status: reviewed
quality: reviewed
aliases:
  - "fibrosis-score-fib4"
  - "fibrosis-score-fib-4"
  - "fib-4"
categories:
  - lab-metric
  - liver
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat FIB-4 as the output of its named calculation, retain age, AST, ALT, platelet count, and formula provenance, and do not merge it with a measured fibrosis marker or differently calculated score."
      applicability: "Applies only when the reported value uses the standard FIB-4 inputs and formula; acute illness and conditions that independently alter aminotransferases or platelets can distort the estimate."
      source:
        title: "AASLD Practice Guidance on the Clinical Assessment and Management of Nonalcoholic Fatty Liver Disease"
        organization: "American Association for the Study of Liver Diseases; Hepatology"
        year: 2023
        sourceType: "clinical_guideline"
        url: "https://pubmed.ncbi.nlm.nih.gov/36727674/"
        doi: "10.1097/HEP.0000000000000323"
        pmid: "36727674"
    - kind: decision_limit
      guidance: "In primary-care evaluation of adults ages 35 through 65 with suspected or established metabolic fatty liver disease, AASLD uses FIB-4 below 1.3 as a lower-risk triage result, at least 1.3 for secondary assessment, and above 2.67 as a reason to consider direct specialist referral."
      applicability: "These are approximate care-pathway thresholds for the stated liver-risk population, not a general reference range; FIB-4 has low accuracy below age 35, uses different guidance above age 65, and should not be used during acute illness."
      numericValues:
        - label: "Lower-risk primary-care triage interval, ages 35–65"
          unit: "index"
          upperBound:
            value: 1.3
            inclusive: false
        - label: "Secondary-assessment threshold, ages 35–65"
          unit: "index"
          lowerBound:
            value: 1.3
            inclusive: true
        - label: "Direct-referral consideration threshold, ages 35–65"
          unit: "index"
          lowerBound:
            value: 2.67
            inclusive: false
      source:
        title: "AASLD Practice Guidance on the Clinical Assessment and Management of Nonalcoholic Fatty Liver Disease"
        organization: "American Association for the Study of Liver Diseases; Hepatology"
        year: 2023
        sourceType: "clinical_guideline"
        url: "https://pubmed.ncbi.nlm.nih.gov/36727674/"
        doi: "10.1097/HEP.0000000000000323"
        pmid: "36727674"
---

FIB-4 is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
