---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:x-bryan-johnson-core-temp-update-2026-04-03
slug: sources/dry-sauna/x-bryan-johnson-core-temp-update-2026-04-03
title: 38 min with face and neck cooling; 33 min without face and neck cooling
summary: 'X post/mirror for the April 2026 195°F dry-sauna threshold comparison: 38 minutes with face/neck cooling and 33 minutes without.'
status: draft
quality: usable
aliases:
- X 38 min 33 min sauna threshold
- X April 3 sauna face neck cooling
categories:
- dry-sauna
- bryan-johnson-blueprint
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
source:
  kind: web_page
  title: 38 min with face and neck cooling; 33 min without face and neck cooling
  authors: Bryan Johnson
  year: 2026
  journal: X
  citation: Johnson B. 38 min with face and neck cooling; 33 min without face and neck cooling. X post. Posted April 3, 2026.
  url: https://x.com/bryan_johnson/status/2040127999954313485
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 0accebad381f89f4f103ca3f26110afa88ff23b5f07439d6318b278b9a2138db
    url: https://x.com/bryan_johnson/status/2040127999954313485
  canonicalUrl: https://x.com/bryan_johnson/status/2040127999954313485
researchEvidence:
  designKind: single_person_report
  designLabel: Social-post single-person core-temperature prototype
  populationLabel: Bryan Johnson; adult male self-tracker
  durationLabel: One reported 195°F threshold comparison
  aggregateRole: primary
  cohortKey: x-bryan-johnson-core-temp-update-2026-04-03
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Captures the X mirror of the prototype threshold comparison and helps avoid duplicating it as separate evidence.
potentialMurphEndpoints:
- core-temperature threshold
- time-to-threshold
- cooling condition
- tolerability symptoms
protocolTakeaway: Use to define the higher-burden core-temperature-threshold variant and measurement caveats, not as evidence that users should extend the default 20-minute protocol.
murphTakeaway: Mirror/source-recall item; defer to fuller Substack/LinkedIn sources for details.
studyDesign: Social-post n=1 self-experiment report
modality: Dry sauna core-temperature self-experiment
claimUse: context-only
sourceFindings:
- findingId: finding:x-bryan-johnson-core-temp-update-2026-04-03-threshold
  sourceKey: source_artifact:x-bryan-johnson-core-temp-update-2026-04-03
  extractedFromArtifactId: art_x_bryan_johnson_core_temp_update_2026_04_03_web
  findingKind: measurement_validation
  population: Bryan Johnson; adult male self-tracker; X audience.
  exposure: X post about a 195°F dry-sauna threshold comparison with and without face/neck cooling.
  outcome: 'Reported time-to-threshold comparison: 38 minutes with face/neck cooling and 33 minutes without.'
  summary: The X search/extract record reports a 195°F dry-sauna experiment targeting 102.2°F/39°C, with 38 minutes using face/neck cooling and 33 minutes without face/neck cooling.
  evidenceUse:
  - measurement
  - context
murphV1Priority: Low
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Candidate shards: 02-discovery-direct-external-protocol.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** It mirrors the 195°F time-to-threshold comparison with and without face/neck cooling.

**Why it matters:** It helps preserve social-source provenance without double-counting independent evidence.

**Potential experiment signals:** core temperature, time-to-threshold, cooling condition, and symptom burden.

**Protocol takeaway:** Treat as a mirror/provenance source.

**Claim use:** `supports-protocol` for variant provenance only.
