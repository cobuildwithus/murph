---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:perceived-recovery-score"
slug: "biomarkers/perceived-recovery-score"
title: "Perceived Recovery Score"
summary: "A 0–10 self-rating of how recovered or ready the legs feel, used as a subjective recovery signal rather than a performance guarantee."
status: "draft"
quality: "usable"
aliases:
  - "perceived recovery score"
categories:
  - "self-rating"
  - "recovery"
  - "intermittent-pneumatic-compression"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants"
measurementContexts:
  - "self_rating"
  - "session_log"
unit: "0–10 score"
interpretationFrame:
  principle: "Track trend across repeated sessions instead of one especially good or bad day."
  caveat: "Readiness can improve even when objective performance does not, and it can be confounded by mood, sleep, stress, and training load."
biomarker:
  direction:
    desired: higher_or_stable
    label: Feeling more recovered or ready is the goal.
---

Perceived Recovery Score is included so the pneumatic compression pants test can track a practical, user-reportable signal without turning mixed recovery evidence into a stronger clinical claim.
