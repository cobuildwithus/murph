---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1177-14771535231204162"
slug: "sources/morning-light-exposure/doi-10.1177-14771535231204162"
title: "Investigation of the daylight spectrum in an indoor environment using CIE S 026 melanopic metrics"
summary: "Indoor daylight-spectrum field measurements using CIE S 026 melanopic metrics across seasons, times, positions, and gaze directions."
status: "draft"
quality: "usable"
aliases:
  - "Englezou 2023 doi-10.1177-14771535231204162"
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
  title: "Investigation of the daylight spectrum in an indoor environment using CIE S 026 melanopic metrics"
  authors: "Englezou M, Michael A."
  year: 2023
  journal: "Lighting Research & Technology"
  citation: "Englezou M, Michael A. Investigation of the daylight spectrum in an indoor environment using CIE S 026 melanopic metrics. Lighting Research & Technology. 2023. doi:10.1177/14771535231204162."
  doi: "10.1177/14771535231204162"
  url: "https://journals.sagepub.com/doi/10.1177/14771535231204162"
researchEvidence:
  designKind: "other"
  designLabel: "Indoor daylight spectrum field measurement"
  populationLabel: "A south-facing indoor room in Cyprus"
  durationLabel: "Measurements across four seasons, four times of day, 20 positions, and eight gaze directions"
  aggregateRole: "primary"
  cohortKey: "englezou-2023-indoor-daylight-spectrum"
evidenceBucket: "season_latitude_weather_setting_modifiers"
whyItMatters: "Indoor melanopic field-measurement source with season and hour-of-day detail."
potentialMurphEndpoints:
  - "melanopic EDI"
  - "melanopic DER"
  - "clock time"
  - "season"
  - "gaze direction"
  - "room orientation"
protocolTakeaway: "Use as context for indoor-daylight dose caveats."
murphTakeaway: "For indoor substitutes, eye position and gaze direction matter."
studyDesign: "other"
modality: "indoor_daylight_spectrum_metrology"
claimUse: "context-only"
murphV1Priority: "High"
pdfRightsStatus: "paywalled"
---

This source is included for **season_latitude_weather_setting_modifiers**.

**Findings:** Indoor daylight exposure can vary substantially within the same room depending on timing and viewing geometry. Indoor daylight metrics can be counterintuitive; high EDI in a winter sun condition does not mean all indoor winter spaces are adequate. No protocol adverse-event signal was extracted from this source; use only as modifier/context evidence unless a finding explicitly states otherwise.

**Why it matters:** Indoor melanopic field-measurement source with season and hour-of-day detail.

**Potential experiment signals:** melanopic EDI, melanopic DER, clock time, season, gaze direction, room orientation.

**Protocol takeaway:** Use as context for indoor-daylight dose caveats.

**Claim use:** `context-only`. This is not direct default-protocol efficacy evidence.
