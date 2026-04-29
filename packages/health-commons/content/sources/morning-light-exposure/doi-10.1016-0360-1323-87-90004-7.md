---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-0360-1323-87-90004-7"
slug: "sources/morning-light-exposure/doi-10.1016-0360-1323-87-90004-7"
title: "Cloud cover and daylight illuminance"
summary: "Foundational daylight-illuminance paper using cloud cover as an environmental modifier."
status: "draft"
quality: "usable"
aliases:
  - "Tregenza 1987 doi-10.1016-0360-1323-87-90004-7"
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
  title: "Cloud cover and daylight illuminance"
  authors: "Tregenza PR."
  year: 1987
  journal: "Building and Environment"
  citation: "Tregenza PR. Cloud cover and daylight illuminance. Building and Environment. 1987;22(3):163-165. doi:10.1016/0360-1323(87)90004-7."
  doi: "10.1016/0360-1323(87)90004-7"
  url: "https://doi.org/10.1016/0360-1323(87)90004-7"
researchEvidence:
  designKind: "other"
  designLabel: "Daylight illuminance field measurement"
  populationLabel: "General daylight environment; continuous daylight measurements in Nottingham, England"
  durationLabel: "Continuous measurements during 1985 and 1986"
  aggregateRole: "context"
  cohortKey: "tregenza-1987-cloud-cover-daylight"
evidenceBucket: "season_latitude_weather_setting_modifiers"
whyItMatters: "Foundational cloud-cover paper for translating weather into daylight availability."
potentialMurphEndpoints:
  - "cloud cover"
  - "outdoor illuminance"
  - "weather condition"
  - "sky condition"
protocolTakeaway: "Use as background that cloudy conditions can change outdoor-light dose even when adherence time is unchanged."
murphTakeaway: "Tag weather/cloud conditions when interpreting morning outdoor-light logs."
studyDesign: "other"
modality: "cloud_cover_daylight_illuminance_context"
claimUse: "context-only"
murphV1Priority: "Medium"
pdfRightsStatus: "paywalled"
---

This source is included for **season_latitude_weather_setting_modifiers**.

**Findings:** Cloud cover changes daylight availability and should be tracked as a dose modifier. No protocol adverse-event signal was extracted from this source; use only as modifier/context evidence unless a finding explicitly states otherwise.

**Why it matters:** Foundational cloud-cover paper for translating weather into daylight availability.

**Potential experiment signals:** cloud cover, outdoor illuminance, weather condition, sky condition.

**Protocol takeaway:** Use as background that cloudy conditions can change outdoor-light dose even when adherence time is unchanged.

**Claim use:** `context-only`. This is not direct default-protocol efficacy evidence.
