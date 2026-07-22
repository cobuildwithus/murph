---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:vldl-cholesterol-calculated
slug: biomarkers/vldl-cholesterol-calculated
title: "Calculated VLDL cholesterol"
summary: "Calculated VLDL cholesterol estimates cholesterol in very-low-density lipoproteins from other lipid values, which can add context only within the assumptions of the reporting formula."
status: reviewed
quality: reviewed
aliases:
  - "vldl-cholesterol-cal"
  - "calculated-vldl-cholesterol"
categories:
  - lab-metric
  - heart-and-lipids
referenceGuidance:
  classification: calculated_or_method_specific
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: method_note
      guidance: "Treat Calculated VLDL cholesterol as the output of its named calculation or method, retain the formula and inputs, and do not merge it with a similarly named measured or differently calculated result."
      applicability: "Applies to the named lipid analyte and method with fasting status, treatment, overall cardiovascular risk, and the source laboratory report retained."
      source:
        title: "Lipid Measurements in the Management of Cardiovascular Diseases: Practical Recommendations"
        organization: "National Lipid Association"
        year: 2021
        sourceType: "consensus_statement"
        url: "https://www.lipid.org/nla/lipid-measurements-management-cardiovascular-diseases-scientific-statement"
---

Calculated VLDL cholesterol is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
