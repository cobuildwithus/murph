---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:cdc-heat-clinical-overview-2025-09-18
slug: sources/dry-sauna/cdc-heat-clinical-overview-2025-09-18
title: Clinical Overview of Heat
summary: CDC clinical heat overview used to anchor broad heat-risk screening for high-heat sauna experiments.
status: draft
quality: usable
aliases:
  - CDC Clinical Overview of Heat
  - Clinical Overview of Heat and Cardiovascular Disease
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
  title: Clinical Overview of Heat
  authors: Centers for Disease Control and Prevention
  year: 2025
  journal: CDC Heat Health
  citation: Centers for Disease Control and Prevention. Clinical Overview of Heat. Sept. 18, 2025.
  url: https://www.cdc.gov/heat-health/hcp/clinical-overview/index.html
sourceIdentity:
  identityKind: web_page
  canonicalIdBasis: url
  identifiers:
    url: https://www.cdc.gov/heat-health/hcp/clinical-overview/index.html
  canonicalUrl: https://www.cdc.gov/heat-health/hcp/clinical-overview/index.html
researchEvidence:
  designKind: guideline
  designLabel: CDC clinical heat-health overview
  participantCount: 0
  populationLabel: People exposed to hot days, especially risk groups such as pregnancy, adults over 65, chronic conditions, substance-use disorders, lack of cooling, workers, and athletes.
  durationLabel: Guidance; no intervention duration.
  aggregateRole: context
  cohortKey: cdc-2025-clinical-overview-heat
  notes:
    - interventionOrExposure: Hot days and heat exposure.
    - comparatorOrControl: No formal comparator.
    - endpoints: heat illness; cardiovascular and respiratory disease exacerbation; kidney disease; pregnancy and birth outcomes; mental health; injuries
    - effectEstimatesOrDirection: Guidance direction: heat can harm physical and mental health; risk is higher in multiple populations and medications can impair heat tolerance.
    - adverseEventsOrSafetyNotes: Heat illness, cardiovascular/respiratory disease exacerbations, kidney disease, adverse pregnancy/birth outcomes, injuries, and medication-related heat intolerance.
    - limitations: Outdoor/environmental heat guidance rather than sauna-specific evidence.; Does not quantify sauna-specific dose thresholds.
    - populationMismatch: Broad public-health heat guidance; applies to screening rather than performance claims.
    - directnessToProtocol: Indirect but relevant safety boundary for deliberate heat exposure.
evidenceBucket: Safety, heat illness, medications, pregnancy, alcohol, older-adult risk
whyItMatters: It identifies risk groups and patient-management steps that map to sauna self-experiment screening.
potentialMurphEndpoints:
  - heat-risk screen
  - hydration status
  - symptoms
  - morning blood pressure
  - resting heart rate
protocolTakeaway: Use to support broad heat-risk screening and hydration/medication planning; do not use to claim protocol benefits.
murphTakeaway: High-heat sauna should include a heat-risk checklist for age, pregnancy, chronic disease, substances, medications, and cooling access.
studyDesign: Clinical public-health guidance
modality: General heat exposure safety guidance
claimUse: safety-only
sourceFindings:

  -
    findingId: finding:cdc-heat-clinical-overview-2025-09-18:heat-risk-groups
    sourceKey: source_artifact:cdc-heat-clinical-overview-2025-09-18
    extractedFromArtifactId: art_cdc_heat_clinical_overview_2025_09_18
    findingKind: safety
    population: General population with heat-risk groups including pregnant women, adults over 65, chronic conditions, substance-use disorders, workers, and athletes.
    exposure: Hot days and heat exposure.
    outcome: Heat-related health harms and risk stratification.
    summary: CDC identifies multiple heat-risk groups, including pregnant women, adults over age 65, people with chronic health conditions, people with substance-use disorders, people lacking cooling, workers in heat, and athletes.
    evidenceUse:
      - safety

  -
    findingId: finding:cdc-heat-clinical-overview-2025-09-18:medication-heat-action-plan
    sourceKey: source_artifact:cdc-heat-clinical-overview-2025-09-18
    extractedFromArtifactId: art_cdc_heat_clinical_overview_2025_09_18
    findingKind: safety
    population: Patients using prescription or over-the-counter medications during heat exposure.
    exposure: Heat exposure plus medications that can impair heat tolerance.
    outcome: Heat illness risk and medication planning.
    summary: CDC states that many medications can impair heat tolerance and temperature regulation, and recommends heat-risk assessment, hydration education, and medication planning for hot days.
    evidenceUse:
      - safety
murphV1Priority: High
pdfRightsStatus: open_access
---
This source is included for **Safety, heat illness, medications, pregnancy, alcohol, older-adult risk**.

**Findings:** CDC identifies multiple heat-risk groups, including pregnant women, adults over age 65, people with chronic health conditions, people with substance-use disorders, people lacking cooling, workers in heat, and athletes. CDC states that many medications can impair heat tolerance and temperature regulation, and recommends heat-risk assessment, hydration education, and medication planning for hot days.

**Why it matters:** It identifies risk groups and patient-management steps that map to sauna self-experiment screening.

**Potential experiment signals:** heat-risk screen, hydration status, symptoms, morning blood pressure, resting heart rate.

**Protocol takeaway:** Use to support broad heat-risk screening and hydration/medication planning; do not use to claim protocol benefits.

**Claim use:** `safety-only`.
