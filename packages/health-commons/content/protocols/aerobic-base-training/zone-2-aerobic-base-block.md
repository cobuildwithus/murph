---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:aerobic-base-training/zone-2-aerobic-base-block
slug: protocols/aerobic-base-training/zone-2-aerobic-base-block
title: Zone 2 Cardio
summary: Do easy conversational cardio using Zone 2 as a practical alias rather than a lab or wearable mandate.
status: draft
quality: usable
aliases:
  - zone 2 aerobic base block
  - easy conversational cardio block
  - low-intensity steady-state cardio block
  - LISS cardio block
  - easy aerobic base training
categories:
  - cardiovascular
  - exercise
  - aerobic-base
  - zone-2
  - behavior-change
  - murph-canonical
media:
  -
    kind: image
    relativePath: design-assets/hero-zone-2-cardio.jpeg
    mediaType: image/jpeg
    caption: Zone 2 Cardio
relations:
  -
    type: parent_family
    target: experiment_family:aerobic-base-training
  -
    type: primary_biomarker
    target: biomarker:estimated-vo2max
  -
    type: secondary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:morning-blood-pressure
  -
    type: cites
    target: source_artifact:health.gov-physical-activity-guidelines-2018-11-12
  -
    type: cites
    target: source_artifact:cdc-physical-activity-intensity-2025-12-04
  -
    type: cites
    target: source_artifact:pmid-17699531
  -
    type: cites
    target: source_artifact:pmid-18580415
  -
    type: cites
    target: source_artifact:pmid-15354048
  -
    type: cites
    target: source_artifact:pmid-17521443
  -
    type: cites
    target: source_artifact:pmid-27926890
lineage:
  relationship: root
  rationale: Default Murph aerobic-base experiment for easy conversational cardio volume, kept separate from lab-defined Zone 2 testing and clinical exercise prescription.
attribution:
  ownerType: murph
protocol:
  doseSignature: 3 sessions per week for 4 weeks; 35-60 minutes of easy conversational cardio per session
  target: sustainable easy aerobic volume
  frequency:
    sessionsPerWeek: 3
  interventionSessionsMinimum: 9
  interventionSessionsTarget: 12
  steps:
    - Choose a repeatable easy-cardio modality. Walking or another low-impact, controlled-environment option is the default.
    - Schedule three sessions per week for 4 weeks.
    - For each session, aim for 35-60 minutes at a pace where you can speak in full, comfortable sentences. If 35 minutes is not comfortably doable at current baseline, use a shorter ramp-up or adapted variant before starting this protocol.
    - If speech becomes forced, you can only say a few words, RPE climbs, or heart rate seems out of proportion but you have no symptoms, slow down or shorten the session.
    - If symptoms appear, glucose safety concerns appear, heat-illness signs appear, or the environment/equipment becomes unsafe, stop the session and follow the stop rules.
  tips:
    - Treat wearable Zone 2 labels as optional context; the talk test and symptom response are the fidelity anchor.
    - Stationary cycling, treadmill, elliptical, rowing, easy jogging, or outdoor cycling can fit only when the setup is safe for that modality and does not create pain, traffic, footing, equipment, or technique problems.
    - In hot or humid conditions, move indoors, shorten, or skip rather than treating planned duration as mandatory. Hydrate normally for the conditions and avoid both dehydration and forced overhydration.
  keepInMind:
    - The exact 4-week, 3x/week, 35-60 minute conversational protocol is evidence-adjacent; nearby evidence often uses longer programs, broader guidelines, or different populations.
    - Modality options are logistics substitutions, not proof of identical physiology or injury load; keep the talk test, symptoms, and pain response primary when switching modes.
    - No extracted source directly tested a Murph onboarding flow, vault context review, automated reminders, missed-log checks, or weekly digests.
  logFields:
    - session completed
    - session minutes
    - modality
    - conversational pace yes/no
    - RPE
    - symptoms
    - pain or injury flare
    - burden
    - enjoyment
    - sleep or recovery context
    - heat/humidity or route/equipment issue
  stopConditions:
    - chest pain, pressure, tightness, anginal-equivalent symptoms, fainting, near-fainting, unexplained exercise-related dizziness, severe shortness of breath, rapid or irregular heartbeat, neurologic symptoms, or confusion
    - glucose symptoms or a glucose reading outside a clinician-directed exercise plan if relevant
    - pain that does not settle after backing off
    - suspected significant heat illness or heat symptoms not resolving with cooling
testPlans:
  -
    planId: zone2-aerobic-base-readout
    primaryBiomarkerKey: biomarker:estimated-vo2max
    secondaryBiomarkerKeys:
      - biomarker:resting-heart-rate
      - biomarker:hrv-rmssd
      - biomarker:morning-blood-pressure
    durationDays: 35
    baselineDays: 7
    interventionDays: 28
expectedSignalDescriptions:
  -
    biomarkerKey: biomarker:estimated-vo2max
    description: "Regular easy cardio trains the heart, blood vessels, and muscles to deliver and use oxygen better. Over several weeks, that may lift a wearable cardio-fitness estimate."
  -
    biomarkerKey: biomarker:resting-heart-rate
    description: "As aerobic fitness improves, the heart can pump more blood with each beat. Resting pulse can fall when fewer beats are needed."
  -
    biomarkerKey: biomarker:hrv-rmssd
    description: "Easy aerobic work can build fitness without a large stress load. If recovery stays ahead of the dose, HRV can become steadier."
  -
    biomarkerKey: biomarker:morning-blood-pressure
    description: "Regular aerobic activity can help blood vessels relax and reduce resistance, so morning pressure may ease down."
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - known cardiovascular, metabolic, renal, respiratory, diabetes, or blood-pressure context; exertional symptoms; diabetes medication or glucose risk; dyspnea; or clinician-directed exercise restrictions
    - pregnancy or postpartum status, prior serious exercise-related adverse event, inability to complete 35 minutes comfortably, chronic musculoskeletal pain, or mobility limitation
  stopIf:
    - chest pain, anginal-equivalent symptoms, fainting, unexplained exercise-related dizziness, severe breathlessness, palpitations, neurologic symptoms, glucose safety symptoms, pain that does not settle, or heat illness signs occur
claims:
  -
    claimId: easy-cardio-volume-is-a-plausible-starter-dose
    type: evidence_scope
    text: The block delivers 105-180 minutes per week of easy conversational cardio; the high end overlaps common 150-minute/week moderate-activity anchors, while the low end is a starter dose below those anchors.
    strength: moderate
    sourceKeys:
      - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
      - source_artifact:pmid-17699531
  -
    claimId: talk-test-anchors-intensity-better-than-wearable-labels-alone
    type: design_guardrail
    text: Talk-test and perceived-exertion evidence support using comfortable speech as the practical intensity anchor rather than treating wearable zones as mandatory.
    strength: moderate
    sourceKeys:
      - source_artifact:cdc-physical-activity-intensity-2025-12-04
      - source_artifact:pmid-15354048
  -
    claimId: safety-screening-and-stop-rules-are-core
    type: safety
    text: Exercise screening, symptom stop rules, heat/environment adjustments, and clinical routing are central to keeping this a wellness experiment rather than unsupervised clinical exercise prescription.
    strength: high
    sourceKeys:
      - source_artifact:pmid-17521443
      - source_artifact:pmid-27926890
researchLandscape:
  bottomLine: Sustainable easy aerobic volume is guideline-adjacent and biologically plausible, but this exact 4-week, 3x/week, 35-60 minute conversational block should be treated as a bounded wellness experiment rather than a proven clinical prescription.
  confidenceLabel: limited
  primaryClaim: A short block of easy conversational cardio may help establish repeatable aerobic volume and produce early fitness or recovery signals for some users.
  mainCaveat: Nearby evidence supports the components more than the exact Murph protocol, and safety screening matters for users with clinical, pregnancy/postpartum, glucose, heat, pain, or exertional-symptom contexts.
  groups:
    -
      id: dose-and-guideline-context
      label: Dose and guideline context
      stance: mixed
      summary: Guidelines and pragmatic walking/training evidence frame the weekly volume as a starter base block, not proof of exact-protocol efficacy.
      sourceKeys:
        - source_artifact:health.gov-physical-activity-guidelines-2018-11-12
        - source_artifact:pmid-17699531
        - source_artifact:pmid-18580415
    -
      id: intensity-fidelity
      label: Conversational intensity fidelity
      stance: supports
      summary: Public guidance and talk-test evidence support comfortable speech as the practical intensity anchor.
      sourceKeys:
        - source_artifact:cdc-physical-activity-intensity-2025-12-04
        - source_artifact:pmid-15354048
    -
      id: safety-boundaries
      label: Safety and clinical boundaries
      stance: safety_boundary
      summary: Safety evidence supports screening, stop rules, diabetes/glucose caution, and symptom-driven off-ramps.
      sourceKeys:
        - source_artifact:pmid-17521443
        - source_artifact:pmid-27926890
---

## Before starting

Use this as an adult wellness experiment only. Ask a clinician first for known cardiovascular, metabolic, renal, respiratory, diabetes, or blood-pressure context; exertional symptoms; diabetes medication or glucose risk; dyspnea; clinician-directed exercise restrictions; pregnancy or postpartum status; prior serious exercise-related adverse event; inability to complete 35 minutes comfortably; chronic pain; or mobility limitation.

## What counts as a session

A session counts when you do continuous easy cardio for 35-60 minutes and stay comfortably conversational without symptoms. Walking or another low-impact controlled option is the default. Use a shorter ramp-up variant if 35 minutes is not comfortably doable.

## What counts as a signal

After a stable baseline, this asks whether a short block of easy conversational cardio feels repeatable, stays tolerable and symptom-free under the stop rules, and produces any interpretable early cardio-fitness signal worth continuing to watch.
