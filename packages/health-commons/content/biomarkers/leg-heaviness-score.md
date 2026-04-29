---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:leg-heaviness-score"
slug: "biomarkers/leg-heaviness-score"
title: "Leg Heaviness Score"
summary: "A 0–10 self-rating of leg heaviness or comfort after exercise, standing, sitting, or travel-context exposure."
status: "draft"
quality: "usable"
aliases:
  - "leg heaviness score"
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
  principle: "Use the same context and timing when possible, such as evening after a standing day or within two hours after training."
  caveat: "Unexplained, one-sided, warm, red, painful, or worsening swelling is a safety signal, not a wellness metric."
---

Leg Heaviness Score is included so the pneumatic compression pants test can track a practical, user-reportable signal without turning mixed recovery evidence into a stronger clinical claim.
