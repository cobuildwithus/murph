---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:aaafoundation-acute-sleep-deprivation-crash-risk-2016-12-01"
slug: "sources/consistent-wake-time/aaafoundation-acute-sleep-deprivation-crash-risk-2016-12-01"
title: "Acute Sleep Deprivation and Risk of Motor Vehicle Crash Involvement"
summary: "Canonical Consistent Wake Time source used for safety boundaries, supervision boundaries, or implementation cautions: Acute Sleep Deprivation and Risk of Motor Vehicle Crash Involvement."
status: "draft"
quality: "usable"
categories:
  - "consistent-wake-time"
  - "safety-boundaries"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:consistent-wake-time/consistent-wake-time"
  -
    type: "parent_family"
    target: "experiment_family:consistent-wake-time"
source:
  kind: "web_page"
  title: "Acute Sleep Deprivation and Risk of Motor Vehicle Crash Involvement"
  url: "https://aaafoundation.org/research/acute-sleep-deprivation-risk-motor-vehicle-crash-involvement/"
researchEvidence:
  designKind: "other"
  designLabel: "technical report"
  aggregateRole: "context"
  notes:
    - "Evidence bucket: safety_boundaries."
    - "Directness: safety_boundary."
    - "Claim use: safety-only."
evidenceBucket: "safety_boundaries"
directness: "safety_boundary"
claimUse: "safety-only"
murphV1Priority: "medium"
protocolEvidence:
  -
    protocolKey: "protocol_variant:consistent-wake-time/consistent-wake-time"
    groupId: "clinical-and-safety-boundaries"
    stance: "safety_boundary"
    scope: "general_guideline"
    result: "not_efficacy_evidence"
    headline: "Canonical Consistent Wake Time source used for safety boundaries, supervision boundaries, or implementation cautions: Acute Sleep Deprivation and Risk of Motor Vehicle Crash Involvement."
    implication: "Use this source only within the Consistent Wake Time evidence scope described by the protocol page."
    caveat: "Do not promote this source beyond its directness and claim-use classification."
    displayPriority: 40
---

This source is included in the Consistent Wake Time research package for **safety_boundaries**.

**Ledger role:** safety-only. **Directness:** safety_boundary. **Priority:** medium.

**Ledger study design label:** technical report.

**Research note:** External safety report; use as secondary drowsy-driving context if peer-reviewed source needs supplement.

**Protocol-use boundary:** This page preserves the canonical source record. Do not promote it into a protocol claim beyond the cited claim scope in the protocol page.
