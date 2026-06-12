---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:aerobic-base-training/zone-2-aerobic-base-block
slug: protocols/aerobic-base-training/zone-2-aerobic-base-block
title: Zone 2 Cardio
summary: Easy conversational cardio, where steady effort keeps oxygen demand high enough for heart, blood vessels, and muscles to practice moving and using oxygen for fuel.
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
    target: biomarker:morning-blood-pressure
  -
    type: secondary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
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
  sessionShape:
    label: One session
    segments:
      - label: easy cardio
        kind: stimulus
        durationMinutes: 60
    ticks:
      - label: "0"
        offsetMinutes: 0
      - label: "35 min minimum"
        offsetMinutes: 35
      - label: "60 min"
        offsetMinutes: 60
  interventionSessionsMinimum: 9
  interventionSessionsTarget: 12
  steps:
    - "Choose 1 repeatable easy-cardio setup; walking or low-impact indoor cardio is the default."
    - "Schedule 3 sessions/week for 4 weeks."
    - "Hold 35–60 min at conversational pace; use a shorter ramp if 35 min is not comfortable yet."
    - "Slow down or shorten when speech feels forced, RPE climbs, or heart rate feels out of proportion."
    - "Stop for symptoms, unsafe heat, glucose concerns, pain, or equipment/route risk; log the reason."
  tips:
    - "Before week 1, choose one repeatable setup: outdoor walk, treadmill, bike, rower, elliptical, or incline walk."
    - "Schedule three sessions weekly; start at 35 minutes and use the same days when practical."
    - "Hold conversational pace: full sentences stay possible; slow down when speech becomes forced."
    - "Skip intervals, tempo runs, races, hard leg finishers, and heat-stacked sessions during the block."
    - "Cool down until breathing feels normal; log minutes, modality, talk-test pass, RPE, heat, and pain."
    - "Do not chase lower resting heart rate if sleep, soreness, HRV, or enjoyment worsens."
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
      - biomarker:morning-blood-pressure
      - biomarker:resting-heart-rate
      - biomarker:hrv-rmssd
    durationDays: 35
    baselineDays: 7
    interventionDays: 28
expectedSignalDescriptions:

  -
    biomarkerKey: biomarker:estimated-vo2max
    expected: Could improve
    description: "Steady conversational cardio trains the heart, blood vessels, and muscles to move and use oxygen more efficiently during sustained work."
    estimatedChange:
      kind: absolute
      low: 0.5
      high: 2.5
      unit: ml/kg/min
      window: 4 weeks
      confidence: low
      basis: "A nearby 6-week moderate cycling RCT increased VO₂max by about 3.4 ml/kg/min; this 4-week, 3x/week conversational block is shorter and usually lower dose, so the protocol-level estimate is scaled down."
    protocolProminence: focus
  -
    biomarkerKey: biomarker:morning-blood-pressure
    expected: Could trend lower
    description: "Easy aerobic work improves endothelial signaling and lowers vascular resistance, reducing pressure against the artery walls."
    displayValue: "Up to 4 mmHg lower"
    estimatedChange:
      kind: absolute
      low: -4
      high: 0
      unit: mmHg systolic
      window: 4-12 weeks
      confidence: low
      basis: "Closest 3-day/week walking RCT reported blood-pressure improvement after 12 weeks; the 6-week cycling RCT found no resting-BP change, so a short 4-week readout should expect small or no movement."
    protocolProminence: focus
  -
    biomarkerKey: biomarker:resting-heart-rate
    expected: Could trend lower
    description: "Aerobic adaptation increases stroke volume, letting the heart maintain resting blood flow with fewer beats."
    displayValue: "Up to 3 bpm lower"
    estimatedChange:
      kind: absolute
      low: -3
      high: 0
      unit: bpm
      window: 4-6 weeks
      confidence: low
      basis: "Aerobic adaptation can lower resting pulse, but the adjacent 6-week cycling RCT reported no significant resting-HR change; this makes a small fall or no change the defensible early estimate."
    protocolProminence: focus
  -
    biomarkerKey: biomarker:hrv-rmssd
    expected: Recovery check
    description: "A recoverable cardio dose strengthens vagal braking at rest; too much load suppresses that rebound."
    estimatedChange:
      kind: mixed_or_contextual
      window: 4 weeks
      confidence: low
      basis: "The protocol sources support HRV as recovery context, not as an efficacy endpoint; RMSSD can rise with recoverable training or fall when sleep, illness, heat, or excess load dominates."
    protocolProminence: context
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - cardiovascular_disease
    - metabolic_or_renal_disease
    - respiratory_disease_or_dyspnea
    - diabetes_or_glucose_medication
    - uncontrolled_blood_pressure
    - exertional_symptoms
    - clinician_directed_exercise_restriction
    - pregnancy_or_postpartum
    - prior_serious_exercise_adverse_event
    - chronic_musculoskeletal_pain
    - mobility_limitation
  stopIf:
    - chest pain, anginal-equivalent symptoms, fainting, unexplained exercise-related dizziness, severe breathlessness, palpitations, neurologic symptoms, glucose safety symptoms, pain that does not settle, or heat illness signs occur
whyItWorks:
  - "## Easy effort lasts long enough\n\nConversational cardio keeps oxygen demand steady without high recovery cost. The dose is volume: 35–60 min, 3x/week, repeatable."
  - "## Mitochondria get steady demand\n\nSustained low-intensity work keeps capillary flow, fat oxidation, and oxygen use active. Muscle adapts to handle fuel aerobically instead of spiking and crashing."
  - "## Base improves by accumulation\n\nSmall changes compound across sessions: higher stroke volume, better vascular tone, stronger mitochondrial capacity. The signal is gradual, not dramatic."
mechanismChain:
  -
    label: "Session"
    content: "3x/week conversational cardio · 35–60 min"
  -
    label: "Aerobic load"
    content: "Oxygen demand stays steady; fat oxidation and capillary flow remain active"
  -
    label: "Repeated signal"
    content: "Low-intensity aerobic volume accumulates without high recovery cost"
  -
    label: "Adaptation"
    content: "Mitochondria improve · stroke volume rises · resting strain drops"
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

After a stable baseline, read the block through downstream objective trends: same-device VO₂ max or cardio-fitness first, then morning blood pressure and resting heart rate, with HRV/RMSSD as recovery context. Session completion, minutes, talk-test pass, symptoms, and burden help interpret the run; they are not the outcome wins.
