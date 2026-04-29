---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bryanjohns0n-core-temp-prototype-2026-04-03
slug: sources/dry-sauna/bryanjohns0n-core-temp-prototype-2026-04-03
title: Sauna people, you want to know about this
summary: Substack self-experiment using a swallowed temperature sensor during a 195°F dry sauna with face/neck cooling, reporting about 38 minutes to a 102.65°F/39.25°C peak and warning that the finding does not necessarily set a dose for others.
status: draft
quality: usable
aliases:
- Sauna people, you want to know about this
- Bryan Johnson core temperature prototype
- source_artifact:reddit-bryan-johns0n-saunamaxx-2026-04-27
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
  title: Sauna people, you want to know about this
  authors: Bryan Johnson
  year: 2026
  journal: Bryan Johnson on Substack
  citation: Johnson B. Sauna people, you want to know about this. Bryan Johnson on Substack. Published April 3, 2026.
  url: https://bryanjohns0n.substack.com/p/sauna-people-you-want-to-know-about
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: title_hash
  identifiers:
    titleHash: 6c111784adef85e8aa77596cae91c65dfbe577cf9c442a0f4b92c83e18ea7ed1
    url: https://bryanjohns0n.substack.com/p/sauna-people-you-want-to-know-about
  canonicalUrl: https://bryanjohns0n.substack.com/p/sauna-people-you-want-to-know-about
researchEvidence:
  designKind: single_person_report
  designLabel: Single-person core-temperature self-experiment
  populationLabel: Bryan Johnson; adult male heat-acclimated self-tracker
  durationLabel: One reported 38-minute dry-sauna session plus prior 200-session context
  aggregateRole: primary
  cohortKey: bryanjohns0n-core-temp-prototype-2026-04-03
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Introduces the measurement boundary between the default 20-minute protocol and a threshold-targeted core-temperature variant.
potentialMurphEndpoints:
- core-temperature tracking
- tolerability symptoms
- heart-rate ceiling
- cooldown timing
- heat-stress symptoms
protocolTakeaway: Use to define the higher-burden core-temperature-threshold variant and measurement caveats, not as evidence that users should extend the default 20-minute protocol.
murphTakeaway: This supports careful separation between protocol provenance, measurement validation, and safety burden.
studyDesign: N=1 core-temperature self-experiment
modality: Dry sauna with swallowed temperature sensor and face/neck cooling
claimUse: context-only
sourceFindings:
- findingId: finding:bryanjohns0n-core-temp-prototype-2026-04-03-threshold
  sourceKey: source_artifact:bryanjohns0n-core-temp-prototype-2026-04-03
  extractedFromArtifactId: art_bryanjohns0n_core_temp_prototype_2026_04_03_web
  findingKind: measurement_validation
  population: Bryan Johnson; adult male self-tracker.
  exposure: 195°F/90.5°C dry sauna for about 38 minutes with face/neck cooling and a swallowed temperature sensor.
  outcome: Reached a reported peak core temperature of 102.65°F/39.25°C; author frames this as an HSP threshold test.
  summary: The post reports a 38-minute 195°F dry-sauna session using a swallowed sensor, with a peak core temperature of 102.65°F/39.25°C and a 16-minute lag before core temperature moved.
  evidenceUse:
  - measurement
  - context
- findingId: finding:bryanjohns0n-core-temp-prototype-2026-04-03-ear-probe-boundary
  sourceKey: source_artifact:bryanjohns0n-core-temp-prototype-2026-04-03
  extractedFromArtifactId: art_bryanjohns0n_core_temp_prototype_2026_04_03_web
  findingKind: measurement_validation
  population: Bryan Johnson; adult male self-tracker.
  exposure: Comparison between prior reliance on an ear probe and a swallowed core-temperature sensor.
  outcome: Measurement boundary for interpreting prior ear-temperature claims.
  summary: The source says Johnson previously relied on an ear probe with an approximate 1°F/0.5°C error margin; the swallowed pill was used to verify core temperature every 30 seconds.
  evidenceUse:
  - measurement
- findingId: finding:bryanjohns0n-core-temp-prototype-2026-04-03-tolerability
  sourceKey: source_artifact:bryanjohns0n-core-temp-prototype-2026-04-03
  extractedFromArtifactId: art_bryanjohns0n_core_temp_prototype_2026_04_03_web
  findingKind: adverse_event
  population: Bryan Johnson; adult male self-tracker.
  exposure: Long high-temperature dry sauna session while attempting to hit a core-temperature threshold.
  outcome: High subjective discomfort and heat-stress tolerability boundary.
  summary: The source describes the 38-minute 195°F session as painful and “dying,” and cautions that this does not necessarily mean others need to sit in a dry sauna that long.
  evidenceUse:
  - safety
murphV1Priority: High
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Canonicalized duplicate proposed keys: source_artifact:reddit-bryan-johns0n-saunamaxx-2026-04-27. Multiple candidate URLs in dedupe group; canonical URL selected from preferred representative; alternates were treated as mirrors/aliases, not independent evidence. Candidate shards: 02-discovery-direct-external-protocol, 03-discovery-core-temperature-threshold-variant.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** It reports an n=1 swallowed-sensor test at 195°F, with face/neck cooling, a reported 102.65°F/39.25°C peak, and high subjective discomfort.

**Why it matters:** It marks the transition from the default 20-minute sauna protocol to a threshold-targeted core-temperature variant.

**Potential experiment signals:** core-temperature tracking, HR, tolerability, post-exit heat lag, cooldown timing, and symptom burden.

**Protocol takeaway:** Do not silently replace the default protocol with this longer variant.

**Claim use:** `supports-protocol` only for the existence and parameters of the self-experiment/variant; not efficacy evidence.
