---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
slug: protocols/whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
title: Whole Body Red And Near Infrared Light Exposure
summary: "Research draft for a cautious, nonthermal whole-body red and near-infrared light-bed self-experiment with explicit dose logging and sleep or recovery readouts; direct evidence remains thin, adjacent, and device-specific."
status: draft
quality: usable
aliases:
  - whole-body photobiomodulation
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
  -
    type: cites
    target: source_artifact:pmid-30550048
  -
    type: cites
    target: source_artifact:fda-pbm-devices-guidance-2023-01-12
  -
    type: cites
    target: source_artifact:doi-10.17241-smr.2024.02593
  -
    type: cites
    target: source_artifact:pmid-36018149
  -
    type: cites
    target: source_artifact:pmid-36927734
  -
    type: cites
    target: source_artifact:pmid-37593770
  -
    type: cites
    target: source_artifact:pmid-37002704
  -
    type: cites
    target: source_artifact:pmid-19602651
  -
    type: cites
    target: source_artifact:iarc-sunbeds-uv-radiation-2009-07-29
  -
    type: cites
    target: source_artifact:pmid-30044464
  -
    type: cites
    target: source_artifact:pmid-34021422
  -
    type: cites
    target: source_artifact:pmid-36110957
  -
    type: cites
    target: source_artifact:pmid-33107198
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct06678698-2026-04-23
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct07047248-2026-04-23
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct07271927-2026-04-23
  -
    type: cites
    target: source_artifact:ensaiosclinicos-rbr-8v7rsdp-2026-04-23
  -
    type: cites
    target: source_artifact:ensaiosclinicos-rbr-9vcph8x-2026-04-23
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct06866522-2026-04-23
  -
    type: cites
    target: source_artifact:pmid-34451820
  -
    type: cites
    target: source_artifact:pmid-24590242
  -
    type: cites
    target: source_artifact:pmid-31109692
  -
    type: cites
    target: source_artifact:pmid-29466089
  -
    type: cites
    target: source_artifact:pmid-37018063
  -
    type: cites
    target: source_artifact:pmid-35222905
  -
    type: cites
    target: source_artifact:pmid-33345040
  -
    type: cites
    target: source_artifact:pmid-37099210
  -
    type: cites
    target: source_artifact:pmid-36006085
  -
    type: cites
    target: source_artifact:doi-10.1101-2023.03.03.23286452
  -
    type: cites
    target: source_artifact:pmid-41710353
  -
    type: cites
    target: source_artifact:pmid-37753995
  -
    type: cites
    target: source_artifact:pmid-33921839
  -
    type: cites
    target: source_artifact:pmid-39319750
  -
    type: cites
    target: source_artifact:pmid-31574513
lineage:
  relationship: root
  rationale: "Murph canonical general whole-body red/NIR variant, intentionally kept separate from exercise-timed, fibromyalgia, cosmetic, localized, and thermal-light protocols."
attribution:
  ownerType: murph
protocol:
  doseSignature: candidate non-onboarding cadence · 3x/week · 12–20 min nonthermal whole-body red+NIR sessions with explicit parameter logging · 14-day baseline + 28-day intervention
  target: documented non-UV, non-tanning, nonthermal whole-body red and near-infrared LED light-bed exposure with consistent session timing, geometry, coverage, and eye protection
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 12
    max: 20
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - Confirm that the device is a documented non-UV, non-tanning, nonthermal red/NIR PBM device; do not substitute an infrared sauna, tanning bed, IPL, laser, or heat protocol.
    - Before starting, check the avoid-or-get-clinician-guidance list; this ordinary wellness draft is for adults without the listed clinical boundaries.
    - Use the device’s beginner or manufacturer-recommended setting and stay at the lower of the device instructions and this draft’s candidate range; do not increase time, intensity, distance compensation, or frequency to chase an effect.
    - Record the device name, wavelengths, irradiance if available, stated fluence if available, intensity mode, pulsing if available, session duration, exposure geometry, body coverage, and whether the session is front-only or front-and-back.
    - Choose one stable session window and keep it as consistent as practical across the intervention rather than changing time of day from session to session.
    - Use the device in a clearly nonthermal way; stop if skin feels hot, burning, painful, or unusually warm.
    - Use device-appropriate eye protection for each session unless the manufacturer explicitly says it is not required, keep eyes away from direct emitter lines, and never stare into emitters.
    - Keep clothing coverage, distance, body position, and exposure geometry stable within comfort, privacy, skin-integrity, and device-instruction limits.
    - Do not stop, hold, or change prescribed medication for this protocol, including glucose-lowering or blood-pressure medication.
    - Do not add another new sleep, recovery, light, heat, cold, training, or supplement intervention during the same 4-week window.
    - Log acute symptoms, visual symptoms, afterimage duration, skin changes, mood, and sleep changes after every session.
    - Missed sessions are acceptable; do not complete an adherence target by continuing through symptoms.
    - Compare intervention averages against your own baseline instead of reading too much into single-night changes.
  tips:
    - Parameter reporting matters here more than marketing language. Wavelength alone is not the whole dose, and nonthermal PBM is separate from sauna, tanning, IPL, laser, and heat protocols.
    - Keep device, duration, timing, coverage, and exposure setup steady enough that a null or mixed result is still interpretable.
    - Pair wearable outcomes with one-tap subjective ratings for sleep quality, next-day sleepiness, and overall recovery.
    - Treat a flat, mixed, or negative result as useful information, not as proof that you did the protocol wrong.
  keepInMind:
    - Direct human evidence for this exact general whole-body variant is limited.
    - The closest controlled wellness record is a partial-body daytime 850 nm trial, not a literal whole-body light-bed trial.
    - The strongest positive whole-body literature clusters in small supervised fibromyalgia or chronic-pain and cosmetic or photoaging contexts, with linked-program and endpoint-specific caveats that should not be silently borrowed into generic wellness claims.
    - Time-of-day superiority is not settled for whole-body PBM.
  logFields:
    - device name and model
    - manufacturer protocol or setting used
    - wavelengths
    - irradiance if known
    - fluence if known
    - intensity mode or pulsing if known
    - session start time
    - session duration
    - front-only or front-and-back exposure
    - body coverage or clothing
    - distance or geometry
    - room temperature or heat exposure
    - skin warmth burning or pain during session
    - eye protection type and fit
    - accidental direct gaze into emitters
    - afterimage duration
    - visual symptoms
    - skin redness rash blistering hyperpigmentation or irritation
    - wounds lesions rash sunburn tattoos or skin changes in exposed areas
    - medication changes including photosensitizing drugs PDT drugs retinoids steroids glucose medication or blood-pressure medication
    - caffeine alcohol exercise sauna cold exposure travel illness stress or major diet changes
    - new sleep recovery light heat cold supplement or training interventions
    - bedtime and wake time
    - naps
    - wearable model or algorithm changes
    - acute symptoms
    - mood irritability agitation or lowered mood
    - next-morning resting heart rate
    - sleep quality
    - daytime sleepiness
    - recovery or energy
    - missed sessions and reason
  stopConditions:
    - Stop the session immediately if you develop eye pain, blurred vision, new visual disturbance, unusual light sensitivity, new floaters, or an afterimage that does not resolve promptly.
    - Stop the session immediately after accidental direct gaze into emitters if any eye or visual symptom persists.
    - Stop the session if skin feels hot, burning, painful, or unusually warm.
    - Stop the session if you develop blistering, persistent erythema, rash, hives, swelling, hyperpigmentation, herpes reactivation, or skin irritation that lasts beyond the session.
    - Stop the session if any wound, lesion, tattooed area, rash, sunburn, or previously irritated skin area becomes painful, hot, red, or more irritated.
    - End the experiment and seek appropriate medical guidance if you develop chest pain or tightness, palpitations, fainting, near-fainting, confusion, seizure symptoms, severe headache, severe dizziness, nausea, wheezing, dyspnea at rest, or unusual shortness of breath.
    - End the experiment if repeated sessions are followed by clearly worse sleep, insomnia, agitation, irritability, hypomania or mania-like symptoms, lowered mood, or mood instability without a better explanation.
    - Do not continue to meet an adherence target after any stop condition; missed sessions are preferable to pushing through symptoms.
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
  - "Sleep-relevant PBM mechanisms are usually discussed through mitochondrial signaling, adenosine, nitric-oxide and vascular pathways, antioxidant effects, and inflammatory modulation, but most human sleep evidence is transcranial, cervical, special-population, or otherwise indirect; the whole-body human sleep literature remains early and heterogeneous. (source_artifact:doi-10.17241-smr.2024.02593; source_artifact:pmid-36018149)"
  - "Whole-body or large-area exposure has produced measurable non-sleep signals in narrow contexts, but the signal varies by population and endpoint: acute resting-metabolic effects have been reported in women with obesity, while stronger repeated-session symptom gains come from small supervised fibromyalgia studies rather than generic healthy-adult sleep trials. (source_artifact:pmid-41228430; source_artifact:pmid-36369323; source_artifact:pmid-38356644)"
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
      - source_artifact:pmid-30044464
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
    claimId: screening-boundaries-come-from-supervised-protocols
    type: design_guardrail
    text: "Pregnancy or lactation, seizure risk, photophobia or photosensitivity, photosensitizing drugs, implanted devices or pacemakers, unstable cardiovascular, metabolic, neurologic, pulmonary, or psychiatric disease, diabetes medication constraints, active or recent cancer treatment, skin-cancer history, open wounds, concerning lesions, thyroid problems, and inability to report thermal sensation should be clinician-guidance boundaries because they recur as exclusions or safety constraints in supervised or registered whole-body PBM protocols."
    strength: moderate
    sourceKeys:
      - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
      - source_artifact:clinicaltrials-gov-nct06678698-2026-04-23
      - source_artifact:clinicaltrials-gov-nct07047248-2026-04-23
      - source_artifact:clinicaltrials-gov-nct07271927-2026-04-23
      - source_artifact:ensaiosclinicos-rbr-8v7rsdp-2026-04-23
      - source_artifact:ensaiosclinicos-rbr-9vcph8x-2026-04-23
      - source_artifact:clinicaltrials-gov-nct06866522-2026-04-23
  -
    claimId: photosensitizing-and-healing-risk-medications-need-separate-screening
    type: safety
    text: "Medication screening should be wavelength-aware and should not be reduced to a generic 'red light is safe' statement: photosensitizing drugs can cause clinically meaningful skin or ocular risk, recent systemic or topical photodynamic therapy drugs warrant stronger waiting-period precautions, and retinoids or steroids may raise healing-risk questions."
    strength: moderate
    sourceKeys:
      - source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30
      - source_artifact:pmid-34451820
      - source_artifact:pmid-24590242
      - source_artifact:pmid-28891192
  -
    claimId: eye-protection-and-no-direct-gaze-are-required-guardrails
    type: safety
    text: "Eye risk appears controllable, not ignorable: adjacent ocular and facial-light sources document transient ocular complaints, afterimages, reversible retinal findings, photochemical risk from direct viewing, and injury risk when protection or positioning fails, so no-direct-gaze and eye-protection instructions belong on the main page."
    strength: high
    sourceKeys:
      - source_artifact:pmid-39672511
      - source_artifact:pmid-38180093
      - source_artifact:pmid-39335685
      - source_artifact:pmid-28891192
  -
    claimId: high-local-dose-red-light-can-cause-skin-reactions
    type: safety
    text: "Short-term whole-body tolerability should not be treated as dose-indifference: adjacent human red-light skin-safety trials reported dose-limiting blistering and prolonged erythema at higher local fluences, plus milder transient erythema and hyperpigmentation."
    strength: high
    sourceKeys:
      - source_artifact:pmid-31483941
  -
    claimId: cancer-context-is-clinician-guided-not-blanket-reassurance
    type: safety
    text: "Cancer-related PBM evidence is more reassuring in supervised supportive-care follow-up than in some preclinical or mixed reviews, but it does not justify routine unsupervised whole-body wellness use during active or recent cancer treatment; oncology contexts should stay clinician-guided."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-34021422
      - source_artifact:pmid-36110957
      - source_artifact:pmid-31109692
      - source_artifact:pmid-33107198
      - source_artifact:pmid-29466089
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
  bottomLine: "Whole-body red and near-infrared photobiomodulation is plausible enough to document as a careful measurement-first research draft, but the direct evidence for this exact general variant is still limited, adjacent, device-specific, and parameter-sensitive."
  confidenceLabel: limited
  primaryClaim: "A cautious, explicitly logged whole-body red/NIR routine can be described as a measurement-first draft, not as a validated or onboarding-ready sleep or recovery intervention."
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
        - source_artifact:pmid-37002704
        - source_artifact:pmid-19602651
        - source_artifact:iarc-sunbeds-uv-radiation-2009-07-29
    -
      id: direct-sleep-and-wellbeing-evidence
      label: Direct sleep and wellbeing evidence
      stance: mixed
      summary: "Direct whole-body sleep evidence is sparse; the closest controlled wellness trial is adjacent partial-body and null for sleep or circadian benefit, while direct whole-body sleep registries mostly contribute implementation context. The acute women-only metabolic crossover is direct whole-body exposure, but it should stay as metabolic context rather than sleep-efficacy evidence."
      sourceKeys:
        - source_artifact:pmid-36671752
        - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
        - source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
        - source_artifact:pmid-41228430
    -
      id: dose-and-implementation
      label: Dose and implementation
      stance: context_only
      summary: "Several extracted whole-body implementations use 12- to 20-minute sessions and 2–3 or 3 sessions per week, but these are device- and population-specific examples rather than a standardized dose; parameter standardization is poor and explicit dose logging matters."
      sourceKeys:
        - source_artifact:pmid-40253006
        - source_artifact:pmid-30550048
        - source_artifact:pmid-30044464
        - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
        - source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
        - source_artifact:pmid-41228430
        - source_artifact:pmid-37018063
        - source_artifact:pmid-35222905
    -
      id: sibling-variant-literatures
      label: Sibling variant literatures
      stance: context_only
      summary: "Athlete and exercise-timed recovery literature is mixed and includes null or trade-off signals, while fibromyalgia, chronic-pain, and cosmetic large-area PBM literatures are condition- or endpoint-specific and should remain separate from the general Murph variant."
      sourceKeys:
        - source_artifact:pmid-39883205
        - source_artifact:pmid-33345040
        - source_artifact:pmid-37099210
        - source_artifact:pmid-36006085
        - source_artifact:pmid-36369323
        - source_artifact:pmid-38356644
        - source_artifact:pmid-35222905
        - source_artifact:doi-10.1101-2023.03.03.23286452
        - source_artifact:pmid-41710353
        - source_artifact:pmid-37753995
        - source_artifact:pmid-24286286
    -
      id: safety-and-screening-boundaries
      label: Safety and screening boundaries
      stance: safety_boundary
      summary: "Eye safety, high-local-dose skin reactions, photosensitizing and healing-risk medications, oncology context, thyroid and skin-boundary exclusions, and registry exclusion patterns for pregnancy or lactation, seizure risk, pacemakers or implanted devices, unstable cardiovascular, metabolic, neurologic, pulmonary, or psychiatric disease all argue for stronger screening than the internet red-light narrative usually uses."
      sourceKeys:
        - source_artifact:pmid-31483941
        - source_artifact:pmid-39672511
        - source_artifact:pmid-38180093
        - source_artifact:pmid-39335685
        - source_artifact:pmid-28891192
        - source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30
        - source_artifact:pmid-34021422
        - source_artifact:pmid-36110957
        - source_artifact:pmid-31109692
        - source_artifact:pmid-33107198
        - source_artifact:pmid-29466089
        - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
        - source_artifact:clinicaltrials-gov-nct06678698-2026-04-23
        - source_artifact:clinicaltrials-gov-nct07047248-2026-04-23
        - source_artifact:clinicaltrials-gov-nct07271927-2026-04-23
        - source_artifact:ensaiosclinicos-rbr-8v7rsdp-2026-04-23
        - source_artifact:ensaiosclinicos-rbr-9vcph8x-2026-04-23
        - source_artifact:clinicaltrials-gov-nct06866522-2026-04-23
        - source_artifact:pmid-34451820
        - source_artifact:pmid-24590242
        - source_artifact:pmid-33921839
        - source_artifact:pmid-39319750
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
    - pregnancy lactation or breastfeeding
    - under 18 years old
    - active cancer treatment known active cancer recent cancer treatment history of skin cancer or concerning changing skin lesions
    - recent systemic or topical photodynamic therapy drug exposure
    - photosensitizing medication use known photosensitivity photophobia or light-triggered symptoms
    - retinoid steroid or other medication use that may impair skin healing
    - seizure disorder seizure history or photosensitive epilepsy
    - eye disease retinal disease recent eye surgery or unresolved visual symptoms
    - implanted electrical device pacemaker or other implanted medical device
    - arrhythmia decompensated cardiovascular disease severe hypertension or unstable cardiometabolic disease
    - diabetes with severe complications insulin dependence unstable glucose control or planned medication holds
    - unstable neurologic disease Parkinson's disease severe cognitive impairment or major sensory impairment
    - clinically significant pulmonary disease dyspnea at rest resting hypoxemia or recent respiratory exacerbation
    - thyroid disease or monitored thyroid or parathyroid condition when the neck is exposed
    - severe psychiatric instability bipolar or mania or hypomania risk severe mood instability or worsening sleep
    - diagnosed sleep disorder night-shift work or recent travel across more than two time zones when sleep is the primary outcome
    - open wounds burns sunburn active rash active skin infection herpes outbreak or concerning lesions in exposed areas
    - inability to detect or report heat pain skin symptoms visual symptoms or follow device instructions
    - device fit weight limit or positioning constraints that prevent safe use
  stopIf:
    - eye pain blurred vision visual disturbance unusual light sensitivity new floaters or persistent afterimage
    - accidental direct gaze into emitters followed by lingering visual symptoms
    - skin feels hot burning painful or unusually warm
    - blistering persistent erythema rash hives swelling hyperpigmentation herpes reactivation or persistent skin irritation
    - wound lesion tattoo rash sunburn or skin-cancer site irritation
    - severe headache dizziness nausea vomiting confusion fainting or near-fainting
    - seizure symptoms or seizure aura
    - chest pain chest tightness palpitations wheezing dyspnea at rest or unusual shortness of breath
    - repeated worsening sleep insomnia agitation irritability hypomania or mania-like symptoms lowered mood or unstable mood
  notes:
    - This page is for a bounded research draft, not for disease treatment or Murph experiment onboarding.
    - Use only documented non-UV non-tanning nonthermal red/NIR PBM devices; do not substitute sauna tanning IPL laser or heat protocols.
    - Avoid direct gaze into emitters and use device-appropriate eye protection unless the manufacturer explicitly states it is not required.
    - Do not stop hold or change prescribed medication for this protocol.
    - Missed sessions are acceptable; never push through symptoms to meet adherence.
    - Keep safety language stronger than efficacy language because the direct evidence base is still sparse.
---

Whole-body red and near-infrared photobiomodulation is plausible enough to document as a cautious research draft, but the direct evidence for this exact Murph variant is much thinner than the broader PBM internet narrative suggests.

## What this page is trying to answer

This page asks a narrow question: if someone uses a **nonthermal whole-body red/NIR light-bed setup** in a consistent, explicitly logged way for four weeks, is there a detectable personal signal in sleep, next-day sleepiness, recovery, or resting heart rate?

## Why this version is cautious

The direct literature is not strong enough to promise a result. The strongest general-wellness controlled record in the landing set is a **partial-body** daytime 850 nm trial with winter-only mood, drowsiness, inflammatory, and resting-heart-rate signals but **no significant sleep or circadian benefit**. The direct whole-body sleep records are mainly registries that help with cadence, endpoints, and exclusions rather than with efficacy. Acute direct whole-body evidence also exists in a narrow women-only metabolic study, but that is not a general sleep study. (source_artifact:pmid-36671752; source_artifact:clinicaltrials-gov-nct05116605-2026-04-23; source_artifact:clinicaltrials-gov-nct05963555-2026-04-23; source_artifact:pmid-41228430)

## Who should not use this as an ordinary self-experiment

Do not use this ordinary wellness draft without clinician guidance if you are pregnant or breastfeeding; are under 18; have seizure risk, photophobia, photosensitivity, eye disease, recent eye surgery, active or recent cancer treatment, skin-cancer history, suspicious or changing skin lesions, thyroid disease, an implanted medical device, unstable cardiovascular, metabolic, neurologic, pulmonary, or psychiatric disease, diabetes medication constraints, open wounds, active rash, sunburn, skin infection, herpes outbreak, or recent photodynamic therapy drug exposure. Also do not use this protocol if you cannot reliably detect or report heat, pain, skin symptoms, or visual symptoms. These boundaries come from safety reviews, medication guidance, and supervised or registered protocol exclusions rather than from proven risk rates. (source_artifact:clinicaltrials-gov-nct05116605-2026-04-23; source_artifact:clinicaltrials-gov-nct06678698-2026-04-23; source_artifact:clinicaltrials-gov-nct07047248-2026-04-23; source_artifact:clinicaltrials-gov-nct07271927-2026-04-23; source_artifact:ensaiosclinicos-rbr-8v7rsdp-2026-04-23; source_artifact:ensaiosclinicos-rbr-9vcph8x-2026-04-23; source_artifact:clinicaltrials-gov-nct06866522-2026-04-23; source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30; source_artifact:pmid-34451820; source_artifact:pmid-29466089)


## What stays separate

This page is not the place to import efficacy claims from athlete recovery beds, fibromyalgia or chronic-pain PBM, cosmetic or photoaging beds, transcranial or intranasal PBM, red-light glasses, bright-light therapy, infrared sauna, or UV tanning. The athlete/recovery bucket is mixed and includes null performance and fatigue-biomarker evidence; fibromyalgia and cosmetic signals are condition- or endpoint-specific. Those literatures help define boundaries, not generic efficacy. (source_artifact:pmid-39883205; source_artifact:pmid-33345040; source_artifact:pmid-36006085; source_artifact:pmid-36369323; source_artifact:pmid-38356644; source_artifact:pmid-24286286; source_artifact:pmid-36927734; source_artifact:pmid-37593770; source_artifact:pmid-37002704; source_artifact:pmid-19602651; source_artifact:iarc-sunbeds-uv-radiation-2009-07-29)

## Stop rules

Stop the session immediately for eye pain, blurred vision, visual disturbance, unusual light sensitivity, new floaters, a persistent afterimage, accidental direct gaze followed by lingering symptoms, burning or hot skin, blistering, persistent redness, rash, swelling, wound or lesion irritation, severe headache, dizziness, nausea, confusion, fainting, seizure symptoms, chest symptoms, palpitations, wheezing, unusual shortness of breath, or marked mood or sleep worsening. Do not finish sessions just to hit an adherence target. Eye, skin, medication, and mood-related adverse-event signals are mostly adjacent rather than direct whole-body evidence, which is exactly why the stop rules should be stricter than the efficacy language. (source_artifact:pmid-39672511; source_artifact:pmid-38180093; source_artifact:pmid-39335685; source_artifact:pmid-28891192; source_artifact:pmid-31483941; source_artifact:pmid-31574513; source_artifact:pmid-37593770)

## How to read your result

A positive result would mean your own baseline shifted in a repeatable direction while device, timing, coverage, and other confounders stayed fairly stable. A null or mixed result is still informative here, and worsening sleep duration or sleep-stage estimates should be treated as a real negative signal rather than ignored, because adjacent repeated-use wearable data include both lower sleeping heart rate and shorter sleep durations. (source_artifact:pmid-40253006; source_artifact:pmid-30550048; source_artifact:pmid-36671752; source_artifact:pmid-36006085)
