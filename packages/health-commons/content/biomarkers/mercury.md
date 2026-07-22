---
schemaVersion: murph.commons.page.v1
entityType: biomarker
key: biomarker:mercury
slug: biomarkers/mercury
title: "Mercury"
summary: "Mercury measures mercury in a specified specimen, which can add exposure context only when chemical form, specimen, timing, and likely exposure source are considered."
status: reviewed
quality: reviewed
categories:
  - lab-metric
  - environmental-exposure
referenceGuidance:
  classification: no_universal_range
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: evidence_limit
      guidance: "No universal numeric range is encoded for Mercury; use the named method, population, and source interpretation rather than a wellness “optimal” range."
      applicability: "Applies only with specimen, chemical form, age, pregnancy, exposure source and timing, occupation, and jurisdiction-specific public-health guidance recorded."
      source:
        title: "Toxicological Profile for Mercury"
        organization: "Agency for Toxic Substances and Disease Registry"
        year: 2024
        sourceType: "regulatory_guidance"
        url: "https://www.atsdr.cdc.gov/peer-review-agenda/php/toxicological-profiles/mercury.html"
---

Mercury is presented as contextual education only; the saved result’s source flag and per-result reference range remain authoritative for result display.
