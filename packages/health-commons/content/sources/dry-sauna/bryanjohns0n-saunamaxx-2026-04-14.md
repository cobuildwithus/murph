---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:bryanjohns0n-saunamaxx-2026-04-14
slug: sources/dry-sauna/bryanjohns0n-saunamaxx-2026-04-14
title: 31 brutal minutes to saunamaxx
summary: Substack n=1 core-temperature self-experiment reporting a swallowed-sensor dry-sauna threshold test at 200°F/93°C and 40% humidity, with groin ice in both conditions and face/neck cooling compared against no face/neck cooling.
status: draft
quality: usable
aliases:
- 31 brutal minutes to saunamaxx
- Bryan Johnson saunamaxx
- source_artifact:bryan-johnson-saunamaxx-2026-04-14
categories:
- dry-sauna
- bryan-johnson-blueprint
relations:
- type: related_protocol
  target: protocol_variant:dry-sauna/bryan-johnson-blueprint
- type: parent_family
  target: experiment_family:dry-sauna
- type: same_work_as
  target: source_artifact:bryan-johnson-saunamaxx-2026-04-14
source:
  kind: web_page
  title: 31 brutal minutes to saunamaxx
  authors: Bryan Johnson
  year: 2026
  journal: Bryan Johnson on Substack
  citation: Johnson B. 31 brutal minutes to saunamaxx. Bryan Johnson on Substack. Published April 14, 2026.
  url: https://bryanjohns0n.substack.com/p/31-brutal-minutes-to-saunamaxx
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: b964356940fbffb7b5300d45902e99caa65e70a763cd54dea7e6d94d031b6741
    url: https://bryanjohns0n.substack.com/p/31-brutal-minutes-to-saunamaxx
  canonicalUrl: https://bryanjohns0n.substack.com/p/31-brutal-minutes-to-saunamaxx
researchEvidence:
  designKind: single_person_report
  designLabel: Single-person core-temperature self-experiment
  populationLabel: Bryan Johnson; adult male heat-acclimated self-tracker
  durationLabel: Two reported threshold-test conditions; prior >200 20-minute sessions referenced
  aggregateRole: primary
  cohortKey: bryanjohns0n-saunamaxx-2026-04-14
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Primary source for the April 2026 threshold-targeted saunamaxx variant, post-exit heat lag, and burden/safety caveats.
potentialMurphEndpoints:
- core-temperature tracking
- heart-rate ceiling
- post-exit temperature lag
- symptom burden
- cooldown behavior
protocolTakeaway: Use to define the higher-burden core-temperature-threshold variant and measurement caveats, not as evidence that users should extend the default 20-minute protocol.
murphTakeaway: This source raises measurement and safety questions that should remain separate from default-protocol recommendations.
studyDesign: N=1 self-experiment comparing core-temperature timing with and without face/neck cooling
modality: Dry sauna at 200°F/93°C with swallowed temperature sensor
claimUse: context-only
sourceFindings:
- findingId: finding:bryanjohns0n-saunamaxx-2026-04-14-threshold
  sourceKey: source_artifact:bryanjohns0n-saunamaxx-2026-04-14
  extractedFromArtifactId: art_bryanjohns0n_saunamaxx_2026_04_14_web
  findingKind: measurement_validation
  population: Bryan Johnson; adult male heat-acclimated self-tracker.
  exposure: Dry sauna at 200°F/93°C and 40% humidity with groin ice; conditions compared face/neck ice versus no face/neck ice using a swallowed sensor.
  outcome: 'Reported time to 102.4°F/39°C core temperature: 31 minutes without face/neck ice and 40 minutes with face/neck ice.'
  summary: The source reports that a swallowed sensor updated every 30 seconds; Johnson crossed 102.4°F at minute 31, with listed results of 31 minutes without face/neck ice and 40 minutes with face/neck ice, both with groin ice.
  evidenceUse:
  - measurement
  - context
- findingId: finding:bryanjohns0n-saunamaxx-2026-04-14-post-exit
  sourceKey: source_artifact:bryanjohns0n-saunamaxx-2026-04-14
  extractedFromArtifactId: art_bryanjohns0n_saunamaxx_2026_04_14_web
  findingKind: safety
  population: Bryan Johnson; adult male heat-acclimated self-tracker.
  exposure: Post-exit monitoring after high-temperature dry-sauna threshold session.
  outcome: Post-exit heat lag and cooldown boundary.
  summary: The source reports most time above 102.4°F occurred after exiting the sauna, a 103.7°F peak seven minutes post-exit without face/neck ice, faster cooling with face/neck ice, and a 135 bpm subjective breaking point.
  evidenceUse:
  - safety
  - measurement
- findingId: finding:bryanjohns0n-saunamaxx-2026-04-14-personal-outcomes
  sourceKey: source_artifact:bryanjohns0n-saunamaxx-2026-04-14
  extractedFromArtifactId: art_bryanjohns0n_saunamaxx_2026_04_14_web
  findingKind: intervention_result
  population: Bryan Johnson; one-person self-report.
  exposure: Over 200 prior dry-sauna sessions at 200°F/93°C for 20 minutes.
  outcome: Self-reported vascular, microplastic, toxin, and fertility observations during prior 20-minute routine.
  summary: The source states Johnson’s prior 20-minute dry-sauna sessions still “showed” vascular-age, microplastic, toxin, and fertility observations, but these are uncontrolled self-reports and not causal evidence.
  evidenceUse:
  - context
murphV1Priority: High
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Use as self-experiment/provenance for the core-temperature threshold only; do not treat as validated human dry-sauna efficacy evidence. Candidate shards: 03-discovery-core-temperature-threshold-variant.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** It reports swallowed-sensor timing to 102.4°F/39°C, a post-exit temperature peak, and a heart-rate/tolerability boundary.

**Why it matters:** It is the main direct source for the higher-burden core-temperature variant.

**Potential experiment signals:** core temperature, HR, symptom burden, post-exit timing, cooldown behavior, and session-abort thresholds.

**Protocol takeaway:** Treat as a separate saunamaxx variant and preserve the internal time-to-threshold inconsistency.

**Claim use:** `supports-protocol` for self-experiment provenance only; personal outcomes remain context and non-causal.
