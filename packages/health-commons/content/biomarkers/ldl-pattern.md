---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ldl-pattern
slug: biomarkers/ldl-pattern
title: "LDL pattern"
summary: "LDL pattern is a qualitative assay category describing the predominant LDL size distribution, which can add method-specific context without being converted into a numeric range."
status: reviewed
quality: reviewed
aliases:
  - "ldl-particle-pattern"
categories:
  - lab-metric
  - heart-and-lipids
referenceGuidance:
  classification: qualitative
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: qualitative_interpretation
      guidance: "Preserve the reported category, titer, or narrative interpretation for LDL pattern; Commons must not manufacture a numeric interval or translate an absent source flag into “in range.”"
      applicability: "Applies to the named lipid analyte and method with fasting status, treatment, overall cardiovascular risk, and the source laboratory report retained."
      source:
        title: "Lipoprotein Fractionation, Cardio IQ"
        organization: "HNL Lab Medicine and Quest Diagnostics"
        year: 2026
        sourceType: "assay_documentation"
        url: "https://www.hnl.com/test-directory/lipoprotein-fractionation-cardio-iq/carlf"
---

LDL pattern is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
