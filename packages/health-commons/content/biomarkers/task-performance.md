---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:task-performance"
slug: "biomarkers/task-performance"
title: "Task Performance"
summary: "A task-specific performance or error signal used when an intervention may change attention, perception, or execution."
status: "draft"
quality: "usable"
aliases:
  - "task performance"
  - "task errors"
categories:
  - "function"
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
  principle: "For red-light glasses, task performance mainly supports stop rules and task exclusions where tinted lenses could make ordinary tasks less safe."
  caveat: "A home protocol should not generalize task-performance findings beyond the specific task and lighting context."
---

Task Performance is included so evening-light appraisals can reference performance-sensitive safety contexts without creating a broad cognitive-performance claim.
