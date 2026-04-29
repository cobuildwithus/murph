---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1007-s41999-024-01100-z"
slug: "sources/morning-light-exposure/doi-10.1007-s41999-024-01100-z"
title: "Effects of a daylight intervention in the morning on circadian rhythms and sleep in geriatric patients: a randomized crossover trial"
summary: "Randomized two-period crossover trial in geriatric trauma-ward patients. A bedside daylight lamp from 08:00 to 13:00 for six days produced trends toward cortisol/melatonin rhythmicity but no statistically significant improvement in objective or subjective sleep quality."
status: "draft"
quality: "usable"
aliases:
  - "Effects of a daylight intervention in the morning on circadian rhythms and sleep in geriatric patients"
  - "DOI 10.1007/s41999-024-01100-z"
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
  kind: "journal_article"
  title: "Effects of a daylight intervention in the morning on circadian rhythms and sleep in geriatric patients: a randomized crossover trial"
  authors: "Schubert A; Laurentius T; Lange S; Bertram J; Bollheimer LC; Schweiker M; Christoforou R"
  year: 2025
  journal: "European Geriatric Medicine"
  citation: "Schubert A, Laurentius T, Lange S, Bertram J, Bollheimer LC, Schweiker M, Christoforou R. Effects of a daylight intervention in the morning on circadian rhythms and sleep in geriatric patients: a randomized crossover trial. Eur Geriatr Med. 2025;16:281-292. doi:10.1007/s41999-024-01100-z. PMID:39627630."
  pmid: "39627630"
  doi: "10.1007/s41999-024-01100-z"
  url: "https://doi.org/10.1007/s41999-024-01100-z"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Randomized two-period crossover trial of morning daylight-lamp exposure in a geriatric ward"
  participantCount: 15
  participantCountKind: "reported"
  populationLabel: "Non-demented geriatric trauma patients in a hospital ward; mean age 83.1 ± 5.4 years; 36 enrolled and 15 analyzed"
  durationLabel: "Two six-day periods separated by a one-day washout; daylight lamp 08:00-13:00 during intervention period"
  aggregateRole: "primary"
  cohortKey: "doi-10.1007-s41999-024-01100-z-batch-009"
evidenceBucket: "clinical_sleep_insomnia_dementia_light_therapy_boundaries"
whyItMatters: "The intervention was explicitly in the morning and lasted five hours, making it a useful adjacent timing source, but the hospital geriatric population and indoor lamp modality create a strong boundary."
potentialMurphEndpoints:
  - "cortisol rhythm"
  - "melatonin rhythm"
  - "subjective sleep quality"
  - "actigraphy sleep efficiency"
  - "total sleep time"
  - "wake after sleep onset"
  - "dropout and glare burden"
protocolTakeaway: "A highly supervised morning daylight-lamp intervention in frail inpatients produced mixed/non-significant outcomes; do not translate it into direct efficacy claims for outdoor morning exposure."
murphTakeaway: "Dose feasibility and glare burden matter in older or inpatient populations; objective and subjective sleep outcomes may diverge from hormone-rhythm trends."
studyDesign: "randomized_crossover_trial"
modality: "clinical supervised indoor daylight-lamp exposure"
claimUse: "context-only"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---

This source is included for **clinical_sleep_insomnia_dementia_light_therapy_boundaries**.

**Findings:** In 15 analyzed non-demented geriatric trauma patients, a daylight lamp placed on the bedside table from 08:00 to 13:00 for six days showed positive trends in cortisol/melatonin rhythmicity, including melatonin mean 0.3 ± 0.1 to 0.9 ± 0.8 ng/L during intervention (p = .063), but none of the main outcomes were statistically significant. Subjective sleep quality did not improve, actigraphy results were inconclusive, 18 of 36 enrolled patients dropped out, and no adverse events were reported.

**Why it matters:** The intervention was explicitly in the morning and lasted five hours, making it a useful adjacent timing source, but the hospital geriatric population and indoor lamp modality create a strong boundary.

**Potential experiment signals:** cortisol rhythm, melatonin rhythm, subjective sleep quality, actigraphy sleep efficiency, total sleep time, wake after sleep onset, dropout and glare burden

**Protocol takeaway:** A highly supervised morning daylight-lamp intervention in frail inpatients produced mixed/non-significant outcomes; do not translate it into direct efficacy claims for outdoor morning exposure.

**Claim use:** `context-only`.
