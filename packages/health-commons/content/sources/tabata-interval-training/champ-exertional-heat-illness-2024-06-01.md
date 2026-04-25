---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:champ-exertional-heat-illness-2024-06-01
slug: sources/tabata-interval-training/champ-exertional-heat-illness-2024-06-01
title: Clinical Practice Guideline for the Prevention, Diagnosis, and Management of Exertional Heat Illness
summary: Military clinical-practice guideline used for current exertional heat illness prevention, field management, and return-to-duty boundaries.
status: draft
quality: usable
aliases:
  - CHAMP WHEC EHI CPG 2024
  - Clinical Practice Guideline for Exertional Heat Illness
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
source:
  kind: guideline
  title: Clinical Practice Guideline for the Prevention, Diagnosis, and Management of Exertional Heat Illness
  authors: O'Connor FG; Nye NS; DeGroot D; Deuster PA; editors
  year: 2024
  journal: Consortium for Health and Military Performance / Warfighter Health, Education, and Consultation
  url: https://champ.usuhs.edu/sites/default/files/media/documents/champ_whec_ehi_cpg_508_070224_acc.pdf
  citation: O'Connor FG, Nye NS, DeGroot D, Deuster PA, editors. Clinical Practice Guideline for the Prevention, Diagnosis, and Management of Exertional Heat Illness. CHAMP/WHEC. 2024.
researchEvidence:
  designKind: guideline
  designLabel: Military clinical practice guideline
  populationLabel: Service Members and other exercising populations exposed to heat stress
  durationLabel: Prevention, field care, emergency care, hospital care, and return to duty
  cohortKey: champ-whec-2024-ehi-cpg
  aggregateRole: primary
evidenceBucket: safety_msk_rhabdo_heat_respiratory
whyItMatters: It is a current operational safety boundary for intense exertion in heat, including prevention controls and return-to-duty management.
potentialMurphEndpoints:
  - WBGT or environmental heat
  - hydration and cooling strategy
  - recent illness
  - medication risk
  - prior heat event
  - rhabdomyolysis symptoms
protocolTakeaway: Use as safety-only guidance for hot-environment screening and emergency escalation.
murphTakeaway: Short intervals do not remove the need for heat-risk controls when the environment or user risk is elevated.
studyDesign: Clinical practice guideline
modality: Exertional heat illness prevention and management
claimUse: safety-only
murphV1Priority: High
pdfRightsStatus: permission_required
sourceExtractionBatch: 12-source-extraction-013
---
This source is included for **Rhabdomyolysis, heat, and serious exertional adverse-event safety**.

**Findings:** The guideline frames exertional heat illness as a preventable but serious threat and includes comorbid exertional conditions such as exertional rhabdomyolysis. It supports environmental risk assessment, emergency action planning, work/rest modification, cooling, hydration, and return-to-duty boundaries.

**Why it matters:** It is a current operational safety boundary for intense exertion in heat, including prevention controls and return-to-duty management.

**Potential experiment signals:** WBGT/heat load, illness and medication risk, acclimatization, hydration/cooling, prior heat event, and symptoms of heat illness or rhabdomyolysis.

**Protocol takeaway:** Use as safety-only guidance for hot-environment screening and emergency escalation.

**Claim use:** `safety-only`.
