---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
slug: protocols/whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
title: Whole Body Red And Near Infrared Light Exposure
summary: "Try a consistent, nonthermal whole-body red and near-infrared light-bed routine with explicit dose logging and a measurement-first sleep or recovery readout, while keeping claims narrower than the broader photobiomodulation literature."
status: draft
quality: usable
aliases:
  - whole-body photobiomodulation
  - whole-body PBM
  - whole-body PBMT
  - full-body red light therapy
  - full-body red and near-infrared light therapy
  - whole-body LED light-bed exposure
  - red and near-infrared light bed
  - light bed photobiomodulation
categories:
  - photobiomodulation
  - light
  - red-light
  - near-infrared
  - whole-body
  - sleep
  - recovery
  - wearable-measured
relations:
  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
  -
    type: primary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:deep-sleep-minutes
  -
    type: cites
    target: source_artifact:whole-body-photobiomodulation-bibliography
  -
    type: cites
    target: source_artifact:pmid-40253006
  -
    type: cites
    target: source_artifact:pmid-36671752
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
  -
    type: cites
    target: source_artifact:pmid-41228430
  -
    type: cites
    target: source_artifact:pmid-39883205
  -
    type: cites
    target: source_artifact:pmid-36369323
  -
    type: cites
    target: source_artifact:pmid-38356644
  -
    type: cites
    target: source_artifact:pmid-24286286
  -
    type: cites
    target: source_artifact:pmid-31483941
  -
    type: cites
    target: source_artifact:pmid-39672511
  -
    type: cites
    target: source_artifact:pmid-38180093
  -
    type: cites
    target: source_artifact:pmid-39335685
  -
    type: cites
    target: source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30
  -
    type: cites
    target: source_artifact:pmid-28891192
lineage:
  relationship: root
  rationale: "Murph canonical general whole-body red/NIR variant, intentionally kept separate from exercise-timed, fibromyalgia, cosmetic, localized, and thermal-light protocols."
attribution:
  ownerType: murph
protocol:
  doseSignature: 3x/week · 12–20 min nonthermal whole-body red+NIR sessions with explicit parameter logging · 14-day baseline + 28-day intervention
  target: documented whole-body red and near-infrared LED light-bed exposure with consistent session timing, geometry, coverage, and eye protection
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 12
    max: 20
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - Pick one documented whole-body red and near-infrared device and keep the same device for the full experiment.
    - Record the wavelengths, irradiance if available, stated fluence if available, session duration, exposure geometry, body coverage, and whether the session is front-only or front-and-back.
    - Choose one stable session window and keep it as consistent as practical across the intervention rather than changing time of day from session to session.
    - Use the device in a clearly nonthermal way; this page is for whole-body photobiomodulation, not infrared sauna or other heat protocols.
    - Follow the device eye-safety instructions, avoid direct gaze into emitters, and use eye protection when the device or setting calls for it.
    - Keep clothing coverage, distance, body position, and other exposure geometry as stable as practical so your delivered dose does not drift.
    - Do not add another new sleep, recovery, light, or supplement intervention during the same 4-week window.
    - Log each session and compare your intervention averages against your own baseline instead of reading too much into single-night changes.
  tips:
    - Parameter reporting matters here more than marketing language. Wavelength alone is not the whole dose.
    - Keep device, duration, timing, coverage, and exposure setup steady enough that a null result is still interpretable.
    - Pair wearable outcomes with one-tap subjective ratings for sleep quality, next-day sleepiness, and overall recovery.
    - Treat a flat result as useful information, not as proof that you did the protocol wrong.
  keepInMind:
    - Direct human evidence for this exact general whole-body variant is limited.
    - The closest controlled wellness record is a partial-body daytime 850 nm trial, not a literal whole-body light-bed trial.
    - The strongest positive whole-body literature clusters in supervised fibromyalgia or chronic-pain and cosmetic or photoaging contexts, which should not be silently borrowed into generic wellness claims.
    - Time-of-day superiority is not settled for whole-body PBM.
  logFields:
    - device name
    - wavelengths
    - irradiance if known
    - fluence if known
    - session start time
    - session duration
    - body coverage or clothing
    - distance or geometry
    - eye protection used
    - acute symptoms
    - next-morning resting heart rate
    - sleep quality
    - daytime sleepiness
    - recovery or energy
  stopConditions:
    - Stop the session if you develop eye pain, visual disturbance, or a persistent afterimage.
    - Stop the session if you develop blistering, marked erythema, or skin irritation that lasts beyond the session.
    - End the experiment if repeated sessions are followed by clearly worse sleep, worse agitation, or worse mood without a better explanation.
    - End the experiment if you develop severe headache, dizziness, nausea, palpitations, chest symptoms, or unusual shortness of breath.
    - Do not continue over open wounds or concerning skin lesions in exposed areas without clinician guidance.
testPlans:
  -
    planId: whole-body-pbm-rhr-sleep-42d
    durationDays: 42
    baselineDays: 14
    interventionDays: 28
    primaryBiomarkerKey: biomarker:resting-heart-rate
    secondaryBiomarkerKeys:
      - biomarker:sleep-efficiency
      - biomarker:hrv-rmssd
      - biomarker:deep-sleep-minutes
    minimumAdherenceSessions: 10
    targetAdherenceSessions: 12
    notes:
      - The main practical question is whether a stable whole-body red/NIR routine shifts your own baseline for sleep quality, next-day sleepiness, recovery, or resting heart rate.
      - Use wearable metrics as repeated signals, not as single-night verdicts.
      - Keep session timing and exposure setup consistent enough that you can interpret either a positive or null result.
      - Because the direct literature is thin, subjective sleep quality and daytime sleepiness should be logged alongside wearable signals.
whyItWorks:
  - "Photobiomodulation is a nonthermal visible and near-infrared light modality whose biological effects depend heavily on wavelength, irradiance, fluence, duration, repetition, and exposure geometry rather than on color labels alone. (source_artifact:pmid-40253006; source_artifact:pmid-30550048; source_artifact:fda-pbm-devices-guidance-2023-01-12)"
  - "Sleep- and recovery-relevant PBM mechanisms are usually discussed through mitochondrial signaling, nitric-oxide and vascular pathways, autonomic effects, and inflammatory modulation, but the whole-body human sleep literature is still early and heterogeneous. (source_artifact:doi-10.17241-smr.2024.02593; source_artifact:pmid-36018149)"
  - "System-wide effects are plausible, but the direct human whole-body signal varies by population and endpoint: acute resting-metabolic effects have been reported in women with obesity, while stronger repeated-session symptom gains come from supervised fibromyalgia studies rather than generic healthy-adult sleep trials. (source_artifact:pmid-41228430; source_artifact:pmid-36369323; source_artifact:pmid-38356644)"
claims:
  -
    claimId: page-scope-is-one-variant-not-all-red-light
    type: evidence_scope
    text: "This page is for one cautious Murph variant of whole-body red and near-infrared photobiomodulation, not for all red-light therapy, all PBM, or all light-based sleep interventions."
    strength: high
    sourceKeys:
      - source_artifact:pmid-40253006
      - source_artifact:pmid-36927734
      - source_artifact:pmid-37593770
      - source_artifact:pmid-37002704
      - source_artifact:pmid-19602651
      - source_artifact:iarc-sunbeds-uv-radiation-2009-07-29
  -
    claimId: direct-general-evidence-is-thin
    type: mixed_evidence
    text: "Direct evidence for a general whole-body red/NIR wellness or sleep protocol is limited; the nearest direct records include registries without extracted outcomes and one acute crossover study in women-only cohorts."
    strength: moderate
    sourceKeys:
      - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
      - source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
      - source_artifact:pmid-41228430
  -
    claimId: closest-controlled-wellness-trial-is-adjacent
    type: evidence_scope
    text: "The closest controlled wellness trial that is often tempting to cite is not literal whole-body bed evidence; it used daytime 850 nm exposure limited to face, neck, and hands and did not show significant sleep or circadian benefit."
    strength: high
    sourceKeys:
      - source_artifact:pmid-36671752
  -
    claimId: implementation-needs-explicit-dose-logging
    type: design_guardrail
    text: "Whole-body PBM should be logged as an explicit delivered-light setup, not just as 'did red light,' because wavelength, irradiance, fluence, duration, repetition, and geometry are all plausibly load-bearing."
    strength: high
    sourceKeys:
      - source_artifact:pmid-40253006
      - source_artifact:pmid-30550048
      - source_artifact:fda-pbm-devices-guidance-2023-01-12
      - source_artifact:pmcid-pmc6091542
  -
    claimId: sibling-variant-literatures-should-stay-separate
    type: design_guardrail
    text: "Athlete recovery, fibromyalgia, chronic-pain, cosmetic/photoaging, transcranial, intranasal, bright-light, infrared-sauna, and UV-tanning literatures should not be silently reused as direct support for this page."
    strength: high
    sourceKeys:
      - source_artifact:pmid-39883205
      - source_artifact:pmid-36369323
      - source_artifact:pmid-38356644
      - source_artifact:pmid-24286286
      - source_artifact:pmid-36927734
      - source_artifact:pmid-37593770
      - source_artifact:pmid-37002704
      - source_artifact:pmid-19602651
      - source_artifact:iarc-sunbeds-uv-radiation-2009-07-29
  -
    claimId: short-term-tolerability-bounded-not-settled
    type: safety
    text: "Short-term supervised or study-context tolerability looks somewhat reassuring, but the safety record is still too sparse and too context-specific to justify blanket unsupervised reassurance."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-41228430
      - source_artifact:pmid-31483941
      - source_artifact:pmid-39672511
      - source_artifact:pmid-38180093
      - source_artifact:pmid-39335685
      - source_artifact:pmid-28891192
      - source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30
      - source_artifact:pmid-34021422
      - source_artifact:pmid-36110957
      - source_artifact:pmid-33107198
  -
    claimId: not-onboarding-ready-yet
    type: design_guardrail
    text: "This protocol should not power Murph experiment creation yet because the direct evidence is too thin, the device-to-device dose translation is too unstable, and the safety screen still carries too much weight."
    strength: high
    sourceKeys:
      - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
      - source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
      - source_artifact:pmid-41228430
      - source_artifact:pmid-36671752
      - source_artifact:pmid-40253006
researchLandscape:
  bottomLine: "Whole-body red and near-infrared photobiomodulation is plausible enough to test as a careful self-experiment, but the direct evidence for this exact general variant is still limited and parameter-sensitive."
  confidenceLabel: limited
  primaryClaim: "A cautious, explicitly logged whole-body red/NIR routine is defensible as a measurement-first protocol, not as a settled sleep or recovery intervention."
  mainCaveat: "Much of the stronger or more positive literature belongs to sibling variants, adjacent modalities, or narrow populations rather than to a general healthy-adult whole-body protocol."
  groups:
    -
      id: family-definition-and-boundaries
      label: Family definition and boundaries
      stance: context_only
      summary: "Whole-body photobiomodulation should stay separate from localized PBM, red-light glasses, bright-light therapy, infrared sauna, and UV-tanning protocols."
      sourceKeys:
        - source_artifact:pmid-40253006
        - source_artifact:pmid-36927734
        - source_artifact:pmid-37593770
        - source_artifact:pmid-37002704
        - source_artifact:pmid-19602651
        - source_artifact:iarc-sunbeds-uv-radiation-2009-07-29
    -
      id: direct-sleep-and-wellbeing-evidence
      label: Direct sleep and wellbeing evidence
      stance: mixed
      summary: "Direct whole-body sleep evidence is sparse; the closest controlled wellness trial is adjacent partial-body and null for sleep or circadian benefit, while direct whole-body registries mostly contribute implementation context."
      sourceKeys:
        - source_artifact:pmid-36671752
        - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
        - source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
        - source_artifact:pmid-41228430
    -
      id: dose-and-implementation
      label: Dose and implementation
      stance: context_only
      summary: "Reported whole-body implementations cluster around repeated sessions three times weekly and roughly 12 to 20 minutes per session, but parameter standardization is poor and explicit dose logging matters."
      sourceKeys:
        - source_artifact:pmid-40253006
        - source_artifact:pmid-30550048
        - source_artifact:pmcid-pmc6091542
        - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
        - source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
        - source_artifact:pmid-41228430
        - source_artifact:pmid-37018063
        - source_artifact:pmid-35222905
    -
      id: sibling-variant-literatures
      label: Sibling variant literatures
      stance: context_only
      summary: "Athlete, fibromyalgia, chronic-pain, and cosmetic large-area PBM literatures are informative but should remain separate from the general Murph variant."
      sourceKeys:
        - source_artifact:pmid-39883205
        - source_artifact:pmid-36369323
        - source_artifact:pmid-38356644
        - source_artifact:pmid-37753995
        - source_artifact:doi-10.1101-2023.03.03.23286452
        - source_artifact:pmid-24286286
    -
      id: safety-and-screening-boundaries
      label: Safety and screening boundaries
      stance: safety_boundary
      summary: "Eye safety, skin reactions at higher local doses, photosensitizing medications, oncology context, and unstable clinical conditions all argue for stronger screening than the internet red-light narrative usually uses."
      sourceKeys:
        - source_artifact:pmid-31483941
        - source_artifact:pmid-39672511
        - source_artifact:pmid-38180093
        - source_artifact:pmid-39335685
        - source_artifact:pmid-28891192
        - source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30
        - source_artifact:pmid-34021422
        - source_artifact:pmid-36110957
        - source_artifact:pmid-33107198
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
    - pregnancy or lactation
    - active cancer treatment or known active cancer
    - photosensitizing medication use or known photosensitivity
    - seizure disorder or photosensitive epilepsy
    - eye disease or recent eye surgery
    - implanted electrical device or pacemaker
    - open wounds or concerning skin lesions in exposed areas
    - unstable cardiometabolic or neurologic disease
    - severe mood instability or worsening sleep
  stopIf:
    - eye pain or visual disturbance
    - persistent afterimage
    - blistering or persistent erythema
    - severe headache dizziness or nausea
    - palpitations or unusual shortness of breath
    - worsening sleep over repeated sessions
    - mood becomes agitated or unstable
    - skin lesion or open-wound irritation
  notes:
    - This page is for a bounded self-experiment, not for disease treatment.
    - Avoid direct gaze into emitters and follow the device’s eye-protection guidance.
    - Keep safety language stronger than efficacy language because the direct evidence base is still sparse.
---

Whole-body red and near-infrared photobiomodulation is plausible enough to test carefully, but the direct evidence for this exact Murph variant is much thinner than the broader PBM internet narrative suggests.

## What this page is trying to answer

This page asks a narrow question: if someone uses a **nonthermal whole-body red/NIR light-bed setup** in a consistent, explicitly logged way for four weeks, is there a detectable personal signal in sleep, next-day sleepiness, recovery, or resting heart rate?

## Why this version is cautious

The direct literature is not strong enough to promise a result. The strongest general-wellness controlled record in the landing set is a **partial-body** daytime 850 nm trial with winter-only mood, drowsiness, inflammatory, and resting-heart-rate signals but **no significant sleep or circadian benefit**. The direct whole-body sleep records are mainly registries that help with cadence, endpoints, and exclusions rather than with efficacy. Acute direct whole-body evidence also exists in a narrow women-only metabolic study, but that is not a general sleep study. (source_artifact:pmid-36671752; source_artifact:clinicaltrials-gov-nct05116605-2026-04-23; source_artifact:clinicaltrials-gov-nct05963555-2026-04-23; source_artifact:pmid-41228430)

## What stays separate

This page is not the place to import claims from athlete recovery beds, fibromyalgia or chronic-pain PBM, cosmetic or photoaging beds, transcranial or intranasal PBM, red-light glasses, bright-light therapy, infrared sauna, or UV tanning. Those literatures help define boundaries, not generic efficacy. (source_artifact:pmid-39883205; source_artifact:pmid-36369323; source_artifact:pmid-38356644; source_artifact:pmid-24286286; source_artifact:pmid-36927734; source_artifact:pmid-37593770; source_artifact:pmid-37002704; source_artifact:pmid-19602651; source_artifact:iarc-sunbeds-uv-radiation-2009-07-29)

## How to read your result

A positive result would mean your own baseline shifted in a repeatable direction while device, timing, coverage, and other confounders stayed fairly stable. A null result is still informative here, because the direct literature itself is mixed, incomplete, and parameter-sensitive. (source_artifact:pmid-40253006; source_artifact:pmid-30550048; source_artifact:pmid-36671752)
