---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-nct03845478-2026-04-26
slug: sources/daily-step-floor/clinicaltrials-nct03845478-2026-04-26
title: Effect of the Prescription of 10000 Steps Per Day Using a Pedometer Smartphone App
summary: The registry identifies an RCT of a 10,000 steps/day pedometer-app prescription in overweight adults. A linked publication reports 98 randomized participants and a 24-week program, but registry and publication should remain separate unless canonicalized later.
status: draft
quality: usable
aliases:
- Effect of the Prescription of 10000 Steps Per Day Using a Pedometer Smartphone App
- NCT03845478
- clinicaltrials-nct03845478-2026-04-26
categories:
- daily-step-floor
relations:
- type: related_protocol
  target: protocol_variant:daily-step-floor/daily-step-floor
- type: parent_family
  target: experiment_family:daily-step-floor
source:
  kind: web_page
  title: Effect of the Prescription of 10000 Steps Per Day Using a Pedometer Smartphone App
  authors: ClinicalTrials.gov; study sponsor/investigators not extracted in this batch
  year: 2026
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT03845478
  citation: ClinicalTrials.gov. Effect of the Prescription of 10000 Steps Per Day Using a Pedometer Smartphone App. ClinicalTrials.gov identifier NCT03845478. Accessed 2026-04-26.
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: registry_id
  identifiers:
    registryId: NCT03845478
    titleHash: 10bb81d0f263feb456c23556947eb740fa5c69fb71985dd2c4d8eac95f2dcb91
    url: https://clinicaltrials.gov/study/NCT03845478
  canonicalUrl: https://clinicaltrials.gov/study/NCT03845478
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Trial registry record for a randomized walking-prescription/app study
  populationLabel: Overweight adults in a weight-control context; publication linked to the registry reports n=98.
  durationLabel: 24-week weight-control program in linked publication context.
  cohortKey: clinicaltrials-nct03845478-2026-04-26
  participantCount: 98
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Comparator/control: Control condition in the linked randomized trial context; both arms used app monitoring and a 10,000-step goal in the published report.'
  - 'Limitations: Registry record is not itself a peer-reviewed outcome report; linked publication details should not be merged without explicit canonical linking.'
  - 'Population mismatch: A 10,000-step app-plus-counseling weight-loss trial is adjacent to a general Daily Step Floor self-experiment.'
  - 'Safety/adverse events: no source-specific adverse-event signal was extracted for this batch; source is used for dose-response/cut-point context unless otherwise noted.'
evidenceBucket: dose_response_cut_points
whyItMatters: External protocol/RCT-adjacent context for app-based 10,000-step prescriptions.
potentialMurphEndpoints:
- daily step count
- days meeting step floor
- weekly mean steps
- body composition
- weight-control program adherence
protocolTakeaway: Keep as context-only and separate from observational dose-response evidence.
murphTakeaway: Treat this as reusable source-owned context for step-volume thresholds, dose-response shape, population boundaries, and candidate Murph signals. Do not synthesize it as direct Daily Step Floor efficacy evidence.
studyDesign: rct
modality: walking/ambulatory steps
claimUse: context-only
sourceFindings:
- findingId: finding:daily-step-floor/clinicaltrials-nct03845478-2026-04-26/dose-response-context
  sourceKey: source_artifact:clinicaltrials-nct03845478-2026-04-26
  extractedFromArtifactId: art_clinicaltrials_nct03845478_2026_04_26_landing_page
  findingKind: intervention_result
  population: Overweight adults in a weight-control context; publication linked to the registry reports n=98.
  exposure: Prescription of a 10,000 steps/day goal using a pedometer smartphone app, within a behavioral weight-control program.
  outcome: daily step count; body composition; weight-control program adherence
  summary: The registry identifies an RCT of a 10,000 steps/day pedometer-app prescription in overweight adults. A linked publication reports 98 randomized participants and a 24-week program, but registry and publication should remain separate unless canonicalized later.
  evidenceUse:
  - adjacent_variant
  - context
murphV1Priority: Medium
pdfRightsStatus: unknown
---

This source is included for **dose_response_cut_points**.

**Findings:** The registry identifies an RCT of a 10,000 steps/day pedometer-app prescription in overweight adults. A linked publication reports 98 randomized participants and a 24-week program, but registry and publication should remain separate unless canonicalized later.

**Why it matters:** External protocol/RCT-adjacent context for app-based 10,000-step prescriptions.

**Potential experiment signals:** daily step count, days meeting step floor, weekly mean steps, body composition, weight-control program adherence.

**Protocol takeaway:** Keep as context-only and separate from observational dose-response evidence.

**Claim use:** `context-only`.

## Extraction notes

- **Population:** Overweight adults in a weight-control context; publication linked to the registry reports n=98.
- **Exposure/intervention:** Prescription of a 10,000 steps/day goal using a pedometer smartphone app, within a behavioral weight-control program.
- **Comparator/control:** Control condition in the linked randomized trial context; both arms used app monitoring and a 10,000-step goal in the published report.
- **Duration/follow-up:** 24-week weight-control program in linked publication context.
- **Endpoints:** daily step count, body composition, weight-control program adherence
- **Safety/adverse events:** No adverse-event signal specific to a step-floor intervention was extracted from this source in this batch.
- **Limitations:** Registry record is not itself a peer-reviewed outcome report; linked publication details should not be merged without explicit canonical linking.
- **Population mismatch/directness:** A 10,000-step app-plus-counseling weight-loss trial is adjacent to a general Daily Step Floor self-experiment.
- **Boundary:** This source is observational, review-based, registry-only, or otherwise adjacent unless explicitly noted; it must not be promoted into direct Daily Step Floor protocol evidence.
