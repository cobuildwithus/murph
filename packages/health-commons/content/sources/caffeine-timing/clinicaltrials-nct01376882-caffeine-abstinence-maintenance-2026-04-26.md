---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01376882-caffeine-abstinence-maintenance-2026-04-26
slug: sources/caffeine-timing/clinicaltrials-nct01376882-caffeine-abstinence-maintenance-2026-04-26
title: Cognitive and Cerebral Blood Flow Effects of 2-week Caffeine Abstinence or Maintenance
summary: Registry source identified the planned abstinence-versus-maintenance comparison; no posted efficacy result was extracted for this batch.
status: draft
quality: usable
aliases:
- NCT01376882
- Cognitive and Cerebral Blood Flow Effects of 2-week Caffeine Abstinence or Maintenance
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: other
  title: Cognitive and Cerebral Blood Flow Effects of 2-week Caffeine Abstinence or Maintenance
  authors: ClinicalTrials.gov
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Cognitive and Cerebral Blood Flow Effects of 2-week Caffeine Abstinence or Maintenance. ClinicalTrials.gov. NCT01376882.
  url: https://clinicaltrials.gov/study/NCT01376882
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT01376882
    titleHash: 6eece86dcebd30a62947cfc309f092961f2144381c2c7e1cf96b29edbdb35207
    url: https://clinicaltrials.gov/study/NCT01376882
  canonicalUrl: https://clinicaltrials.gov/study/NCT01376882
researchEvidence:
  designKind: other
  designLabel: Clinical trial registry record
  populationLabel: Habitual caffeine users or caffeine-exposed adult participants; exact enrollment was not extracted from the available registry summary.
  durationLabel: 2 weeks of abstinence or maintenance; registry follow-up/results details not extracted.
  aggregateRole: primary
  cohortKey: clinicaltrials-nct01376882-caffeine-abstinence-maintenance-2026-04-26
  notes:
  - 'Intervention/exposure: Two-week caffeine abstinence compared with two-week caffeine maintenance at 300 mg/day, with acute caffeine effects also explored.'
  - 'Comparator/control: Caffeine maintenance or abstinence condition as allocated in the registry protocol.'
  - 'Endpoints: cognition, mood, fatigue, alertness, cerebral blood flow'
  - 'Limitations: Trial registry record rather than a peer-reviewed results paper; source should not be merged with publications solely by trial ID; results were not extracted.'
  - 'Population mismatch/directness: Adjacent 2-week abstinence/maintenance design; not an ordinary home caffeine curfew after 10–11 a.m. or within 8 hours of bedtime.'
evidenceBucket: withdrawal_tolerance_dose_reset
whyItMatters: A two-week abstinence versus maintenance design is close to the protocol's dose-reset framing and helps flag withdrawal or maintenance-dose confounding.
potentialMurphEndpoints:
- withdrawal symptoms
- daytime alertness
- fatigue
- mood
- sleep quality
- cerebral blood flow context
protocolTakeaway: Use as context that a 14-day reset is a studied abstinence/maintenance window, but do not cite it as direct proof of better sleep from a morning caffeine curfew.
murphTakeaway: Track both sleep and daytime withdrawal symptoms during the reset window because the registry design targets cognition/mood as well as physiology.
studyDesign: other
modality: caffeine timing / dose reset / withdrawal context
claimUse: context-only
directnessToProtocol: adjacent_variant
sourceKind: trial_registry
participantCountExtractionNote: Participant count is omitted unless available from extracted source metadata or accessible abstract/snippet in this batch.
endpoints:
- cognition
- mood
- fatigue
- alertness
- cerebral blood flow
interventionOrExposure: Two-week caffeine abstinence compared with two-week caffeine maintenance at 300 mg/day, with acute caffeine effects also explored.
comparatorOrControl: Caffeine maintenance or abstinence condition as allocated in the registry protocol.
durationOrFollowUp: 2 weeks of abstinence or maintenance; registry follow-up/results details not extracted.
effectEstimatesOrDirection: Registry source identified the planned abstinence-versus-maintenance comparison; no posted efficacy result was extracted for this batch.
adverseEventsOrSafetyNotes: No adverse-event result was extracted from the registry record in this batch.
limitations: Trial registry record rather than a peer-reviewed results paper; source should not be merged with publications solely by trial ID; results were not extracted.
populationMismatch: Adjacent 2-week abstinence/maintenance design; not an ordinary home caffeine curfew after 10–11 a.m. or within 8 hours of bedtime.
artifactCandidates:
- artifactId: art_nct01376882_clinicaltrials_registry
  sourceKey: source_artifact:clinicaltrials-nct01376882-caffeine-abstinence-maintenance-2026-04-26
  kind: html
  storage: external
  sourceUrl: https://clinicaltrials.gov/study/NCT01376882
  rightsStatus: open_access
  redistributable: false
  accessNotes: ClinicalTrials.gov registry HTML is public; store metadata/HTML only if needed.
sourceFindings:
- findingId: finding:clinicaltrials-nct01376882-caffeine-abstinence-maintenance-2026-04-26-planned-cognition-mood-fatigue-alertness-and-cer
  sourceKey: source_artifact:clinicaltrials-nct01376882-caffeine-abstinence-maintenance-2026-04-26
  extractedFromArtifactId: art_nct01376882_clinicaltrials_registry
  findingKind: context
  population: Habitual caffeine users or caffeine-exposed adults
  exposure: Two-week caffeine abstinence versus 300 mg/day caffeine maintenance
  outcome: planned cognition, mood, fatigue, alertness, and cerebral blood-flow outcomes
  summary: Registry source describes a 2-week abstinence/maintenance comparison relevant to dose-reset confounding, but this batch did not extract posted outcome results.
  evidenceUse:
  - adjacent_variant
  - context
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **withdrawal_tolerance_dose_reset**.

**Findings:** Registry source identified the planned abstinence-versus-maintenance comparison; no posted efficacy result was extracted for this batch.

**Why it matters:** A two-week abstinence versus maintenance design is close to the protocol's dose-reset framing and helps flag withdrawal or maintenance-dose confounding.

**Potential experiment signals:** withdrawal symptoms, daytime alertness, fatigue, mood, sleep quality, cerebral blood flow context.

**Protocol takeaway:** Use as context that a 14-day reset is a studied abstinence/maintenance window, but do not cite it as direct proof of better sleep from a morning caffeine curfew.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Habitual caffeine users or caffeine-exposed adult participants; exact enrollment was not extracted from the available registry summary.
- **Intervention/exposure:** Two-week caffeine abstinence compared with two-week caffeine maintenance at 300 mg/day, with acute caffeine effects also explored.
- **Comparator/control:** Caffeine maintenance or abstinence condition as allocated in the registry protocol.
- **Duration/follow-up:** 2 weeks of abstinence or maintenance; registry follow-up/results details not extracted.
- **Adverse events or safety notes:** No adverse-event result was extracted from the registry record in this batch.
- **Limitations:** Trial registry record rather than a peer-reviewed results paper; source should not be merged with publications solely by trial ID; results were not extracted.
- **Population mismatch/directness:** Adjacent 2-week abstinence/maintenance design; not an ordinary home caffeine curfew after 10–11 a.m. or within 8 hours of bedtime.
