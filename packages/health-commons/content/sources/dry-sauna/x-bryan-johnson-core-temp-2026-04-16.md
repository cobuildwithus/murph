---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:x-bryan-johnson-core-temp-2026-04-16
slug: sources/dry-sauna/x-bryan-johnson-core-temp-2026-04-16
title: At min 31, I crossed 102.4°F
summary: X post/mirror for the April 2026 core-temperature claim that Johnson crossed 102.4°F at minute 31 during sauna self-tracking.
status: draft
quality: usable
aliases:
- X minute 31 102.4F sauna threshold
- source_artifact:x-bryan-johnson-saunamaxx-2026-04-14
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
  title: At min 31, I crossed 102.4°F
  authors: Bryan Johnson
  year: 2026
  journal: X
  citation: Johnson B. At min 31, I crossed 102.4°F. X post. Posted April 16, 2026.
  url: https://x.com/bryan_johnson/status/2044126928769278125
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 4a0e0f727fbc636c3543aea73aae93a1163769191dbe7792da33aabbb91d8fba
    url: https://x.com/bryan_johnson/status/2044126928769278125
  canonicalUrl: https://x.com/bryan_johnson/status/2044126928769278125
researchEvidence:
  designKind: single_person_report
  designLabel: Social-post single-person core-temperature report
  populationLabel: Bryan Johnson; adult male self-tracker
  durationLabel: One reported threshold event; fuller context appears in Substack/LinkedIn sources
  aggregateRole: primary
  cohortKey: x-bryan-johnson-core-temp-2026-04-16
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Provides platform-specific provenance for the threshold variant while avoiding duplication of the fuller Substack source.
potentialMurphEndpoints:
- core-temperature threshold
- time-to-threshold
- tolerability symptoms
protocolTakeaway: Use to define the higher-burden core-temperature-threshold variant and measurement caveats, not as evidence that users should extend the default 20-minute protocol.
murphTakeaway: Do not count as independent evidence separate from the fuller Substack/LinkedIn posts.
studyDesign: Social-post n=1 self-experiment report
modality: Dry sauna core-temperature self-experiment
claimUse: context-only
sourceFindings:
- findingId: finding:x-bryan-johnson-core-temp-2026-04-16-threshold
  sourceKey: source_artifact:x-bryan-johnson-core-temp-2026-04-16
  extractedFromArtifactId: art_x_bryan_johnson_core_temp_2026_04_16_web
  findingKind: measurement_validation
  population: Bryan Johnson; adult male self-tracker; X audience.
  exposure: X post about crossing 102.4°F at minute 31 during sauna self-tracking.
  outcome: Social-post mirror of the core-temperature threshold claim.
  summary: 'The X search/extract record states: “At min 31, I crossed 102.4°F,” framing that threshold as heat-shock-protein activation. Treat as a social mirror/provenance source rather than independent evidence.'
  evidenceUse:
  - measurement
  - context
murphV1Priority: Low
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Canonicalized duplicate proposed keys: source_artifact:x-bryan-johnson-saunamaxx-2026-04-14. Multiple candidate URLs in dedupe group; canonical URL selected from preferred representative; alternates were treated as mirrors/aliases, not independent evidence. Use as self-experiment/provenance for the core-temperature threshold only; do not treat as validated human dry-sauna efficacy evidence. Candidate shards: 02-discovery-direct-external-protocol, 03-discovery-core-temperature-threshold-variant.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** It mirrors the minute-31 / 102.4°F threshold claim.

**Why it matters:** It records the claim on X but is not independent of the fuller Substack/LinkedIn reports.

**Potential experiment signals:** core temperature, time-to-threshold, and subjective heat distress.

**Protocol takeaway:** Use as mirror/provenance only.

**Claim use:** `supports-protocol` for variant provenance only.
