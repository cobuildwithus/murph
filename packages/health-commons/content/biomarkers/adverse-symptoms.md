---
schemaVersion: "murph.commons.page.v1"
entityType: "biomarker"
key: "biomarker:adverse-symptoms"
slug: "biomarkers/adverse-symptoms"
title: "Adverse Symptoms"
summary: "A session safety log for symptoms, skin changes, neurologic symptoms, clot/PE red flags, discomfort, or device problems during pneumatic compression use."
status: "draft"
quality: "usable"
aliases:
  - "adverse symptoms"
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
unit: "symptom log"
interpretationFrame:
  principle: "Any severe, unusual, neurologic, skin-injury, clot/PE, or malfunction signal should override efficacy interpretation."
  caveat: "Absence of logged symptoms does not prove safety; small consumer recovery experiments cannot estimate rare adverse-event rates."
---

Adverse Symptoms is included so the pneumatic compression pants test can track a practical, user-reportable signal without turning mixed recovery evidence into a stronger clinical claim.
