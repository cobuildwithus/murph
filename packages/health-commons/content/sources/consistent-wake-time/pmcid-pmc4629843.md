---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:pmcid-pmc4629843"
slug: "sources/consistent-wake-time/pmcid-pmc4629843"
title: "Negative Impacts of Shiftwork and Long Work Hours"
summary: "Canonical Consistent Wake Time source used for safety boundaries, supervision boundaries, or implementation cautions: Negative Impacts of Shiftwork and Long Work Hours."
status: "draft"
quality: "usable"
aliases:
  - "PMC4629843"
  - "source_artifact:pmcid-pmc4629843"
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
  kind: "review"
  title: "Negative Impacts of Shiftwork and Long Work Hours"
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC4629843/"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "occupational health review"
  aggregateRole: "context"
  notes:
    - "Evidence bucket: safety_boundaries."
    - "Directness: safety_boundary."
    - "Claim use: safety-only."
evidenceBucket: "safety_boundaries"
directness: "safety_boundary"
claimUse: "safety-only"
murphV1Priority: "medium"
canonicalLedgerKey: "source_artifact:pmcid-pmc4629843"
keyNormalizationNote: "PMCID-only key lowercased to satisfy current Health Commons key regex."
protocolEvidence:
  -
    protocolKey: "protocol_variant:consistent-wake-time/consistent-wake-time"
    groupId: "clinical-and-safety-boundaries"
    stance: "safety_boundary"
    scope: "general_guideline"
    result: "not_efficacy_evidence"
    headline: "Canonical Consistent Wake Time source used for safety boundaries, supervision boundaries, or implementation cautions: Negative Impacts of Shiftwork and Long Work Hours."
    implication: "Use this source only within the Consistent Wake Time evidence scope described by the protocol page."
    caveat: "Do not promote this source beyond its directness and claim-use classification."
    displayPriority: 40
---

This source is included in the Consistent Wake Time research package for **safety_boundaries**.

**Ledger role:** safety-only. **Directness:** safety_boundary. **Priority:** medium.

**Ledger study design label:** occupational health review.

**Research note:** Occupational/safety-sensitive work context; supports not forcing wake consistency across shift schedules.

**Protocol-use boundary:** This page preserves the canonical source record. Do not promote it into a protocol claim beyond the cited claim scope in the protocol page.
