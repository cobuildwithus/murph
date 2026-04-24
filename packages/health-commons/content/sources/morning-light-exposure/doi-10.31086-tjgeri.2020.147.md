---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.31086-tjgeri.2020.147"
slug: "sources/morning-light-exposure/doi-10.31086-tjgeri.2020.147"
title: "Effects of Outdoor Natural Light Exposure on Sleep Quality in the Elderly"
summary: "Direct outdoor morning natural-light field intervention in long-term-care older adults with explicit illuminance targets above 10,000 lux."
status: "draft"
quality: "usable"
aliases:
  - "Şansal Tanrıöver Türkgüler Aka 2020 outdoor natural light elderly sleep quality"
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
  title: "Effects of Outdoor Natural Light Exposure on Sleep Quality in the Elderly"
  authors: "Şansal KE, Tanrıöver SH, Türkgüler Aka B"
  year: 2020
  journal: "Turkish Journal of Geriatrics"
  citation: "Şansal KE, Tanrıöver SH, Türkgüler Aka B. Effects of Outdoor Natural Light Exposure on Sleep Quality in the Elderly. Turkish Journal of Geriatrics. 2020;23(1):138-146. doi:10.31086/tjgeri.2020.147."
  doi: "10.31086/tjgeri.2020.147"
  url: "https://doi.org/10.31086/tjgeri.2020.147"
researchEvidence:
  designKind: "controlled_trial"
  designLabel: "Outdoor natural-light exposure field intervention"
  participantCount: 39
  participantCountKind: "reported"
  populationLabel: "Older adults living in a long-term-care facility in Istanbul, Turkey"
  durationLabel: "Morning outdoor natural-light exposure for 40 minutes in two 5-day periods in June and July 2019"
  aggregateRole: "primary"
  cohortKey: "sansal-2020-elderly-outdoor-natural-light"
protocolEvidence:
  -
    protocolKey: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
    groupId: "direct-outdoor-natural-light"
    stance: "supports"
    scope: "direct_protocol"
    result: "positive"
    endpointKeys:
      - "biomarker:sleep-quality"
    headline: "A 40-minute morning outdoor natural-light protocol in older adults reported significant sleep-quality improvements."
    implication: "Supports using outdoor daylight, not only indoor bright-light devices, as a candidate sleep experiment."
    caveat: "Small long-term-care sample; authors cautioned that the study cannot define a precise illuminance or duration threshold for circadian response."
    displayPriority: 88
  -
    protocolKey: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
    groupId: "outcomes-and-wearable-interpretation"
    stance: "mixed"
    scope: "direct_protocol"
    result: "positive"
    endpointKeys:
      - "biomarker:sleep-quality"
    headline: "A 40-minute morning outdoor natural-light protocol in older adults reported significant sleep-quality improvements."
    implication: "Supports using outdoor daylight, not only indoor bright-light devices, as a candidate sleep experiment."
    caveat: "Small long-term-care sample; authors cautioned that the study cannot define a precise illuminance or duration threshold for circadian response."
    displayPriority: 88
  -
    protocolKey: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
    groupId: "population-modifiers"
    stance: "context_only"
    scope: "direct_protocol"
    result: "positive"
    endpointKeys:
      - "biomarker:sleep-quality"
    headline: "A 40-minute morning outdoor natural-light protocol in older adults reported significant sleep-quality improvements."
    implication: "Supports using outdoor daylight, not only indoor bright-light devices, as a candidate sleep experiment."
    caveat: "Small long-term-care sample; authors cautioned that the study cannot define a precise illuminance or duration threshold for circadian response."
    displayPriority: 88
evidenceBucket: "direct_outdoor_daylight_protocol"
whyItMatters: "Directly tests the habit-relevant exposure—outdoor morning daylight—using measured illuminance and sleep-quality questionnaires."
potentialMurphEndpoints:
  - "subjective sleep quality"
  - "Richard-Campbell Sleep Questionnaire score"
  - "daytime sleepiness"
  - "outdoor illuminance lux"
  - "morning adherence"
protocolTakeaway: "A 40-minute morning outdoor natural-light exposure above 10,000 lux is a plausible direct protocol dose in older institutional adults, but threshold claims should remain tentative."
murphTakeaway: "Use as direct dose support for a morning outdoor-light experiment, with explicit caveats about small nonrandomized design and older long-term-care population."
studyDesign: "Field intervention / quasi-experimental study"
modality: "outdoor morning natural light exposure"
claimUse: "supports-protocol"
murphV1Priority: "High"
pdfRightsStatus: "unknown"
---

This source is included for **direct_outdoor_daylight_protocol**.

**Findings:** The study exposed 39 elderly long-term-care residents to outdoor natural light in the morning for 40 minutes, targeting illuminance above 10,000 lux. Accessible text reports significant pre/post sleep-score differences (P < 0.05), less disturbed sleep in a period with approximately 63% more natural light, and average illuminance around 10,412 lux in the first exposure period versus 16,919 lux in the second. The authors caution that the protocol does not establish a minimum threshold or duration required for circadian response.

**Why it matters:** Directly tests the habit-relevant exposure—outdoor morning daylight—using measured illuminance and sleep-quality questionnaires.

**Potential experiment signals:** subjective sleep quality, Richard-Campbell Sleep Questionnaire score, daytime sleepiness, outdoor illuminance lux, morning adherence

**Protocol takeaway:** A 40-minute morning outdoor natural-light exposure above 10,000 lux is a plausible direct protocol dose in older institutional adults, but threshold claims should remain tentative.

**Claim use:** `supports-protocol`.
