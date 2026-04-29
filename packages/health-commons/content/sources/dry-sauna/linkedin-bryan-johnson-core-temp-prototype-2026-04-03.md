---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:linkedin-bryan-johnson-core-temp-prototype-2026-04-03
slug: sources/dry-sauna/linkedin-bryan-johnson-core-temp-prototype-2026-04-03
title: Felt like I was going to die in the sauna this morning
summary: 'LinkedIn post reporting an n=1 195°F dry-sauna core-temperature experiment: 38 minutes to 102.2°F/39°C with face/neck ice and 33 minutes without face/neck ice.'
status: draft
quality: usable
aliases:
- Felt like I was going to die in the sauna this morning
- LinkedIn 195F sauna threshold prototype
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
  title: Felt like I was going to die in the sauna this morning
  authors: Bryan Johnson
  year: 2026
  journal: LinkedIn
  citation: Johnson B. Felt like I was going to die in the sauna this morning. LinkedIn post. Posted April 3, 2026.
  url: https://linkedin.com/posts/bryanrjohnson_felt-like-i-was-going-to-die-in-the-sauna-activity-7445948233736138752-YU_1
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    titleHash: 33d54cc8c8e1887b32129e1f6e33c5b10d058c2797b1dba04d44cb8c1b9985cf
    url: https://linkedin.com/posts/bryanrjohnson_felt-like-i-was-going-to-die-in-the-sauna-activity-7445948233736138752-YU_1
  canonicalUrl: https://linkedin.com/posts/bryanrjohnson_felt-like-i-was-going-to-die-in-the-sauna-activity-7445948233736138752-YU_1
researchEvidence:
  designKind: single_person_report
  designLabel: Social-post single-person core-temperature prototype
  populationLabel: Bryan Johnson; adult male self-tracker
  durationLabel: One reported 195°F threshold experiment
  aggregateRole: primary
  cohortKey: linkedin-bryan-johnson-core-temp-prototype-2026-04-03
  participantCount: 1
  participantCountKind: reported
evidenceBucket: Direct external-protocol provenance and self-experiment claims
whyItMatters: Captures the public prototype data point for face/neck cooling versus no face/neck cooling before the longer Substack write-up.
potentialMurphEndpoints:
- core-temperature threshold
- face/neck cooling condition
- tolerability symptoms
protocolTakeaway: Use to define the higher-burden core-temperature-threshold variant and measurement caveats, not as evidence that users should extend the default 20-minute protocol.
murphTakeaway: The finding is useful for source recall but remains low-strength n=1 social-post evidence.
studyDesign: Social-post n=1 self-experiment report
modality: Dry sauna core-temperature self-experiment
claimUse: context-only
sourceFindings:
- findingId: finding:linkedin-bryan-johnson-core-temp-prototype-2026-04-03-threshold
  sourceKey: source_artifact:linkedin-bryan-johnson-core-temp-prototype-2026-04-03
  extractedFromArtifactId: art_linkedin_bryan_johnson_core_temp_prototype_2026_04_03_web
  findingKind: measurement_validation
  population: Bryan Johnson; adult male self-tracker; LinkedIn audience.
  exposure: Dry sauna at 195°F with face/neck ice versus no face/neck ice.
  outcome: 'Reported time to 102.2°F/39°C: 38 minutes with face/neck ice and 33 minutes without.'
  summary: The LinkedIn post says the experiment tested time to reach 102.2°F/39°C in a 195°F dry sauna, reporting 38 minutes with face/neck ice and 33 minutes without face/neck ice.
  evidenceUse:
  - measurement
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
sourceIndexResolution:
  sourceIndexStatus: absent_from_uploaded_repo_snapshot
  identityResolutionStatus: new_source
  canonicalSourceKey: null
  ledgerNotes: 'Generated source-index.json was absent from repo.snapshot; resolved against available source pages/artifact manifests and candidate identities only. Multiple candidate URLs in dedupe group; canonical URL selected from preferred representative; alternates were treated as mirrors/aliases, not independent evidence. Candidate shards: 02-discovery-direct-external-protocol, 03-discovery-core-temperature-threshold-variant.'
---

This source is included for **Direct external-protocol provenance and self-experiment claims**.

**Findings:** It reports a 195°F dry-sauna threshold test with and without face/neck cooling.

**Why it matters:** It is an early public record of the threshold variant.

**Potential experiment signals:** core temperature, cooling condition, time-to-threshold, and subjective distress.

**Protocol takeaway:** Do not promote as direct evidence for default users.

**Claim use:** `supports-protocol` for variant provenance only.
