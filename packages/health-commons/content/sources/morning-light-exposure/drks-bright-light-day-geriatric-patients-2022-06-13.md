---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:drks-bright-light-day-geriatric-patients-2022-06-13"
slug: "sources/morning-light-exposure/drks-bright-light-day-geriatric-patients-2022-06-13"
title: "Effect of bright light during the day on sleep in geriatric patients"
summary: "DRKS registry record for a geriatric crossover bright-light/daylight intervention. It documents planned morning exposure around 08:00-13:00 for six days versus normal hospital lighting, with cortisol, melatonin, subjective sleep, daytime sleepiness, and actigraphy endpoints; the registry record itself is not efficacy evidence."
status: "draft"
quality: "usable"
aliases:
  - "DRKS00028626"
  - "BLonG"
  - "Effect of bright light during the day on sleep in geriatric patients"
categories:
  - "morning-light-exposure"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
  -
    type: "parent_family"
    target: "experiment_family:morning-light-exposure"
source:
  kind: "other"
  title: "Effect of bright light during the day on sleep in geriatric patients"
  authors: "German Clinical Trials Register; Universitätsklinikum RWTH Aachen"
  year: 2022
  journal: "German Clinical Trials Register"
  citation: "German Clinical Trials Register. Effect of bright light during the day on sleep in geriatric patients. DRKS00028626. Registered 2022 Jun 13; last updated 2024 Jan 4."
  url: "https://drks.de/search/en/trial/DRKS00028626"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Prospectively registered interventional crossover study record"
  participantCount: 37
  participantCountKind: "reported"
  populationLabel: "Geriatric trauma patients in a monocenter German hospital setting; minimum age 70 years; cognitive impairment excluded by Mini-Mental Status cut-off <25"
  durationLabel: "About six days with bright morning light and about six days with normal hospital lighting, in crossover order"
  aggregateRole: "primary"
  cohortKey: "drks00028626-batch-009"
evidenceBucket: "clinical_sleep_insomnia_dementia_light_therapy_boundaries"
whyItMatters: "The registry anchors the planned timing and endpoints for the adjacent geriatric daylight intervention and helps keep source-page claims separate from published results."
potentialMurphEndpoints:
  - "planned bright-light timing"
  - "cortisol"
  - "melatonin"
  - "subjective sleep quality"
  - "sleep diary"
  - "daytime sleepiness"
  - "actigraphy"
protocolTakeaway: "Registry evidence supports timing/duration context only; it should not be used as an outcome claim."
murphTakeaway: "Record planned endpoints and intervention windows separately from published effect estimates to avoid overclaiming."
studyDesign: "trial_registry_crossover"
modality: "clinical supervised indoor bright-light/daylight-lamp registry protocol"
claimUse: "context-only"
murphV1Priority: "Medium"
pdfRightsStatus: "unknown"
---

This source is included for **clinical_sleep_insomnia_dementia_light_therapy_boundaries**.

**Findings:** DRKS00028626 was prospectively registered on 2022-06-13 and lists a completed geriatric crossover study with final sample size 37. The planned intervention exposed one group to bright morning light for about six days around 08:00-13:00 and the other to normal hospital lighting, then crossed over. Planned primary outcomes were melatonin and cortisol levels; secondary outcomes included subjective sleep quality, perceived sleep duration, daytime sleepiness, heart rate, sleep duration, and movement during sleep by actigraphy.

**Why it matters:** The registry anchors the planned timing and endpoints for the adjacent geriatric daylight intervention and helps keep source-page claims separate from published results.

**Potential experiment signals:** planned bright-light timing, cortisol, melatonin, subjective sleep quality, sleep diary, daytime sleepiness, actigraphy

**Protocol takeaway:** Registry evidence supports timing/duration context only; it should not be used as an outcome claim.

**Claim use:** `context-only`.
