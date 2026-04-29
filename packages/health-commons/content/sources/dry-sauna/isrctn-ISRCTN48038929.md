---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:isrctn-ISRCTN48038929
slug: sources/dry-sauna/isrctn-ISRCTN48038929
title: Sauna baths to improve physical performance in adults
summary: Registry record for a sauna-bath intervention intended to improve physical performance in adults.
status: draft
quality: usable
aliases:
- ISRCTN48038929
categories:
- dry-sauna
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
sourceKind: trial_registry
source:
  kind: other
  title: Sauna baths to improve physical performance in adults
  authors: ISRCTN Registry
  year: 2025
  journal: ISRCTN Registry
  citation: ISRCTN Registry. Sauna baths to improve physical performance in adults. ISRCTN Registry. 2025. ISRCTN48038929.
  url: https://isrctn.com/ISRCTN48038929
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: ISRCTN48038929
    url: https://isrctn.com/ISRCTN48038929
  canonicalUrl: https://isrctn.com/ISRCTN48038929
researchEvidence:
  designKind: other
  designLabel: trial registry record
  populationLabel: Adults in a sauna and physical-performance trial registry record
  durationLabel: Registry record; duration not extracted from available batch artifact
  aggregateRole: context
  cohortKey: cohort:isrctn-ISRCTN48038929
  notes:
  - Generated source-index.json was absent from repo.snapshot; resolved against canonical ledger and existing source pages/artifact manifests in the snapshot.
  - No protocolEvidence emitted; protocol-specific interpretation is in standalone evidence appraisal records.
evidenceBucket: Post-exercise sauna, heat-acclimation, and performance variants
whyItMatters: Provides provenance/context for a high-heat performance intervention but no results.
potentialMurphEndpoints:
- performance outcomes
- body composition
- protocol provenance
protocolTakeaway: Use only as registry provenance; do not cite as efficacy evidence.
murphTakeaway: Use only as registry provenance; do not cite as efficacy evidence.
studyDesign: Trial registry record
modality: registered sauna performance intervention
claimUse: context-only
claimUseBoundary: context-only
directnessToBryanJohnsonSauna: adjacent_variant
interventionOrExposure: Sauna-bath intervention for physical performance; full registry details should be read before extracting protocol claims.
comparatorOrControl: Registry comparator not extracted from available batch artifacts.
endpoints:
- physical performance
- body composition
adverseEventsOrSafetyNotes: No adverse-event results; registry records are not outcome evidence.
limitations: Trial registry record without results; no efficacy estimate extracted.
populationMismatch: Registry/provenance record rather than completed Bryan-style protocol evidence.
sourceFindings:
- findingId: finding:isrctn-ISRCTN48038929-registry-provenance-only
  sourceKey: source_artifact:isrctn-ISRCTN48038929
  extractedFromArtifactId: art_isrctn-ISRCTN48038929
  findingKind: context
  population: Adults in a sauna and physical-performance trial registry record
  exposure: Sauna-bath intervention for physical performance; full registry details should be read before extracting protocol claims.
  outcome: Registered trial provenance
  summary: The registry record identifies a sauna-performance trial but provides no extracted efficacy result for protocol synthesis.
  evidenceUse:
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **Post-exercise sauna, heat-acclimation, and performance variants**.

**Findings:** The registry record identifies a sauna-performance trial but provides no extracted efficacy result for protocol synthesis.

**Why it matters:** Provides provenance/context for a high-heat performance intervention but no results.

**Potential experiment signals:** performance outcomes, body composition, protocol provenance

**Protocol takeaway:** Use only as registry provenance; do not cite as efficacy evidence.

**Claim use:** `context-only`.
