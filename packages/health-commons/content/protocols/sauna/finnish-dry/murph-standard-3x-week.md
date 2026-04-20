---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:sauna/finnish-dry/murph-standard-3x-week
slug: protocols/sauna/finnish-dry/murph-standard-3x-week
title: Murph Finnish Dry Sauna
summary: Temporary seed protocol for three 15-20 minute Finnish dry sauna sessions per week, evaluated with a 21-day resting-heart-rate test plan.
status: draft
quality: stub
aliases:
  - Finnish sauna protocol
  - dry sauna protocol
  - traditional sauna protocol
categories:
  - passive-heat
  - recovery
  - cardiovascular
relations:
  -
    type: parent_family
    target: experiment_family:sauna/finnish-dry
  -
    type: primary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: cites
    target: source_artifact:pmid-25705824
lineage:
  relationship: root
attribution:
  ownerType: murph
protocol:
  doseSignature: 3x/week · 15-20 min · 80-100°C
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 15
    max: 20
  temperatureC:
    min: 80
    max: 100
  interventionSessionsMinimum: 4
  interventionSessionsTarget: 6
  steps:
    - Complete each session in a traditional dry sauna.
    - Keep other new health interventions stable during the test window.
    - Log session completion and any notable symptoms or confounders.
  stopConditions:
    - Stop if chest pain, faintness, severe dizziness, confusion, or unusual shortness of breath occurs.
testPlans:
  -
    planId: rhr-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:resting-heart-rate
    secondaryBiomarkerKeys:
      - biomarker:hrv-rmssd
    minimumAdherenceSessions: 4
    targetAdherenceSessions: 6
claims:
  -
    claimId: mortality-context-not-endpoint
    type: evidence_scope
    text: Long-term Finnish cohort findings are evidence context for sauna, not outcomes a 21-day personal experiment can test.
    strength: high
    sourceKeys:
      - source_artifact:pmid-25705824
    caveats:
      - Observational cohort evidence cannot prove an individual causal benefit.
      - A short self-experiment cannot test mortality outcomes.
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - unstable_angina
    - recent_myocardial_infarction
    - uncontrolled_hypertension
    - pregnancy
    - acute_illness_or_fever
  stopIf:
    - chest_pain
    - faintness
    - severe_dizziness
    - confusion
---

This is temporary seed content. The important part is the structure: one protocol variant has lineage, attribution, a performable protocol block, test plans, safety, claims, and typed links to biomarkers and sources.
