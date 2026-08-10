---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
slug: protocols/whole-body-photobiomodulation/whole-body-red-and-near-infrared-light-exposure
title: Whole-Body Red and Near-Infrared Light Exposure
summary: "Whole-body red/NIR light-bed exposure, where light reaches cells, changes how mitochondria handle energy and stress signals, and can release nitric oxide that relaxes blood vessels."
status: field-testing
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
media:

  -
    kind: image
    relativePath: design-assets/hero-red-light-therapy.jpeg
    mediaType: image/jpeg
    caption: Red Light Therapy
relations:

  -
    type: parent_family
    target: experiment_family:whole-body-photobiomodulation
  -
    type: primary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
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
  doseSignature: high-caution gated planning cadence · 3x/week · 12–20 min nonthermal whole-body red+NIR sessions with explicit parameter logging · 14-day baseline + 28-day intervention
  target: documented non-UV, non-tanning, nonthermal whole-body red and near-infrared LED light-bed exposure with consistent session timing, geometry, coverage, and eye protection
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 12
    max: 20
  sessionShape:
    label: One session
    segments:
      - label: red/NIR exposure
        kind: stimulus
        durationMinutes: 20
    ticks:
      - label: "0"
        offsetMinutes: 0
      - label: "12 min minimum"
        offsetMinutes: 12
      - label: "20 min"
        offsetMinutes: 20
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - "Confirm device is documented non-UV, non-tanning, nonthermal red/NIR PBM; exclude sauna, tanning, IPL, laser, and heat protocols."
    - "Complete safety screen before start; route avoid/clinician-guidance items away from routine wellness setup."
    - "Use beginner/manufacturer setting and the lower of device instructions and Murph range; do not increase dose to chase effect."
    - "Record device, wavelengths, irradiance/fluence if known, intensity, pulsing, duration, geometry, coverage, and session orientation."
    - "Choose 1 stable session window; keep device, duration, timing, coverage, distance, and body position consistent."
    - "Use device-appropriate eye protection; avoid direct emitter gaze and keep sessions clearly nonthermal."
    - "Log symptoms, visual effects, skin changes, mood, sleep changes, medication changes, and confounders after each session."
    - "Stop for eye, skin, heat, mood, cardiopulmonary, neurologic, or severe symptoms; missed sessions beat pushing through."
  tips:
    - Report parameters, not marketing language. Wavelength alone is not the whole dose.
    - Keep device, duration, timing, and coverage steady so a null result is still interpretable.
    - Pair wearable data with one-tap subjective ratings for sleep, sleepiness, and recovery.
    - A flat or negative result is useful information, not proof you did it wrong.
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
    - next-morning HRV or RMSSD
    - sleep quality
    - daytime sleepiness
    - recovery or energy
    - missed sessions and reason
  sessionFieldIds:
  - device_model
  - wavelengths
  - irradiance_if_known
  - fluence_if_known
  - intensity_mode_or_pulsing_if_known
  - session_start_time
  - session_duration_minutes
  - front_only_or_front_and_back
  - exposure_geometry_distance_position
  - body_coverage_or_clothing
  - eye_protection_used
  - accidental_direct_gaze
  - nonthermal_comfort
  - skin_warmth_burning_pain_or_irritation
  - visual_symptoms_or_afterimage
  - acute_symptoms
  - mood_irritability_agitation_or_lowered_mood
  - sleep_quality_next_morning
  - daytime_sleepiness_next_day
  - recovery_or_energy_next_day
  - next_morning_resting_heart_rate
  - next_morning_hrv_rmssd
  - missed_session_reason
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
      - biomarker:hrv-rmssd
      - biomarker:sleep-efficiency
      - biomarker:deep-sleep-minutes
    minimumAdherenceSessions: 10
    targetAdherenceSessions: 12
    notes:
      - The main practical question is whether a stable whole-body red/NIR routine lowers overnight resting pulse or lifts RMSSD without shortening sleep.
      - Use wearable metrics as repeated signals, not as single-night verdicts.
      - Keep session timing and exposure setup consistent enough that you can interpret either a positive or null result.
      - Log subjective sleep quality and daytime sleepiness as interpretation context beside RHR, RMSSD, and sleep-continuity trends.
expectedSignalDescriptions:

  -
    biomarkerKey: biomarker:resting-heart-rate
    expected: Could trend lower
    expectedDirection: down_or_stable
    displayValue: "Up to 5 bpm lower"
    estimatedChange:
      kind: absolute
      low: -5
      high: 0
      unit: bpm
      window: 4 weeks
      confidence: low
      basis: "Adjacent partial-body 850 nm RCT data showed -4.60 +/- 1.90 bpm in winter at 6.5 J/cm^2; whole-body athlete implementation data also showed lower nocturnal heart rate, while direct general whole-body registries have no posted outcomes."
    protocolProminence: focus
    description: "Red/NIR exposure supports nitric-oxide signaling and inflammatory balance, lowering overnight recovery demand and resting pulse."
  -
    biomarkerKey: biomarker:hrv-rmssd
    expected: Could rise or stay stable
    expectedDirection: up_or_stable
    estimatedChange:
      kind: relative_percent
      low: 0
      high: 10
      unit: "%"
      window: next morning to 4 weeks
      confidence: low
      basis: "An acute whole-body pre-exercise crossover trial found higher next-morning rMSSD versus placebo, and athlete implementation data showed a numerical HRV increase; neither source proves a durable general-wellness shift."
    protocolProminence: focus
    description: "Lower recovery load gives the vagal system more room to rebound during sleep, raising RMSSD."
  -
    biomarkerKey: biomarker:sleep-efficiency
    expected: Small or no clear change
    expectedDirection: mixed_or_contextual
    estimatedChange:
      kind: absolute
      low: -1
      high: 2
      unit: "%"
      window: 4 weeks
      confidence: low
      basis: "The closest controlled 850 nm wellness trial did not show significant sleep or circadian effects; direct whole-body sleep registries selected Oura and sleep-quality endpoints but do not yet provide outcome data."
    protocolProminence: context
    description: "A calmer, less uncomfortable night may reduce quiet-wake minutes, but controlled sleep effects remain unclear."
  -
    biomarkerKey: biomarker:deep-sleep-minutes
    expected: Small or no change
    expectedDirection: mixed_or_contextual
    estimatedChange:
      kind: absolute
      low: -10
      high: 10
      unit: minutes
      window: 4 weeks
      confidence: low
      basis: "No extracted study directly anchors N3 or wearable deep-sleep minutes for this protocol; the range reflects a noisy same-device context signal around otherwise null or mixed sleep findings."
    protocolProminence: context
    description: "Red light has no proven effect on deep sleep; a shift of a few minutes either way is usually normal night-to-night variation."
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to cautiously plan a Red Light Therapy experiment."
    intentSummary: "Explore Red Light Therapy"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "pregnancy_lactation_or_minor"
        prompt: "Are you under 18, pregnant, trying to become pregnant, breastfeeding, or lactating?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "cancer_skin_cancer_or_suspicious_lesion"
        prompt: "Do you have active or recent cancer treatment, skin-cancer history, precancerous lesions, or any changing, bleeding, crusting, painful, unexplained, or suspicious skin lesion in an area that would be exposed?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "photosensitizing_meds_or_pdt"
        prompt: "Are you using photosensitizing medication, topical/systemic retinoids, steroids that affect skin healing, or have you recently had photodynamic therapy or a PDT photosensitizer?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "eye_disease_symptoms_or_no_protection"
        prompt: "Do you have eye disease, ocular photosensitivity, current eye pain, flashes, floaters, afterimages, blurry or distorted vision, other visual symptoms, or no device-appropriate eye protection you can use for every session?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "seizure_or_light_triggered_symptoms"
        prompt: "Do you have a seizure disorder, light-triggered symptoms, migraine or neurologic symptoms triggered by light, or a history of unusual reactions to flashing or bright light?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "implanted_device_or_pacemaker"
        prompt: "Do you have a pacemaker, implanted defibrillator, neurostimulator, insulin pump, implanted device, or other device that the PBM manufacturer says requires medical guidance?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "unstable_cardiometabolic_neurologic_pulmonary_psychiatric"
        prompt: "Do you have unstable cardiovascular, metabolic, neurologic, pulmonary, or psychiatric disease, recent fainting, chest pain, dyspnea at rest, uncontrolled blood pressure, severe dizziness, mania/hypomania, or severe mood instability?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "diabetes_or_glucose_medication"
        prompt: "Do you use insulin, sulfonylureas, or other glucose-lowering medication, or do you have diabetes with variable glucose control?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "thyroid_skin_boundary_or_open_skin"
        prompt: "Do you have thyroid-area restrictions, active rash, open wounds, sunburn, painful tattoos, skin irritation, recent procedure sites, infection, blistering, or areas with impaired sensation in regions that would be exposed?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "unable_to_sense_or_report_heat"
        prompt: "Would you be unable to reliably feel, notice, or report heat, burning, pain, unusual warmth, visual symptoms, dizziness, mood changes, or other symptoms during and after sessions?"
        ifPositive: "do_not_start_unsupervised"
    stopIf:
      additionalConditions:
        - "eye pain, blurred vision, new visual disturbance, unusual light sensitivity, persistent afterimage, new floaters, or any visual symptom after direct or accidental emitter gaze"
        - "unavailable, displaced, poorly fitting, uncomfortable, or skipped eye protection"
        - "hot, burning, painful, or unusually warm skin; blistering; persistent erythema; rash; hives; swelling; hyperpigmentation; herpes reactivation; or skin irritation that lasts beyond the session"
        - "chest pain or tightness, palpitations, fainting, near-fainting, confusion, seizure symptoms, severe headache, severe dizziness, nausea, wheezing, dyspnea at rest, or unusual shortness of breath"
        - "clearly worse sleep, insomnia, agitation, irritability, hypomania or mania-like symptoms, lowered mood, or mood instability without a better explanation"
        - "new medication, photosensitizing treatment, PDT, skin procedure, wound, rash, sunburn, tattoo irritation, or device malfunction that invalidates the original safety screen or dose setup"
  setupSlots:
    - id: "device_model"
      label: "Device model"
      question: "What exact whole-body red/NIR PBM device model would you use?"
      target:
        object: "protocol"
        field: "personalization.setup.deviceModel"
    - id: "wavelengths"
      label: "Red/NIR wavelengths"
      question: "What red and near-infrared wavelengths does the device report for the mode you plan to use?"
      target:
        object: "protocol"
        field: "personalization.setup.wavelengths"
    - id: "irradiance_fluence"
      label: "Irradiance or fluence"
      question: "What irradiance and/or fluence does the device report for your distance, mode, and session length? If unavailable, say unknown and keep the run parameter-logged rather than dose-claimed."
      target:
        object: "protocol"
        field: "personalization.setup.irradianceFluence"
    - id: "session_duration_minutes"
      label: "Session duration"
      question: "How many minutes will each session last? This starter caps sessions at 20 minutes and should start at the lower of the device instructions and the candidate range."
      constraints:
        default: 12
        min: 1
        max: 20
        recommendedOptions:
          - 12
          - 15
          - 20
      target:
        object: "experimentRun"
        field: "sessionDurationMinutes"
    - id: "session_timing"
      label: "Session timing"
      question: "Which stable session window is realistic for the 28-day intervention?"
      options:
        - "morning"
        - "midday"
        - "afternoon"
        - "early_evening"
        - "variable_but_logged"
      target:
        object: "experimentRun"
        field: "sessionTiming"
    - id: "exposure_geometry_body_coverage"
      label: "Exposure geometry and body coverage"
      question: "What exposure geometry will you use: distance, front-only or front-and-back, position, clothing/body coverage, and any areas excluded?"
      target:
        object: "protocol"
        field: "personalization.setup.exposureGeometryBodyCoverage"
    - id: "eye_protection"
      label: "Eye protection"
      question: "What device-appropriate eye protection will you use for every session, and how will you avoid direct emitter gaze?"
      target:
        object: "protocol"
        field: "personalization.setup.eyeProtection"
    - id: "nonthermal_comfort"
      label: "Nonthermal comfort"
      question: "Can you keep sessions clearly nonthermal and stop immediately if skin feels hot, burning, painful, or unusually warm?"
      options:
        - "yes_nonthermal_and_stop_if_warm"
        - "unsure_or_device_feels_hot"
      target:
        object: "protocol"
        field: "personalization.setup.nonthermalComfort"
    - id: "logging_path"
      label: "Logging path"
      question: "Where should Murph record session parameters, symptoms, confounders, and next-morning sleep/recovery ratings?"
      options:
        - "murph_experiment_log"
        - "daily_journal"
        - "spreadsheet_import"
        - "other_logged_path"
      target:
        object: "experimentRun"
        field: "logging.path"
    - id: "reminder_policy"
      label: "Reminder preference"
      question: "Do you want reminders for the three weekly sessions and any missing logs?"
      options:
        - "none"
        - "session_reminders_only"
        - "session_reminders_plus_same_day_missing_log_check"
        - "weekly_digest_only"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "whole-body-pbm-rhr-sleep-42d"
    firstSessionGuidance: "Start at the lower of the device beginner instructions and the 12-20 minute candidate range, keep the session clearly nonthermal, use eye protection, avoid direct emitter gaze, and log all device parameters and symptoms."
  trackingHints:
    confounderFields:
      - "bedtime_or_wake_time_change"
      - "caffeine_alcohol_or_late_meal_change"
      - "exercise_training_load_change"
      - "sauna_heat_cold_or_light_intervention"
      - "new_sleep_recovery_supplement_or_skin_intervention"
      - "medication_change_or_photosensitizing_exposure"
      - "illness_pain_travel_or_timezone_shift"
      - "major_stress"
      - "wearable_model_or_algorithm_change"
      - "wounds_rash_sunburn_tattoo_or_skin_irritation"
    notes:
      - "Missing sessions should be logged honestly; do not make up adherence by continuing through symptoms."
      - "Irradiance or fluence may be unknown for some consumer devices, but the unknown must be recorded and should limit dose claims."
  supportHints:
    missedLogFollowupCopy: "Did you complete or intentionally skip the whole-body red/NIR PBM session today? Either answer is useful — I just want the experiment record to be accurate."
whyItWorks:
  - "## Light is dose, not color\n\nRed/NIR PBM depends on wavelength, irradiance, fluence, duration, distance, and coverage. Marketing color names do not define the biological exposure."
  - "## Cells shift signaling\n\nPhotons affect mitochondrial, nitric-oxide, inflammatory, and oxidative-stress pathways. The effect is nonthermal; heat turns it into a different protocol."
  - "## Recovery signal is systemic but weak\n\nLarge-area exposure can change autonomic or vascular tone. Resting HR and RMSSD track whether recovery load drops without overclaiming sleep or performance."
mechanismChain:
  -
    label: "Session"
    content: "Whole-body red/NIR PBM · 3x/week · nonthermal"
  -
    label: "Light dose"
    content: "Photons affect mitochondrial, nitric-oxide, and inflammatory signaling"
  -
    label: "Repeated signal"
    content: "Large-area cell signal repeats with same geometry and dose"
  -
    label: "Adaptation"
    content: "Recovery load drops · vascular tone eases · RHR and RMSSD track response"
claims:

  -
    claimId: page-scope-is-one-variant-not-all-red-light
    type: evidence_scope
    text: "This page is for one cautious Murph variant of whole-body red and near-infrared photobiomodulation, not for every red-light therapy use case, all PBM, or all light-based sleep interventions."
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
    claimId: gated-planning-only-onboarding
    type: design_guardrail
    text: "This protocol can support only a high-caution, planning-first Murph onboarding path: the assistant may gather safety, device, dose, timing, eye-protection, exposure-geometry, logging, and reminder details, but should not create an active experiment or automation until the user explicitly confirms the limited-evidence posture and all required setup gates."
    strength: high
    sourceKeys:
      - source_artifact:clinicaltrials-gov-nct05116605-2026-04-23
      - source_artifact:clinicaltrials-gov-nct05963555-2026-04-23
      - source_artifact:pmid-41228430
      - source_artifact:pmid-36671752
      - source_artifact:pmid-40253006
researchLandscape:
  bottomLine: "Whole-body red and near-infrared photobiomodulation is plausible enough for a careful measurement-first field test, but the direct evidence for this exact general variant is still limited, adjacent, device-specific, and parameter-sensitive."
  confidenceLabel: "limited"
  primaryClaim: "A cautious, explicitly logged whole-body red/NIR routine can support a gated measurement-first field test, not a validated sleep or recovery intervention."
  mainCaveat: "Much of the stronger or more positive literature belongs to sibling variants, adjacent modalities, or narrow populations rather than to a general healthy-adult whole-body protocol."
  groups:

    -
      id: "family-definition-and-boundaries"
      label: "Family definition and boundaries"
      stance: "context_only"
      summary: "Whole-body photobiomodulation should stay separate from localized PBM, red-light glasses, bright-light therapy, infrared sauna, and UV-tanning protocols."
      sourceKeys:
        - "source_artifact:iarc-sunbeds-uv-radiation-2009-07-29"
        - "source_artifact:pmid-19602651"
        - "source_artifact:pmid-36927734"
        - "source_artifact:pmid-37002704"
        - "source_artifact:pmid-37593770"
        - "source_artifact:pmid-40253006"
    -
      id: "direct-sleep-and-wellbeing-evidence"
      label: "Direct sleep and wellbeing evidence"
      stance: "mixed"
      summary: "Direct whole-body sleep evidence is sparse; the closest controlled wellness trial is adjacent partial-body and null for sleep or circadian benefit, while direct whole-body sleep registries mostly contribute implementation context. The acute women-only metabolic crossover is direct whole-body exposure, but it should stay as metabolic context rather than sleep-efficacy evidence."
      sourceKeys:
        - "source_artifact:clinicaltrials-gov-nct05116605-2026-04-23"
        - "source_artifact:clinicaltrials-gov-nct05963555-2026-04-23"
        - "source_artifact:pmid-36671752"
        - "source_artifact:pmid-41228430"
    -
      id: "dose-and-implementation"
      label: "Dose and implementation"
      stance: "context_only"
      summary: "Several extracted whole-body implementations use 12- to 20-minute sessions and 2–3 or 3 sessions per week, but these are device- and population-specific examples rather than a standardized dose; parameter standardization is poor and explicit dose logging matters."
      sourceKeys:
        - "source_artifact:clinicaltrials-gov-nct05116605-2026-04-23"
        - "source_artifact:clinicaltrials-gov-nct05963555-2026-04-23"
        - "source_artifact:pmid-30044464"
        - "source_artifact:pmid-30550048"
        - "source_artifact:pmid-35222905"
        - "source_artifact:pmid-37018063"
        - "source_artifact:pmid-40253006"
        - "source_artifact:pmid-41228430"
    -
      id: "sibling-variant-literatures"
      label: "Sibling variant literatures"
      stance: "context_only"
      summary: "Athlete and exercise-timed recovery literature is mixed and includes null or trade-off signals, while fibromyalgia, chronic-pain, and cosmetic large-area PBM literatures are condition- or endpoint-specific and should remain separate from the general Murph variant."
      sourceKeys:
        - "source_artifact:doi-10.1101-2023.03.03.23286452"
        - "source_artifact:pmid-24286286"
        - "source_artifact:pmid-33345040"
        - "source_artifact:pmid-35222905"
        - "source_artifact:pmid-36006085"
        - "source_artifact:pmid-36369323"
        - "source_artifact:pmid-37099210"
        - "source_artifact:pmid-37753995"
        - "source_artifact:pmid-38356644"
        - "source_artifact:pmid-39883205"
        - "source_artifact:pmid-41710353"
    -
      id: "safety-and-screening-boundaries"
      label: "Safety and screening boundaries"
      stance: "safety_boundary"
      summary: "Eye safety, high-local-dose skin reactions, photosensitizing and healing-risk medications, oncology context, thyroid and skin-boundary exclusions, and registry exclusion patterns for pregnancy or lactation, seizure risk, pacemakers or implanted devices, unstable cardiovascular, metabolic, neurologic, pulmonary, or psychiatric disease all argue for stronger screening than the internet red-light narrative usually uses."
      sourceKeys:
        - "source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30"
        - "source_artifact:clinicaltrials-gov-nct05116605-2026-04-23"
        - "source_artifact:clinicaltrials-gov-nct06678698-2026-04-23"
        - "source_artifact:clinicaltrials-gov-nct06866522-2026-04-23"
        - "source_artifact:clinicaltrials-gov-nct07047248-2026-04-23"
        - "source_artifact:clinicaltrials-gov-nct07271927-2026-04-23"
        - "source_artifact:ensaiosclinicos-rbr-8v7rsdp-2026-04-23"
        - "source_artifact:ensaiosclinicos-rbr-9vcph8x-2026-04-23"
        - "source_artifact:pmid-24590242"
        - "source_artifact:pmid-28891192"
        - "source_artifact:pmid-29466089"
        - "source_artifact:pmid-31109692"
        - "source_artifact:pmid-31483941"
        - "source_artifact:pmid-33107198"
        - "source_artifact:pmid-33921839"
        - "source_artifact:pmid-34021422"
        - "source_artifact:pmid-34451820"
        - "source_artifact:pmid-36110957"
        - "source_artifact:pmid-38180093"
        - "source_artifact:pmid-39319750"
        - "source_artifact:pmid-39335685"
        - "source_artifact:pmid-39672511"
    -
      id: "590nm-photoaging-cohort"
      label: "590nm Photoaging Cohort"
      stance: "context_only"
      summary: "An early 590 nm full-panel facial photomodulation cohort reported photoaging improvement in 90% of participants with no side effects noted. The 590nm Photoaging Cohort group currently links one appraisal-backed source with adjacent variant scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-15624743"
    -
      id: "590nm-photoaging-trial"
      label: "590nm Photoaging Trial"
      stance: "context_only"
      summary: "Eight 590 nm full-face LED treatments were associated with clinical, profilometric, and histologic photoaging improvements. The 590nm Photoaging Trial group currently links one appraisal-backed source with adjacent variant scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-15654716"
    -
      id: "633-830-facial-single-arm"
      label: "633 830 Facial Single Arm"
      stance: "context_only"
      summary: "Combined 633 nm and 830 nm facial LED therapy improved wrinkle-related profilometry and patient-reported softness in a small single-arm study. The 633 830 Facial Single Arm group currently links one appraisal-backed source with adjacent variant scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-16414908"
    -
      id: "633-830-photoaged-skin"
      label: "633 830 Photoaged Skin"
      stance: "context_only"
      summary: "Nine combined 633/830 nm facial LED treatments were associated with wrinkle improvement and thicker collagen fibers on electron microscopy. The 633 830 Photoaged Skin group currently links one appraisal-backed source with adjacent variant scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-16989189"
    -
      id: "660nm-frequency-facial-rct"
      label: "660nm Frequency Facial RCT"
      stance: "context_only"
      summary: "A facial rejuvenation frequency trial found null photographic wrinkle-score differences but positive ImageJ and satisfaction signals, with no clear gain from the higher session frequency. The 660nm Frequency Facial RCT group currently links one appraisal-backed source with adjacent variant scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-40167796"
    -
      id: "acute-agility-preliminary"
      label: "Acute Agility Preliminary"
      stance: "mixed"
      summary: "Acute whole-body PBM did not outperform placebo on the Illinois Agility Test in a preliminary trained-participant crossover study. The Acute Agility Preliminary group currently links one appraisal-backed source with adjacent variant scope and no clear advantage interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:doi-10.1016-j.bjpt.2024.100751"
    -
      id: "bright-light-therapy-boundary"
      label: "Bright Light Therapy Boundary"
      stance: "context_only"
      summary: "Bright-light therapy showed modest antidepressant benefit in seasonal affective disorder, but this is bright-light psychiatry evidence rather than whole-body PBM evidence. The Bright Light Therapy Boundary group currently links one appraisal-backed source with adjacent variant scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-31574513"
    -
      id: "chronic-pain-feasibility-protocol"
      label: "Chronic Pain Feasibility Protocol"
      stance: "context_only"
      summary: "Protocol outlines a supervised NHS whole-body NovoTHOR feasibility pathway for chronic pain, but no efficacy results are reported. The Chronic Pain Feasibility Protocol group currently links one appraisal-backed source with clinical supervised scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-35768101"
    -
      id: "chronic-pain-nihr-registry"
      label: "Chronic Pain Nihr Registry"
      stance: "context_only"
      summary: "NIHR listing confirms a UK whole-body PBM chronic-pain study, but it does not contribute extracted outcome results. The Chronic Pain Nihr Registry group currently links one appraisal-backed source with clinical supervised scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:nihr-whole-body-photobiomodulation-chronic-pain-nct05069363-2022-06-26"
    -
      id: "clinical-psychiatric-pbm-boundary"
      label: "Clinical Psychiatric PBM Boundary"
      stance: "context_only"
      summary: "The review describes preliminary antidepressant and mechanistic signals for transcranial or systemic PBM, but evidence quality was limited and not specific to whole-body exposure. The Clinical Psychiatric PBM Boundary group currently links one appraisal-backed source with same mechanism scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-30248638"
    -
      id: "crows-feet-mask-rct"
      label: "Crows Feet Mask RCT"
      stance: "safety_boundary"
      summary: "A sham-controlled 630/850 nm periocular mask trial found significant wrinkle-score improvements and described treatment as safe, well tolerated, and painless. The Crows Feet Mask RCT group currently links one appraisal-backed source with general guideline scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39960921"
    -
      id: "dermatology-led-meta-analysis"
      label: "Dermatology Led Meta Analysis"
      stance: "safety_boundary"
      summary: "This dermatology LED meta-analysis showed strong pooled acne effects and positive direction for some yellow/NIR applications, but important heterogeneity for other conditions. The Dermatology Led Meta Analysis group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-36310510"
    -
      id: "dermatology-led-rct-review"
      label: "Dermatology Led RCT Review"
      stance: "safety_boundary"
      summary: "A dermatology LED review found generally few reported adverse events, but the evidence base was heterogeneous and often methodologically weak. The Dermatology Led RCT Review group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-29356026"
    -
      id: "exercise-pbmt-guideline"
      label: "Exercise Pbmt Guideline"
      stance: "context_only"
      summary: "Recommendations paper argues that PBMT has a dose window and that future sports trials need stronger reporting, but it is built mainly on localized PBMT evidence rather than whole-body trials. The Exercise Pbmt Guideline group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-30591412"
    -
      id: "female-basketball-red-light-rct"
      label: "Female Basketball Red Light RCT"
      stance: "supports"
      summary: "Nightly whole-body red-light exposure improved sleep quality, increased serum melatonin, and improved 12-minute run performance in elite female basketball players. The Female Basketball Red Light RCT group currently links one appraisal-backed source with adjacent variant scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-23182016"
    -
      id: "fm-circadian-mechanistic-rct"
      label: "Fm Circadian Mechanistic RCT"
      stance: "supports"
      summary: "Placebo-controlled fibromyalgia RCT reported physiologic changes in circadian blood pressure, tenderness thresholds, and tissue elasticity after whole-body PBM. The Fm Circadian Mechanistic RCT group currently links one appraisal-backed source with clinical supervised scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-36359198"
    -
      id: "fm-circadian-registry"
      label: "Fm Circadian Registry"
      stance: "context_only"
      summary: "Registry identifies a completed whole-body PBM fibromyalgia trial focused on circadian blood pressure, but no extracted results are included here. The Fm Circadian Registry group currently links one appraisal-backed source with clinical supervised scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-gov-nct05113589-2026-04-23"
    -
      id: "fm-experience-analysis"
      label: "Fm Experience Analysis"
      stance: "context_only"
      summary: "Qualitative interviews described a positive recovery-like process during whole-body PBMT, but this is experiential rather than controlled efficacy evidence. The Fm Experience Analysis group currently links one appraisal-backed source with clinical supervised scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-38791077"
    -
      id: "fm-pbmt-scoping-review"
      label: "Fm Pbmt Scoping Review"
      stance: "context_only"
      summary: "Scoping review mapped promising but heterogeneous fibromyalgia PBMT evidence and argued that many NICE concerns may be addressable by existing literature. The Fm Pbmt Scoping Review group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:doi-10.3390-ctn9030029"
    -
      id: "fm-pbmt-systematic-review"
      label: "Fm Pbmt Systematic Review"
      stance: "mixed"
      summary: "Fibromyalgia systematic review reported overall PBMT benefit and suggested more sustained effects for whole-body delivery than localized treatment. The Fm Pbmt Systematic Review group currently links one appraisal-backed source with adjacent variant scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:doi-10.3390-app15084161"
    -
      id: "fm-rct-registry"
      label: "Fm RCT Registry"
      stance: "context_only"
      summary: "Registry identifies the sham-controlled fibromyalgia whole-body PBM program but does not contribute extracted outcome results here. The Fm RCT Registry group currently links one appraisal-backed source with clinical supervised scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-gov-nct04248972-2026-04-23"
    -
      id: "foundational-sleep-pbm-commentary"
      label: "Foundational Sleep PBM Commentary"
      stance: "context_only"
      summary: "Commentary argues PBM may improve sleep, especially via nocturnal transcranial mechanisms, but it does not provide direct whole-body efficacy data. The Foundational Sleep PBM Commentary group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-36018149"
    -
      id: "intranasal-pbm-boundary"
      label: "Intranasal PBM Boundary"
      stance: "context_only"
      summary: "Intranasal PBM is positioned as a distinct local or systemic-adjacent PBM strategy, not as whole-body exposure. The Intranasal PBM Boundary group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-31812948"
    -
      id: "intranasal-phototherapy-boundary"
      label: "Intranasal Phototherapy Boundary"
      stance: "safety_boundary"
      summary: "NICE concluded that evidence for intranasal phototherapy in allergic rhinitis was limited in quantity and quality and should remain in research settings. The Intranasal Phototherapy Boundary group currently links one appraisal-backed source with clinical supervised scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:nice-intranasal-phototherapy-for-allergic-rhinitis-2018-06-13"
    -
      id: "oncology-commentary-evidence-hierarchy"
      label: "Oncology Commentary Evidence Hierarchy"
      stance: "safety_boundary"
      summary: "This commentary emphasizes that existing in vivo and clinical PBMT evidence is more relevant than theoretical in vitro concern when judging tumor safety. The Oncology Commentary Evidence Hierarchy group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-32198559"
    -
      id: "oral-oncology-pbm-boundary"
      label: "Oral Oncology PBM Boundary"
      stance: "safety_boundary"
      summary: "Localized PBM was recommended for prevention of oral mucositis in specific supervised oncology settings, with no general treatment recommendation and no parameter interchangeability. The Oral Oncology PBM Boundary group currently links one appraisal-backed source with clinical supervised scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-31286228"
    -
      id: "pbm-umbrella-review"
      label: "PBM Umbrella Review"
      stance: "mixed"
      summary: "Umbrella review found the strongest fibromyalgia support for fatigue, while several other fibromyalgia endpoints remained low or very low certainty or nonsignificant. The PBM Umbrella Review group currently links one appraisal-backed source with same mechanism scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-40770824"
    -
      id: "regulatory-definition-and-safety-boundaries"
      label: "Regulatory Definition And Safety Boundaries"
      stance: "context_only"
      summary: "FDA defines PBM as non-heating light therapy and expects wavelength, dose, irradiance, pulsing, target-area, and safety reporting in premarket submissions. The Regulatory Definition And Safety Boundaries group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-pbm-devices-guidance-2023-01-12"
    -
      id: "rugby-isokinetic-registry"
      label: "Rugby Isokinetic Registry"
      stance: "context_only"
      summary: "Suspended registry describes an acute rugby crossover protocol testing whole-body PBM before isokinetic fatigue and DOMS assessment, but no results are posted. The Rugby Isokinetic Registry group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:ensaiosclinicos-rbr-7x65zj-2026-04-23"
    -
      id: "sleep-pbm-review-context"
      label: "Sleep PBM Review Context"
      stance: "context_only"
      summary: "Review says PBM-sleep research is promising but still early, heterogeneous, and under-standardized. The Sleep PBM Review Context group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:doi-10.17241-smr.2024.02593"
    -
      id: "soccer-prepost-sham-registry"
      label: "Soccer Prepost Sham Registry"
      stance: "mixed"
      summary: "Completed registry materials suggest timing-dependent benefits for CK and soreness, but neither pre- nor post-exercise whole-body PBM improved muscle performance. The Soccer Prepost Sham Registry group currently links one appraisal-backed source with adjacent variant scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-gov-nct05989815-2026-04-23"
    -
      id: "sports-pbm-narrative-review"
      label: "Sports PBM Narrative Review"
      stance: "context_only"
      summary: "Narrative review summarizes potential sports benefits and mechanisms for PBM, while emphasizing that dosage and treatment parameters are not yet standardized. The Sports PBM Narrative Review group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-34947870"
    -
      id: "state-championship-soccer-registry"
      label: "State Championship Soccer Registry"
      stance: "context_only"
      summary: "Recruiting registry describes a season-long whole-body PBM soccer protocol with repeated soreness, strength, jump, blood-count, and PSQI endpoints, but no outcomes are available yet. The State Championship Soccer Registry group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-gov-nct07224646-2026-04-23"
    -
      id: "terminology-standardization"
      label: "Terminology Standardization"
      stance: "context_only"
      summary: "This editorial supports using photobiomodulation therapy terminology rather than older low-level light or laser labels. The Terminology Standardization group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-25844681"
    -
      id: "trained-dynamometry-agility-registry"
      label: "Trained Dynamometry Agility Registry"
      stance: "context_only"
      summary: "Recruiting registry tests acute full-body PBM against placebo in trained men with torque, fatigue, agility, soreness, and perceived recovery outcomes. The Trained Dynamometry Agility Registry group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:ensaiosclinicos-rbr-8ksktby-2026-04-23"
    -
      id: "transcranial-pbm-boundary"
      label: "Transcranial PBM Boundary"
      stance: "context_only"
      summary: "Meta-analysis found better cognitive performance after transcranial PBM in young healthy adults, but the intervention was focal brain-directed PBM rather than whole-body exposure. The Transcranial PBM Boundary group currently links one appraisal-backed source with same mechanism scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-31549906"
    -
      id: "uv-tanning-safety-boundary"
      label: "UV Tanning Safety Boundary"
      stance: "safety_boundary"
      summary: "WHO places artificial tanning devices in a UV-risk and public-health-regulation domain rather than a therapeutic PBM domain. USPSTF recommends counseling to reduce ultraviolet exposure and avoid indoor tanning, reinforcing the UV-risk boundary. The UV Tanning Safety Boundary group currently links 2 appraisal-backed sources with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:uspstf-skin-cancer-prevention-behavioral-counseling-2018-03-20"
        - "source_artifact:who-artificial-tanning-devices-2017-06-13"
    -
      id: "water-polo-postmatch-rct"
      label: "Water Polo Postmatch RCT"
      stance: "mixed"
      summary: "Five-minute full-body PBM after matches did not improve most hormonal, inflammatory, autonomic, strength, or jump recovery measures in young water polo athletes. The Water Polo Postmatch RCT group currently links one appraisal-backed source with adjacent variant scope and no clear advantage interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-33332232"
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
    - pregnancy_lactation_or_breastfeeding
    - under_18_years_old
    - active_or_recent_cancer_treatment
    - skin_cancer_history
    - concerning_or_changing_skin_lesions
    - recent_photodynamic_therapy_drug
    - photosensitizing_medication
    - photosensitivity_or_photophobia
    - light_triggered_symptoms
    - retinoid_or_steroid_impairing_healing
    - seizure_disorder_or_photosensitive_epilepsy
    - eye_disease_or_retinal_disease
    - recent_eye_surgery
    - unresolved_visual_symptoms
    - implanted_electrical_or_medical_device
    - pacemaker
    - arrhythmia_or_unstable_cardiovascular
    - severe_hypertension
    - unstable_cardiometabolic_disease
    - diabetes_with_severe_complications
    - insulin_dependence_unstable_glucose
    - planned_medication_holds
    - unstable_neurologic_disease
    - severe_cognitive_or_sensory_impairment
    - significant_pulmonary_disease
    - dyspnea_at_rest_or_hypoxemia
    - thyroid_or_parathyroid_with_neck_exposed
    - severe_psychiatric_instability
    - bipolar_or_mania_hypomania_risk
    - diagnosed_sleep_disorder
    - night_shift_or_recent_timezone_travel
    - open_wounds_burns_or_sunburn
    - active_rash_or_skin_infection
    - herpes_outbreak_in_exposed_areas
    - concerning_lesions_in_exposed_areas
    - inability_to_detect_heat_or_pain
    - unable_to_follow_device_instructions
    - device_fit_or_positioning_constraints
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
    - Bounded field test with gated onboarding — not disease treatment or auto-experiment creation.
    - Use only documented non-UV, nonthermal red/NIR PBM devices — no sauna, tanning, IPL, laser, or heat.
    - Wear device-appropriate eye protection every session and avoid direct emitter gaze.
    - Do not stop, hold, or change prescribed medication for this protocol.
    - Missed sessions are fine — never push through symptoms to meet adherence.
    - Safety language stays stronger than efficacy language — direct evidence is still sparse.
---

Red Light Therapy is plausible enough for cautious field testing when implemented as whole-body red and near-infrared photobiomodulation, but the direct evidence for this exact Murph variant is much thinner than the broader PBM internet narrative suggests.

## What this page is trying to answer

This page asks a narrow question: if someone uses a **nonthermal whole-body red/NIR light-bed setup** in a consistent, explicitly logged way for four weeks, is there a detectable personal signal in sleep, next-day sleepiness, recovery, or resting heart rate?

## Why this version is cautious

The direct literature is not strong enough to promise a result. The strongest general-wellness controlled record in the landing set is a **partial-body** daytime 850 nm trial with winter-only mood, drowsiness, inflammatory, and resting-heart-rate signals but **no significant sleep or circadian benefit**. The direct whole-body sleep records are mainly registries that help with cadence, endpoints, and exclusions rather than with efficacy. Acute direct whole-body evidence also exists in a narrow women-only metabolic study, but that is not a general sleep study.

## Who should not use this as an ordinary self-experiment

Do not use this ordinary wellness protocol without clinician guidance if you are pregnant or breastfeeding; are under 18; have seizure risk, photophobia, photosensitivity, eye disease, recent eye surgery, active or recent cancer treatment, skin-cancer history, suspicious or changing skin lesions, thyroid disease, an implanted medical device, unstable cardiovascular, metabolic, neurologic, pulmonary, or psychiatric disease, diabetes medication constraints, open wounds, active rash, sunburn, skin infection, herpes outbreak, or recent photodynamic therapy drug exposure. Also do not use this protocol if you cannot reliably detect or report heat, pain, skin symptoms, or visual symptoms. These boundaries come from safety reviews, medication guidance, and supervised or registered protocol exclusions rather than from proven risk rates.


## What stays separate

This page is not the place to import efficacy claims from athlete recovery beds, fibromyalgia or chronic-pain PBM, cosmetic or photoaging beds, transcranial or intranasal PBM, red-light glasses, bright-light therapy, infrared sauna, or UV tanning. The athlete/recovery bucket is mixed and includes null performance and fatigue-biomarker evidence; fibromyalgia and cosmetic signals are condition- or endpoint-specific. Those literatures help define boundaries, not generic efficacy.

## Stop rules

Stop the session immediately for eye pain, blurred vision, visual disturbance, unusual light sensitivity, new floaters, a persistent afterimage, accidental direct gaze followed by lingering symptoms, burning or hot skin, blistering, persistent redness, rash, swelling, wound or lesion irritation, severe headache, dizziness, nausea, confusion, fainting, seizure symptoms, chest symptoms, palpitations, wheezing, unusual shortness of breath, or marked mood or sleep worsening. Do not finish sessions just to hit an adherence target. Eye, skin, medication, and mood-related adverse-event signals are mostly adjacent rather than direct whole-body evidence, which is exactly why the stop rules should be stricter than the efficacy language.

## How to read your result

A positive result would mean your own baseline shifted in a repeatable direction while device, timing, coverage, and other confounders stayed fairly stable. A null or mixed result is still informative here, and worsening sleep duration or sleep-stage estimates should be treated as a real negative signal rather than ignored, because adjacent repeated-use wearable data include both lower sleeping heart rate and shorter sleep durations.
