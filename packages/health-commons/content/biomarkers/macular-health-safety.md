---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:macular-health-safety"
slug: "biomarkers/macular-health-safety"
title: "Macular Health Safety"
summary: "A claim-boundary endpoint for retinal or macular-health safety claims around light-filtering eyewear."
status: "draft"
quality: "usable"
aliases:
  - "macular health safety"
  - "retinal health safety"
categories:
  - "vision"
  - "safety"
  - "evening-light-reduction"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:evening-light-reduction/red-light-glasses-before-bed"
measurementContexts:
  - "safety_boundary"
  - "clinical_context"
unit: "claim boundary"
interpretationFrame:
  principle: "Use this endpoint to keep red-light-glasses pages from implying retinal protection, macular-disease prevention, or eye-care treatment."
  caveat: "Consumer bedtime eyewear experiments cannot establish macular-health benefit or safety for eye disease."
---

Macular Health Safety is a guardrail endpoint for evening-light-reduction research. It supports conservative claim language rather than a user-run outcome target.
