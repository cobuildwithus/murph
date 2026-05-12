---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:visual-fatigue"
slug: "biomarkers/visual-fatigue"
title: "Visual Fatigue"
summary: "A self-rated tired-eyes or visual-fatigue signal after screen, reading, or low-light tasks."
status: "draft"
quality: "usable"
aliases:
  - "visual fatigue"
  - "tired eyes"
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
  principle: "Visual fatigue can be logged as tolerability context but should not be used to claim that bedtime glasses treat eye strain."
  caveat: "Screen duration, task difficulty, sleep debt, and room lighting can dominate this rating."
biomarker:
  direction:
    desired: lower_or_stable
    label: Less visual fatigue is the goal.
---

Visual Fatigue is a conservative endpoint for evening-light source appraisals that discuss tired-eyes or visual-discomfort outcomes.
