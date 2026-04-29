---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:subjective-eye-strain"
slug: "biomarkers/subjective-eye-strain"
title: "Subjective Eye Strain"
summary: "A self-rated eye discomfort, dryness, strain, headache, or visual-fatigue signal."
status: "draft"
quality: "usable"
aliases:
  - "eye strain"
  - "digital eye strain"
  - "subjective visual discomfort"
categories:
  - "vision"
  - "self-rating"
  - "evening-light-reduction"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:evening-light-reduction/red-light-glasses-before-bed"
measurementContexts:
  - "self_rating"
  - "symptom_log"
unit: "0-10 rating"
interpretationFrame:
  principle: "Subjective eye strain is a tolerability and claim-boundary signal, not proof that bedtime red glasses treat digital eye strain."
  caveat: "Ratings are context-sensitive and should be interpreted with screen time, task type, room lighting, and baseline symptoms."
---

Subjective Eye Strain is included so visual-discomfort findings in the evening-light evidence set can resolve to a conservative, user-reportable endpoint.
