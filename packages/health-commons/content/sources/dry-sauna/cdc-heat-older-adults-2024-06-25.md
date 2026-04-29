---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-heat-older-adults-2024-06-25
slug: sources/dry-sauna/cdc-heat-older-adults-2024-06-25
title: Heat and Older Adults (Aged 65+)
summary: CDC public-health guidance identifying adults aged 65+ as more vulnerable to heat-related health problems.
status: draft
quality: usable
aliases:
  - CDC Heat and Older Adults
  - CDC older adults heat risk
categories:
  - dry-sauna
relations:

  -
    type: related_protocol
    target: protocol_variant:dry-sauna/bryan-johnson-blueprint

  -
    type: parent_family
    target: experiment_family:dry-sauna
source:
  kind: web_page
  title: Heat and Older Adults (Aged 65+)
  authors: Centers for Disease Control and Prevention
  year: 2024
  journal: CDC Heat Health
  citation: Centers for Disease Control and Prevention. Heat and Older Adults (Aged 65+). June 25, 2024.
  url: https://www.cdc.gov/heat-health/risk-factors/heat-and-older-adults-aged-65.html
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.cdc.gov/heat-health/risk-factors/heat-and-older-adults-aged-65.html
  canonicalUrl: https://www.cdc.gov/heat-health/risk-factors/heat-and-older-adults-aged-65.html
researchEvidence:
  designKind: guideline
  designLabel: CDC public-health heat guidance for older adults
  participantCount: 0
  populationLabel: Adults aged 65 years or older and caregivers.
  durationLabel: Guidance; no intervention duration.
  aggregateRole: context
  cohortKey: cdc-2024-heat-older-adults
  notes:
    - interventionOrExposure: Hot weather/heat exposure in older adults.
    - comparatorOrControl: No formal comparator.
    - endpoints: heat-related health problems; dehydration; heat-stress symptoms
    - effectEstimatesOrDirection: Guidance direction: adults 65+ are more prone to heat-related health problems due to reduced temperature adjustment, chronic conditions, and medications.
    - adverseEventsOrSafetyNotes: Heat-related illness, dehydration, and symptoms such as muscle cramps, headaches, nausea, or vomiting requiring medical care.
    - limitations: General hot-weather guidance, not sauna-specific.; No dose-response data for sauna temperature or duration.
    - populationMismatch: Older-adult heat vulnerability context; not general efficacy evidence.
    - directnessToProtocol: Indirect but safety-relevant for older users of high-heat sauna.
evidenceBucket: Safety, heat illness, medications, pregnancy, alcohol, older-adult risk
whyItMatters: The Heliyon severe-sauna cohort and CDC guidance both make age a key screening variable, but this source itself is a general heat-health guideline.
potentialMurphEndpoints:
  - age screen
  - hydration status
  - heat illness symptoms
  - morning blood pressure
protocolTakeaway: Adults 65+ should be treated as higher-risk and should use conservative heat exposure only with appropriate medical/safety review.
murphTakeaway: Age ≥65 belongs in the high-heat sauna caution gate.
studyDesign: Public-health guidance
modality: Environmental heat safety guidance applied to sauna screening
claimUse: safety-only
sourceFindings:

  -
    findingId: finding:cdc-heat-older-adults-2024-06-25:older-adult-heat-vulnerability
    sourceKey: source_artifact:cdc-heat-older-adults-2024-06-25
    extractedFromArtifactId: art_cdc_heat_older_adults_2024_06_25
    findingKind: safety
    population: Adults aged 65 years or older.
    exposure: Heat exposure.
    outcome: Heat-related health problems.
    summary: CDC states that people aged 65 years or older are more prone to heat-related health problems because they do not adjust as well to temperature changes, are more likely to have chronic medical conditions, and are more likely to take medicines affecting thermoregulation or sweating.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **Safety, heat illness, medications, pregnancy, alcohol, older-adult risk**.

**Findings:** CDC states that people aged 65 years or older are more prone to heat-related health problems because they do not adjust as well to temperature changes, are more likely to have chronic medical conditions, and are more likely to take medicines affecting thermoregulation or sweating.

**Why it matters:** The Heliyon severe-sauna cohort and CDC guidance both make age a key screening variable, but this source itself is a general heat-health guideline.

**Potential experiment signals:** age screen, hydration status, heat illness symptoms, morning blood pressure.

**Protocol takeaway:** Adults 65+ should be treated as higher-risk and should use conservative heat exposure only with appropriate medical/safety review.

**Claim use:** `safety-only`.
