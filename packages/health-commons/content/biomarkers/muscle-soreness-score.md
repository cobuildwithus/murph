---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:muscle-soreness-score"
slug: "biomarkers/muscle-soreness-score"
title: "Muscle Soreness Score"
summary: "A repeatable 0–10 self-rating of muscle soreness in the target legs or muscle group, used as the primary practical outcome for pneumatic compression pants."
status: "draft"
quality: "usable"
aliases:
  - "muscle soreness score"
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
  principle: "Compare the same time window and muscle group across baseline and intervention days."
  caveat: "Soreness is subjective and strongly affected by training load, novelty, sleep, expectation, and injury."
biomarker:
  direction:
    desired: lower_or_stable
    label: Lower soreness in the target muscle group is generally preferred for recovery.
---

Muscle Soreness Score is included so the pneumatic compression pants test can track a practical, user-reportable signal without turning mixed recovery evidence into a stronger clinical claim.
