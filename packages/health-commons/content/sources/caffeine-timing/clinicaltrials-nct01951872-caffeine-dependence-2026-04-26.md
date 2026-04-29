---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct01951872-caffeine-dependence-2026-04-26
slug: sources/caffeine-timing/clinicaltrials-nct01951872-caffeine-dependence-2026-04-26
title: Treatment for Caffeine Dependence
summary: Registry source identifies a clinical treatment framework for caffeine dependence; no posted outcome result was extracted in this batch.
status: draft
quality: usable
aliases:
- NCT01951872
- Treatment for Caffeine Dependence
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: other
  title: Treatment for Caffeine Dependence
  authors: ClinicalTrials.gov
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Treatment for Caffeine Dependence. ClinicalTrials.gov. NCT01951872.
  url: https://clinicaltrials.gov/study/NCT01951872
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT01951872
    titleHash: 9bd14de2a448d0c79f7c95324f5f38928046a4f6d88c296a2aba5f2bace2321c
    url: https://clinicaltrials.gov/study/NCT01951872
  canonicalUrl: https://clinicaltrials.gov/study/NCT01951872
researchEvidence:
  designKind: other
  designLabel: Clinical trial registry record
  populationLabel: Individuals interested in treatment to reduce or quit problematic caffeine use; exact enrollment/result data were not extracted.
  durationLabel: Treatment timing and follow-up not fully extracted from registry in this batch.
  aggregateRole: primary
  cohortKey: clinicaltrials-nct01951872-caffeine-dependence-2026-04-26
  notes:
  - 'Intervention/exposure: Manual-based treatment for caffeine dependence/problematic caffeine use.'
  - 'Comparator/control: Immediate treatment versus control/waitlist context as described by the registry; detailed result extraction not performed.'
  - 'Endpoints: caffeine dependence, caffeine reduction, cessation adherence, withdrawal management'
  - 'Limitations: Registry record without extracted results; not a sleep-curfew trial.'
  - 'Population mismatch/directness: Clinical dependence-treatment context, not a wellness protocol efficacy source.'
evidenceBucket: withdrawal_tolerance_dose_reset
whyItMatters: Frames when a simple 14-day reset may be insufficient for people with problematic caffeine use.
potentialMurphEndpoints:
- problematic caffeine use
- adherence
- withdrawal severity
- medical advice to reduce caffeine
protocolTakeaway: Include language that people with difficult-to-control caffeine use may need structured or clinician-guided reduction.
murphTakeaway: Escalate repeated failed reset attempts or severe withdrawal to support/treatment guidance.
studyDesign: other
modality: caffeine timing / dose reset / withdrawal context
claimUse: context-only
directnessToProtocol: adjacent_variant
sourceKind: trial_registry
participantCountExtractionNote: Participant count is omitted unless available from extracted source metadata or accessible abstract/snippet in this batch.
endpoints:
- caffeine dependence
- caffeine reduction
- cessation adherence
- withdrawal management
interventionOrExposure: Manual-based treatment for caffeine dependence/problematic caffeine use.
comparatorOrControl: Immediate treatment versus control/waitlist context as described by the registry; detailed result extraction not performed.
durationOrFollowUp: Treatment timing and follow-up not fully extracted from registry in this batch.
effectEstimatesOrDirection: Registry source identifies a clinical treatment framework for caffeine dependence; no posted outcome result was extracted in this batch.
adverseEventsOrSafetyNotes: Signals a boundary population who may need clinical or structured support rather than a simple wellness curfew.
limitations: Registry record without extracted results; not a sleep-curfew trial.
populationMismatch: Clinical dependence-treatment context, not a wellness protocol efficacy source.
artifactCandidates:
- artifactId: art_nct01951872_clinicaltrials_registry
  sourceKey: source_artifact:clinicaltrials-nct01951872-caffeine-dependence-2026-04-26
  kind: html
  storage: external
  sourceUrl: https://clinicaltrials.gov/study/NCT01951872
  rightsStatus: open_access
  redistributable: false
  accessNotes: ClinicalTrials.gov registry HTML is public; store metadata/HTML only if needed.
sourceFindings:
- findingId: finding:clinicaltrials-nct01951872-caffeine-dependence-2026-04-26-caffeine-reduction-or-cessation-support
  sourceKey: source_artifact:clinicaltrials-nct01951872-caffeine-dependence-2026-04-26
  extractedFromArtifactId: art_nct01951872_clinicaltrials_registry
  findingKind: context
  population: Treatment-seeking individuals with problematic caffeine use
  exposure: Manual-based caffeine dependence treatment
  outcome: caffeine reduction or cessation support
  summary: Registry source describes a treatment framework for caffeine dependence/problematic use, but outcome results were not extracted in this batch.
  evidenceUse:
  - context
  - safety
murphV1Priority: Medium
pdfRightsStatus: open_access
---

This source is included for **withdrawal_tolerance_dose_reset**.

**Findings:** Registry source identifies a clinical treatment framework for caffeine dependence; no posted outcome result was extracted in this batch.

**Why it matters:** Frames when a simple 14-day reset may be insufficient for people with problematic caffeine use.

**Potential experiment signals:** problematic caffeine use, adherence, withdrawal severity, medical advice to reduce caffeine.

**Protocol takeaway:** Include language that people with difficult-to-control caffeine use may need structured or clinician-guided reduction.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Individuals interested in treatment to reduce or quit problematic caffeine use; exact enrollment/result data were not extracted.
- **Intervention/exposure:** Manual-based treatment for caffeine dependence/problematic caffeine use.
- **Comparator/control:** Immediate treatment versus control/waitlist context as described by the registry; detailed result extraction not performed.
- **Duration/follow-up:** Treatment timing and follow-up not fully extracted from registry in this batch.
- **Adverse events or safety notes:** Signals a boundary population who may need clinical or structured support rather than a simple wellness curfew.
- **Limitations:** Registry record without extracted results; not a sleep-curfew trial.
- **Population mismatch/directness:** Clinical dependence-treatment context, not a wellness protocol efficacy source.
