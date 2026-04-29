---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:pmcid-pmc9981680"
slug: "sources/consistent-wake-time/pmcid-pmc9981680"
title: "Irregular sleep and cardiometabolic risk: Clinical evidence and mechanisms"
summary: "Canonical Consistent Wake Time source used as adjacent, observational, measurement, or population-context evidence: Irregular sleep and cardiometabolic risk: Clinical evidence and mechanisms."
status: "draft"
quality: "usable"
aliases:
  - "PMC9981680"
  - "source_artifact:pmcid-pmc9981680"
categories:
  - "consistent-wake-time"
  - "sleep-regularity-observational"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:consistent-wake-time/consistent-wake-time"
  -
    type: "parent_family"
    target: "experiment_family:consistent-wake-time"
source:
  kind: "review"
  title: "Irregular sleep and cardiometabolic risk: Clinical evidence and mechanisms"
  url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC9981680/"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "narrative review"
  aggregateRole: "context"
  notes:
    - "Evidence bucket: sleep_regularity_observational."
    - "Directness: same_mechanism."
    - "Claim use: context-only."
evidenceBucket: "sleep_regularity_observational"
directness: "same_mechanism"
claimUse: "context-only"
murphV1Priority: "medium"
canonicalLedgerKey: "source_artifact:pmcid-pmc9981680"
keyNormalizationNote: "PMCID-only key lowercased to satisfy current Health Commons key regex."
---

This source is included in the Consistent Wake Time research package for **sleep_regularity_observational**.

**Ledger role:** context-only. **Directness:** same_mechanism. **Priority:** medium.

**Ledger study design label:** narrative review.

**Research note:** Mechanistic/background review; useful to map physiology but not for direct protocol efficacy.

**Protocol-use boundary:** This page preserves the canonical source record. Do not promote it into a protocol claim beyond the cited claim scope in the protocol page.
