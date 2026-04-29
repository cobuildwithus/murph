---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:visual-performance"
slug: "biomarkers/visual-performance"
title: "Visual Performance"
summary: "A task-safety endpoint for contrast, color, motion, acuity, and navigation performance while wearing light-filtering eyewear."
status: "draft"
quality: "usable"
aliases:
  - "visual performance"
  - "visual task performance"
categories:
  - "vision"
  - "safety"
  - "evening-light-reduction"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:evening-light-reduction/red-light-glasses-before-bed"
measurementContexts:
  - "task_context"
  - "safety_boundary"
unit: "task-specific assessment"
interpretationFrame:
  principle: "Reduced visual performance is a reason to remove glasses before driving, cooking, stairs, tools, cycling, or unfamiliar low-light navigation."
  caveat: "This endpoint is not a home diagnostic measure; it is a safety boundary for tasks where tinted lenses may impair perception."
---

Visual Performance keeps evening-light protocols explicit about tasks where red or amber eyewear may make the user less safe.
