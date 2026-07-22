---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:ana-screen
slug: biomarkers/ana-screen
title: "ANA screen"
summary: "An ANA screen reports whether antinuclear antibody reactivity is detected by the named method, which can add autoimmune context but is not a diagnosis by itself."
status: reviewed
quality: reviewed
aliases:
  - "antinuclear-antibody-screen"
  - "antinuclear-antibodies-screen"
categories:
  - lab-metric
  - inflammation-and-immune
referenceGuidance:
  classification: qualitative
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: qualitative_interpretation
      guidance: "Preserve the reported category, titer, or narrative interpretation for ANA screen; Commons must not manufacture a numeric interval or translate an absent source flag into “in range.”"
      applicability: "Applies with assay method, symptoms, acute illness, medications, pretest context, and the reporting laboratory’s qualitative or numeric interpretation retained."
      source:
        title: "Antinuclear Antibodies (ANA)"
        organization: "American College of Rheumatology"
        year: 2025
        sourceType: "academic_reference"
        url: "https://rheumatology.org/patients/antinuclear-antibodies-ana"
---

ANA screen is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
