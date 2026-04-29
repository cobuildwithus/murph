---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
slug: sources/whole-body-photobiomodulation/clinicaltrials-gov-nct05116605-2026-04-23
title: Examining the Differential Effects of Photobiomodulation on Sleep and Performance
summary: Completed registry for a NovoTHOR whole-body PBM sleep/performance study in adults 18-50; useful for intervention cadence, endpoints, and exclusion boundaries, not efficacy claims.
status: draft
quality: usable
aliases:
  - NCT05116605
  - clinicaltrials-gov-nct05116605-2026-04-23
categories:
  - whole-body-photobiomodulation
relations:

  -
    type: related_protocol
    target: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
source:
  kind: web_page
  title: Examining the Differential Effects of Photobiomodulation on Sleep and Performance
  authors: West Virginia University (sponsor)
  year: 2026
  journal: ClinicalTrials.gov
  citation: ClinicalTrials.gov. Examining the Differential Effects of Photobiomodulation on Sleep and Performance. Identifier NCT05116605.
  url: https://clinicaltrials.gov/study/NCT05116605
researchEvidence:
  designKind: single_arm_trial
  designLabel: Completed open-label single-arm interventional registry
  participantCount: 16
  participantCountKind: approximate
  populationLabel: Adults 18-50 years; healthy volunteers allowed; registry condition labels include sleep initiation/maintenance and sleep-wake disorders
  durationLabel: 4-week baseline plus 4-week intervention
  aggregateRole: primary
  cohortKey: nct05116605-adults
evidenceBucket: Starter whole-body wellness/sleep evidence
whyItMatters: This is direct implementation context for a commercial whole-body light bed, including schedule, wearable outcomes, and safety exclusions.
potentialMurphEndpoints:
  - sleep quality
  - resting heart rate
  - heart rate variability
  - daytime sleepiness
  - psychomotor vigilance
  - subjective stress and anxiety
protocolTakeaway: Direct whole-body NovoTHOR registry context exists for a 3x/week, 20-minute, 4-week schedule, but it does not provide controlled outcome evidence.
murphTakeaway: Use for implementation details and guardrails, not for benefit claims.
studyDesign: Completed open-label single-arm registry
modality: NovoTHOR whole-body light pod photobiomodulation
claimUse: context-only
murphV1Priority: High
pdfRightsStatus: unknown
---

This source is included for **Starter whole-body wellness/sleep evidence**.

**Findings:** This registry maps a direct whole-body NovoTHOR protocol in adults 18-50 years old. Participants complete 4 weeks of baseline monitoring followed by 4 weeks of intervention with 20-minute PBM sessions 3 times per week. Planned endpoints include nocturnal heart rate and HRV from Oura, subjective sleep quality, PSQI, STAI, PSS, Epworth Sleepiness Scale, Eriksen Flanker, Psychomotor Vigilance Task, restorative sleep, and sleep disturbances. Healthy volunteers were allowed, but diagnosed sleep disorder was an exclusion. Other exclusions included photophobia, epilepsy or seizure risk, thyroid problems, pregnancy, night-shift schedules, recent travel across more than two time zones, high body weight, and likely inability to comply. No extracted efficacy or adverse-event results were available in the reviewed registry materials.

**Why it matters:** It gives a direct whole-body commercial-device implementation template plus practical screening boundaries and candidate endpoints.

**Potential experiment signals:** sleep quality, resting heart rate, HRV, daytime sleepiness, stress and anxiety, vigilance, adherence.

**Protocol takeaway:** Use as direct registry implementation context for cadence, endpoint choice, and screening; do not use as controlled efficacy evidence.

**Claim use:** `context-only`.
