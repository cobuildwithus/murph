---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.buildenv.2025.112771"
slug: "sources/morning-light-exposure/doi-10.1016-j.buildenv.2025.112771"
title: "Measuring light exposure in daily life: A review of wearable light loggers"
summary: "Methods review cataloguing wearable light loggers and highlighting heterogeneity, validation gaps, and standardization needs for daily-life light measurement."
status: "draft"
quality: "usable"
aliases:
  - "van Duijnhoven 2025 wearable light loggers review"
  - "Measuring light exposure in daily life wearable loggers"
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
  kind: "review"
  title: "Measuring light exposure in daily life: A review of wearable light loggers"
  authors: "van Duijnhoven J; Hartmeyer SL; Didikoglu A; Stefani O; Houser KW; Kalavally V; Spitschan M"
  year: 2025
  journal: "Building and Environment"
  citation: "van Duijnhoven J, Hartmeyer SL, Didikoglu A, Stefani O, Houser KW, Kalavally V, Spitschan M. Measuring light exposure in daily life: A review of wearable light loggers. Build Environ. 2025;274:112771. doi:10.1016/j.buildenv.2025.112771."
  doi: "10.1016/j.buildenv.2025.112771"
  url: "https://www.sciencedirect.com/science/article/pii/S0360132325001262"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Methods-focused narrative review / device survey"
  participantCount: 53
  participantCountKind: "reported"
  populationLabel: "Wearable light logger devices and daily-life measurement literature, not human participants"
  durationLabel: "Not applicable; measurement-methods review"
  aggregateRole: "synthesis"
  cohortKey: "van-duijnhoven-2025-wearable-loggers"
protocolEvidence:
  -
    protocolKey: "protocol_variant:morning-light-exposure/morning-outdoor-light-exposure"
    groupId: "dose-measurement-implementation"
    stance: "context_only"
    scope: "same_mechanism"
    result: "not_efficacy_evidence"
    headline: "Wearable light measurement is heterogeneous, and device validation/reporting gaps can limit comparability across studies."
    implication: "Any Murph light-exposure experiment should specify measurement device, placement, thresholds, and limitations."
    caveat: "Methods review only; no sleep or protocol efficacy outcome."
    displayPriority: 75
evidenceBucket: "free_living_observational_measurement"
whyItMatters: "It is a backbone measurement source for interpreting all free-living wearable-light studies in this batch."
potentialMurphEndpoints:
  - "wearable logger placement"
  - "melanopic EDI"
  - "lux thresholds"
  - "sensor calibration status"
  - "device adherence"
protocolTakeaway: "Use as measurement-methods context; do not cite for efficacy, but use to qualify light-dose comparability."
murphTakeaway: "Daily-life light studies can be hard to compare because wearable logger designs, calibration, placement, and reported performance differ substantially."
studyDesign: "narrative_review"
modality: "wearable light logger methods review"
claimUse: "context-only"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---

This source is included for **free_living_observational_measurement**.

**Findings:** The review identified 53 wearable light loggers and described major diversity in device characteristics, sensor specifications, calibration, usability, and reporting. It emphasized that the number and sophistication of devices has grown, but validation and performance reporting remain variable. The authors called for standardized practices and closer researcher-manufacturer collaboration.

**Why it matters:** It is a backbone measurement source for interpreting all free-living wearable-light studies in this batch.

**Potential experiment signals:** wearable logger placement, melanopic EDI, lux thresholds, sensor calibration status, device adherence.

**Population mismatch / directness:** No human intervention or sleep outcome; measurement-methods context only. Directness: `background`.

**Limitations:** methods review only; does not test morning light; device information may change over time; no clinical or sleep-effect estimate.

**Protocol takeaway:** Use as measurement-methods context; do not cite for efficacy, but use to qualify light-dose comparability.

**Claim use:** `context-only`.
