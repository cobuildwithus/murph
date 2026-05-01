---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:intermittent-pneumatic-compression/pneumatic-compression-pants
slug: protocols/intermittent-pneumatic-compression/pneumatic-compression-pants
title: Pneumatic Compression Pants
summary: Pneumatic compression pants that rhythmically squeeze the legs, helping move blood and fluids to potentially ease soreness and improve comfort after exercise.
status: field-testing
quality: usable
aliases:
- pneumatic compression pants
- recovery boots
- IPC recovery boots
- pressotherapy pants
- intermittent pneumatic compression pants
- Normatec-style recovery boots
- sequential pneumatic compression pants
categories:
- recovery
- exercise-recovery
- compression
- circulation
- comfort
- murph-canonical
relations:
- type: parent_family
  target: experiment_family:intermittent-pneumatic-compression
- type: primary_biomarker
  target: biomarker:muscle-soreness-score
- type: secondary_biomarker
  target: biomarker:leg-heaviness-score
- type: secondary_biomarker
  target: biomarker:perceived-recovery-score
- type: safety_outcome
  target: biomarker:adverse-symptoms
- type: cites
  target: source_artifact:doi-10.1519-ssc.0000000000000892
- type: cites
  target: source_artifact:pmid-35456170
- type: cites
  target: source_artifact:pmid-39416507
- type: cites
  target: source_artifact:pmid-33418535
- type: cites
  target: source_artifact:pmid-40325678
- type: cites
  target: source_artifact:doi-10.1007-s11332-024-01217-5
- type: cites
  target: source_artifact:pmid-27011305
- type: cites
  target: source_artifact:pmid-40094188
- type: cites
  target: source_artifact:pmid-40555415
- type: cites
  target: source_artifact:pmid-41048245
- type: cites
  target: source_artifact:pmid-41656279
- type: cites
  target: source_artifact:pmid-29513036
- type: cites
  target: source_artifact:pmid-35475921
- type: cites
  target: source_artifact:pmid-41003610
- type: cites
  target: source_artifact:pmid-41718172
- type: cites
  target: source_artifact:pmid-34774089
- type: cites
  target: source_artifact:pmid-29122964
- type: cites
  target: source_artifact:pmid-30300043
- type: cites
  target: source_artifact:pmid-41768774
- type: cites
  target: source_artifact:pmid-34260560
- type: cites
  target: source_artifact:pmid-36419142
- type: cites
  target: source_artifact:doi-10.1186-s13102-019-0138-4
- type: cites
  target: source_artifact:pmid-35741420
- type: cites
  target: source_artifact:cdc-dvt-pe-travel-2025-04-23
- type: cites
  target: source_artifact:pmid-21083651
- type: cites
  target: source_artifact:pmid-28042639
- type: cites
  target: source_artifact:pmid-33878207
- type: cites
  target: source_artifact:pmid-30738701
- type: cites
  target: source_artifact:pmid-16879230
- type: cites
  target: source_artifact:pmid-17012016
- type: cites
  target: source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
- type: cites
  target: source_artifact:pmid-22315261
- type: cites
  target: source_artifact:pmid-30482763
- type: cites
  target: source_artifact:fhi-ipc-acute-stroke-hta-2020-12-22
- type: cites
  target: source_artifact:pmid-23727163
- type: cites
  target: source_artifact:pmid-30779530
- type: cites
  target: source_artifact:cms-pneumatic-compression-devices-2002-01-14
- type: cites
  target: source_artifact:pmid-39207406
- type: cites
  target: source_artifact:pmid-32521126
- type: cites
  target: source_artifact:pmid-38743805
- type: cites
  target: source_artifact:doi-10.1111-ddg.15415
- type: cites
  target: source_artifact:pmid-24974070
- type: cites
  target: source_artifact:pmid-30339493
- type: cites
  target: source_artifact:pmid-31531971
- type: cites
  target: source_artifact:hyperice-normatec-contraindications-2021-09-07
- type: cites
  target: source_artifact:hyperice-normatec-elite-safety-instructions-2024-06-04
- type: cites
  target: source_artifact:therabody-pneumatic-compression-precautions-2026-04-25
- type: cites
  target: source_artifact:therabody-jetboots-recoveryair-manuals-2026-04-25
- type: cites
  target: source_artifact:fda-normatec3-510k-k220217-2022-02-25
- type: cites
  target: source_artifact:pmid-32122269
- type: cites
  target: source_artifact:awmf-intermittent-pneumatic-compression-2025-04-28
- type: cites
  target: source_artifact:vasocare-legacy-ipc-user-manual-2023-10-10
- type: cites
  target: source_artifact:clevelandclinic-intermittent-pneumatic-compression-2023-04-18
- type: cites
  target: source_artifact:hopkinsmedicine-ipc-dvt-prevention-2026-04-25
- type: cites
  target: source_artifact:pmid-34528370
- type: cites
  target: source_artifact:pmid-38300926
- type: cites
  target: source_artifact:doi-10.1016-j.jemrpt.2025.100150
- type: cites
  target: source_artifact:pmid-1580778
- type: cites
  target: source_artifact:pmid-23549834
- type: cites
  target: source_artifact:pmid-2586562
- type: cites
  target: source_artifact:pmid-30100856
- type: cites
  target: source_artifact:pmid-10719972
- type: cites
  target: source_artifact:pmid-16484746
- type: cites
  target: source_artifact:pmid-40065876
- type: cites
  target: source_artifact:pmid-3782217
- type: cites
  target: source_artifact:doi-10.1177-02683555221145779
- type: cites
  target: source_artifact:doi-10.3390-life15050725
- type: cites
  target: source_artifact:pmid-39846675
lineage:
  relationship: root
  rationale: Default Murph consumer lower-limb IPC variant for generally healthy recovery or leg-comfort self-testing; clinical IPC, travel VTE prevention, and disease-treatment variants remain separate.
attribution:
  ownerType: murph
protocol:
  doseSignature: 3x/week target · 8–12 sessions over 21 days · 20–30 min · lowest comfortable pressure/intensity · after exercise or leg-comfort trigger · 7-day baseline first
  target: consumer lower-limb pneumatic compression pants, boots, or leg sleeves
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 20
    max: 30
  interventionSessionsMinimum: 8
  interventionSessionsTarget: 12
  steps:
  - Complete the safety screen before the first session; do not start if the goal is clot prevention, swelling treatment, wound care, post-surgical prophylaxis, or another medical use.
  - Record the device model, garment coverage, pressure or intensity level, compression mode, planned duration, posture, and trigger context before the first intervention session.
  - Inspect the skin that will sit under the garment; check that the garment, hose, pump, charger, and quick-release or power-off path are intact and reachable; and confirm the garment is not pressing focally on the fibular head, knee, ankle, groin/genitals, surgical site/hardware, skin graft/bypass area, or another bony prominence.
  - Sit or recline in a stable position. Do not walk while wearing leg attachments; keep the disconnect or power-off path reachable; avoid any setup where tubing, cords, or inflated garments create a tripping/fall hazard or prevent quick removal.
  - Start with the lowest comfortable pressure or intensity that produces compression without pain, numbness, tingling, pressure hot spots, or a need to brace against the device; do not copy high-pressure study settings or use the device maximum as a target.
  - Run a 20–30 minute session after the chosen trigger, such as a hard workout or a prolonged standing/sitting day. Keep the rest of the recovery routine as stable as practical.
  - Stop early if any stop condition occurs. After the session, remove the garment, inspect the skin again, and log soreness, fatigue, perceived recovery, leg heaviness, comfort, pressure, duration, and symptoms.
  - For the 21-day intervention window, keep device, pressure, duration, mode, and timing consistent unless safety or comfort requires lowering the dose.
  safetyNotes:
  - This is not a DVT/PE-prevention, lymphedema/lipedema, wound-care, PAD/CLTI, venous-ulcer, post-thrombotic-syndrome, diabetes-foot-risk, or post-surgical protocol.
  - Safety screening and stop rules are stronger than efficacy claims because direct recovery trials do not provide a robust consumer adverse-event denominator.
  - Use clinician guidance before starting if any relevant medical condition, medication, recent surgery/injury, sensory issue, skin issue, unexplained swelling, or clot/travel-risk context makes compression risk uncertain.
  tips:
  - Use the same device and settings during the intervention so the personal signal is not confounded by changing the dose.
  - Pair each session with a simple 0–10 soreness or leg-heaviness rating and a 0–10 perceived-recovery or readiness rating.
  - Avoid stacking a new massage routine, cold plunge, sauna, aggressive stretching, supplement, or major training-load change during the test window.
  - If a session feels too intense, lower pressure or stop; higher pressure is not a proven better dose.
  - For travel or prolonged sitting, this protocol is comfort-only. It does not replace walking/mobility breaks, calf exercises, prescribed stockings, anticoagulation, or a clinician-directed VTE plan; high-risk travelers should ask a clinician before relying on any compression strategy.
  keepInMind:
  - The direct evidence is mixed and strongest for subjective soreness or perceived recovery, not for guaranteed performance, muscle-damage, biomarker, wearable-recovery, or inflammation changes.
  - Most direct studies used athletic or healthy post-exercise settings; disease, travel-risk, and hospital IPC evidence belongs to separate supervised branches.
  - Consumer devices differ in chamber layout, pressure scale, waveform, garment coverage, and safety labeling, so brand-specific instructions matter.
  - A useful personal result can be modest comfort or soreness relief even when performance or wearable recovery scores do not change.
  logFields:
  - device model
  - garment coverage
  - pressure or intensity level
  - compression mode or sequence
  - duration minutes
  - timing after trigger
  - posture
  - one leg or both legs
  - soreness 0-10
  - muscular fatigue 0-10
  - perceived recovery 0-10
  - leg heaviness 0-10
  - comfort during session
  - skin check before and after
  - symptoms or stop reason
  - training load or standing/sitting context
  - other recovery modalities
  - time since workout or trigger
  - workout type, intensity, muscle group, and DOMS/injury distinction
  - time of day
  - posture before measurement
  - garment contact with fibular head, knee/ankle bony prominences, groin/genitals, surgical hardware/site, graft/bypass area, or skin lesion
  - travel duration or prolonged sitting/standing duration
  - mobility breaks or calf exercises if travel/prolonged sitting is relevant
  - skin check later the same day
  - delayed symptoms later the same day
  - anticoagulant, antiplatelet, NSAID/analgesic, sensory-altering medicine, stimulant, diuretic, hormone therapy/estrogen context if relevant
  - whether symptoms resolved after removal
  stopConditions:
  - Severe pain, pain that feels wrong, pain out of proportion, rapidly increasing tightness/swelling, a hard/tight limb compartment, or pain with toe/ankle movement.
  - New numbness, tingling, weakness, gait instability, foot drop, trouble lifting the toes, foot slapping, dizziness, fainting, or any symptom that makes walking unsafe after removal.
  - Unexplained calf pain, one-sided swelling/warmth/redness, sudden chest pain, unexplained shortness of breath, coughing blood, fainting, or suspected DVT/PE symptoms; remove the garment and seek urgent/emergency care for chest symptoms, shortness of breath, coughing blood, fainting, or suspected PE.
  - Cold, pale, blue, mottled, or suddenly discolored foot/leg; new ischemic rest pain; loss of pulse; or new severe circulation symptoms.
  - Bruising, blisters, pressure sores, skin breakdown, marked irritation, burns, rash, wound opening, infection signs, pressure hot spots, proximal/genital swelling, genital/groin numbness or pain, or any wound under the garment.
  - Garment presses focally on the fibular head, knee, ankle bone, groin/genitals, surgical site/hardware, skin graft/bypass area, or another bony prominence.
  - Device malfunction, failure to deflate, liquid exposure, damaged hose/pump/garment, damaged power supply, fall/obstruction hazard, abnormal pressure, or inability to remove quickly.
  - Any session requires walking with leg attachments or any activity that prevents immediate stop/removal.
  - Symptoms recur or worsen across repeated sessions, delayed symptoms appear later the same day, or safety concerns outweigh any comfort benefit.
testPlans:
- planId: soreness-comfort-28d
  durationDays: 28
  baselineDays: 7
  interventionDays: 21
  primaryBiomarkerKey: biomarker:muscle-soreness-score
  secondaryBiomarkerKeys:
  - biomarker:leg-heaviness-score
  - biomarker:perceived-recovery-score
  safetyOutcomeKeys:
  - biomarker:adverse-symptoms
  minimumAdherenceSessions: 8
  targetAdherenceSessions: 12
  notes:
  - Baseline records soreness, leg heaviness, perceived recovery, and symptoms without pneumatic compression.
  - Intervention uses the same device, pressure/intensity, session length, and timing whenever practical.
  - Do not interpret this plan as VTE prophylaxis, swelling treatment, or a medical compression prescription.
expectedSignalDescriptions:
- biomarkerKey: biomarker:muscle-soreness-score
  description: "Compression cycles squeeze and refill leg tissue, moving venous blood and interstitial fluid to reduce pooling, stiffness, and soreness."
  expected: Could trend lower
  estimatedChange:
    kind: absolute
    low: -1
    high: -0.3
    unit: 0–10 score points
    window: 24–96 hours after hard lower-body training
    confidence: moderate
    basis: "source_artifact:pmid-35456170 reports SMD -0.33 for soreness from 24–96 hours after DOMS induction; source_artifact:pmid-39416507 supports pain/soreness as a clearer practical signal than objective recovery. The range maps that small standardized effect to a 0–10 score."
  protocolProminence: focus
- biomarkerKey: biomarker:leg-heaviness-score
  description: "Sequential pressure empties and refills the lower legs, reducing pooled fluid that makes legs feel heavy."
  expected: Could trend lower
  estimatedChange:
    kind: absolute
    low: -1.5
    high: -0.5
    unit: 0–10 score points
    window: Same evening or within 2 hours after a standing/sitting trigger
    confidence: low
    basis: "source_artifact:pmid-34260560 and source_artifact:pmid-36419142 reported leg-pain and circumference improvements after prolonged-standing contexts. Confidence stays low because leg heaviness was not pooled and this consumer protocol is not a swelling-treatment plan."
  protocolProminence: focus
- biomarkerKey: biomarker:perceived-recovery-score
  description: "Fluid movement and quiet rest reduce immediate leg fatigue, making the next session feel more available."
  expected: Could improve
  estimatedChange:
    kind: absolute
    low: 0.3
    high: 1
    unit: 0–10 score points
    window: Immediately after the session to next morning
    confidence: low
    basis: "source_artifact:doi-10.1007-s11332-024-01217-5 reported higher total-quality-recovery without better cycling power, and source_artifact:pmid-27011305 reported immediate fatigue relief after ultramarathon IPC. Null athlete trials keep confidence low."
  protocolProminence: focus
experimentOnboarding:
  schemaVersion: murph.commons.experiment-onboarding.v1
  startIntent:
    displayPrompt: Set up a cautious pneumatic compression pants experiment for post-exercise soreness, perceived recovery, or leg comfort—not for clot prevention or medical swelling treatment.
    intentSummary: Consumer lower-limb IPC recovery or comfort self-experiment
  contextReview:
    vaultChecks:
    - id: compression_device_history
      label: Compression-device history
      reason: Prior symptoms, device intolerance, or brand-specific use can change setup and safety questions.
      freshnessDays: 365
      readHints:
      - search query "Normatec Therabody compression boots pneumatic compression pressotherapy symptoms" --format json
    - id: vascular_clot_or_swelling_context
      label: Vascular, clot, or swelling context
      reason: Known clot risk, unexplained swelling, vascular disease, wounds, or lymphedema/lipedema changes this from a wellness experiment to clinician-guided care.
      freshnessDays: 180
      readHints:
      - search query "DVT PE clot swelling edema lymphedema venous ulcer PAD wound cellulitis" --format json
    - id: recent_injury_surgery_or_immobility
      label: Recent injury, surgery, or immobility
      reason: Recent surgery, fracture, dislocation, immobilization, or trauma can make compression unsafe without medical guidance.
      freshnessDays: 90
      readHints:
      - search query "surgery injury fracture dislocation immobilization cast" --format json
    - id: sensory_or_skin_risk
      label: Sensory or skin risk
      reason: Neuropathy, fragile skin, diabetes, wounds, or reduced sensation raises risk of missing pressure injury or skin breakdown.
      freshnessDays: 180
      readHints:
      - search query "diabetes neuropathy numbness skin wound pressure sore" --format json
    notes:
    - Review context first, but still ask the compact safety screen because silence in the vault is not clearance.
  safetyScreen:
    cautionLevel: high
    mode: ask_compact_then_expand_if_positive
    dispositionIfAnyPositive: clinician_guidance_before_unsupervised_start
    mustAsk:
    - id: clot_or_pe_red_flags
      prompt: known or suspected DVT/PE, acute thrombophlebitis, unexplained calf pain, one-sided swelling/warmth/redness, chest pain, unexplained shortness of breath, coughing blood, fainting, or current clinician-directed clot-prevention plan
      ifPositive: do_not_start_unsupervised
      why: Consumer pneumatic compression pants should not be used to self-treat or prevent suspected clots.
    - id: vte_history_or_high_risk_travel_context
      prompt: previous DVT/PE, known thrombophilia/clotting disorder, active cancer, recent hospitalization/surgery/trauma, cast/splint or prolonged bed rest, pregnancy/postpartum, estrogen therapy/hormonal contraception/HRT, strong family history of VTE, or travel/prolonged sitting where the goal is clot prevention
      ifPositive: clinician_guidance_before_unsupervised_start
      why: These factors can change travel or clot-prevention decisions; consumer pneumatic compression pants should not replace a clinician-directed VTE plan.
    - id: cardiopulmonary_or_vascular_risk
      prompt: acute pulmonary edema, cardiopulmonary edema, acute or decompensated heart failure, edema from congestive heart failure, severe arterial disease or PAD/CLTI, acute limb ischemia, severe arteriosclerosis/ischemic vascular disease, severe/uncontrolled hypertension, acute/severe heart/liver/kidney disease, systemic edema, or a condition where increasing venous or lymphatic return may be unsafe
      ifPositive: clinician_guidance_before_unsupervised_start
      why: IPC can change venous/lymphatic return and is not self-cleared in these contexts.
    - id: skin_infection_wound_or_sensation_risk
      prompt: active infection, cellulitis, erysipelas, phlegmon, active phlebitis, open wound, leg ulcer, burn, blister, skin rash, fragile skin, tumor/cancerous lesion near the garment site, diabetes-related foot risk, neuropathy or reduced sensation, abnormal pressure sensitivity, severe bony prominences, or medicines that alter sensation or alertness
      ifPositive: clinician_guidance_before_unsupervised_start
      why: Skin and nerve warning signs can be missed or worsened under compression.
    - id: recent_injury_surgery_or_structural_risk
      prompt: recent surgery, direct pressure over a surgical site or hardware, recent skin graft or vascular bypass/graft, immobilization, cast/splint, fracture, dislocation, suspected compartment syndrome, major recent injury, severe osteopenia/osteoporosis or bone fragility, severe bony prominences, poor garment fit, focal pressure over the fibular head/knee/ankle/groin/genitals, anticoagulant or bleeding-risk situation, pregnancy/postpartum, or relevant implanted medical device
      ifPositive: clinician_guidance_before_unsupervised_start
      why: These contexts need individualized guidance before pressure and garment coverage are chosen.
    - id: can_stop_and_remove_device
      prompt: can you reliably feel warning symptoms, understand the stop rules, reach the power/disconnect path, and remove the garment quickly without help?
      ifNegative: do_not_start_unsupervised
      why: The protocol depends on early symptom detection and immediate removal; incapacitated or unable-to-remove users need supervised use.
    - id: medical_treatment_goal
      prompt: is the intended goal DVT/PE prevention, travel VTE prevention, unexplained swelling treatment, lymphedema/lipedema, venous ulcer, wound care, PAD/ischemia, diabetes-related foot risk, post-thrombotic syndrome, post-surgical prophylaxis, or replacing a medical compression plan
      ifPositive: do_not_start_unsupervised
      why: Those goals belong in supervised clinical pathways, not this Murph wellness protocol.
    stopIf:
      inheritFromProtocolSafety: true
      additionalConditions:
      - device fails to deflate, pressure feels abnormal, or the garment cannot be removed quickly
      - session requires walking with leg attachments or creates a tubing, cord, obstruction, or fall hazard
      - garment presses focally on the fibular head, knee, ankle bone, groin/genitals, surgical site/hardware, skin graft/bypass area, or another bony prominence
      - goal shifts from comfort/recovery to medical treatment or clot prevention
    notes:
    - A positive screen is not a diagnosis; it means Murph should not set up unsupervised consumer-pants use.
    - When the screen is positive, offer to help organize questions for a clinician rather than creating an experiment run.
  setupSlots:
  - id: target_use_case
    label: Target use case
    purpose: context
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: 'What are you testing: post-exercise soreness, perceived recovery/readiness, leg heaviness/comfort after standing or sitting, or something else? If you choose ''other'', it cannot mean new swelling, one-sided swelling, painful swelling, injury, numbness, wound care, circulation disease, or medical treatment.'
    options:
    - post_exercise_soreness
    - perceived_recovery
    - leg_heaviness_comfort
    - other_nonmedical_comfort
    writePath: runPlan.targetUseCase
  - id: device_model
    label: Device model
    purpose: logistics
    valueType: free_text
    askPolicy: ask_if_unknown
    required: true
    question: What brand/model or device type will you use?
    writePath: runPlan.deviceModel
  - id: garment_coverage
    label: Garment coverage
    purpose: logistics
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: Which areas will the garment cover? Do not use direct groin/genital compression or a fit that creates focal pressure over bony prominences, surgical sites/hardware, skin graft/bypass areas, or lesions.
    options:
    - feet_calves
    - calves_thighs
    - full_legs
    - pants_hips
    - other
    writePath: runPlan.garmentCoverage
  - id: pressure_intensity
    label: Pressure or intensity
    purpose: measurement_fidelity
    valueType: free_text
    askPolicy: ask_if_unknown
    required: true
    question: What pressure, level, or intensity setting will you start with? Use the lowest comfortable setting within the device manual. Do not copy high-pressure study settings, do not use the device maximum as a target, and do not increase pressure to force a stronger effect.
    writePath: runPlan.pressureIntensity
  - id: compression_mode
    label: Compression mode
    purpose: measurement_fidelity
    valueType: free_text
    askPolicy: ask_if_unknown
    required: false
    question: What mode, sequence, zone pattern, or program will you use?
    writePath: runPlan.compressionMode
  - id: duration_minutes
    label: Session duration
    purpose: adherence
    valueType: integer
    askPolicy: ask_if_unknown
    required: true
    question: How many minutes per session will you use? The ordinary starter plan is 20–30 minutes; do not use continuous, overnight, or >30-minute sessions in this wellness protocol.
    constraints:
      minimum: 10
      maximum: 30
      recommendedMinimum: 20
      recommendedMaximum: 30
      aboveMaximumDisposition: separate_device_specific_or_clinician_guided_variant
    writePath: runPlan.durationMinutes
  - id: sessions_per_week
    label: Sessions per week
    purpose: adherence
    valueType: integer
    askPolicy: ask_if_unknown
    required: true
    question: How many sessions per week are realistic? The default is 3, with a target of 12 over 21 days.
    constraints:
      minimum: 1
      maximum: 7
      default: 3
    writePath: runPlan.sessionsPerWeek
  - id: timing_after_trigger
    label: Timing after trigger
    purpose: measurement_fidelity
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: When will you usually do the session relative to the trigger?
    options:
    - within_2h_after_exercise
    - same_day_after_exercise
    - after_standing_or_sitting_day
    - travel_comfort_only
    - other_consistent_timing
    writePath: runPlan.timingAfterTrigger
  - id: posture
    label: Posture
    purpose: safety
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: What stable position will you use during sessions?
    options:
    - seated
    - reclined
    - lying_down
    writePath: runPlan.posture
  - id: measurement_focus
    label: Measurement focus
    purpose: measurement_fidelity
    valueType: enum
    askPolicy: ask_if_unknown
    required: true
    question: Which primary outcome should Murph use?
    options:
    - muscle_soreness
    - perceived_recovery
    - leg_heaviness
    writePath: analysisPlan.primaryOutcomePreference
  - id: reminder_policy
    label: Reminder policy
    purpose: assistant_support
    valueType: reminder_policy
    askPolicy: ask_at_confirmation
    required: true
    question: Would you like session reminders and one same-day missing-log check?
    options:
    - none
    - pre_session
    - pre_session_plus_same_day_missing_log_check
    writePath: assistantSupport.reminderPolicy
  planDefaults:
    testPlanId: soreness-comfort-28d
    baselineDays: 7
    interventionDays: 21
    sessionsPerWeek: 3
    targetSessions: 12
    minimumUsefulSessions: 8
    firstSessionGuidance: 'Make the first session a tolerance check: lowest comfortable pressure, reachable disconnect, no walking, no focal pressure over fibular head/knee/ankle/groin/genitals or surgical/graft areas, and stop at the first wrong-feeling symptom.'
  logging:
    sessionFields:
    - target_use_case
    - device_model
    - garment_coverage
    - pressure_intensity
    - compression_mode
    - duration_minutes
    - timing_after_trigger
    - posture
    - soreness_score
    - fatigue_score
    - perceived_recovery_score
    - leg_heaviness_score
    - comfort_score
    - skin_check
    - symptoms_or_stop_reason
    - time_since_workout_or_trigger
    - workout_type_intensity_muscle_group
    - time_of_day
    - device_zones_or_program
    - garment_contact_risk_points
    - mobility_breaks_or_calf_exercises_if_travel_context
    - skin_check_later_same_day
    - delayed_symptoms
    - symptom_resolution_after_removal
    confounders:
    - exact time since workout, workout type, intensity, muscle group, and DOMS/injury distinction
    - time of day, posture before measurement, and session posture
    - exact device model, garment coverage, zones, mode, pressure/intensity, duration, and any pressure/duration change
    - whether the garment contacted fibular head, knee/ankle bony prominences, groin/genitals, surgical hardware/site, graft/bypass area, or skin lesion
    - travel duration, prolonged sitting/standing duration, cast/splint/immobility, and whether mobility breaks/calf exercises occurred
    - skin check before, immediately after, and later the same day
    - new injury, calf pain, swelling, warmth, redness, numbness, weakness, foot drop, skin mark, blister, bruise, wound, infection sign, or delayed symptom
    - 'medications: anticoagulants, antiplatelets, NSAIDs/analgesics, sensory-altering meds, stimulants, diuretics, hormone therapy/estrogen if travel or swelling is relevant'
    - pregnancy/postpartum status if relevant, menstrual cycle/hormonal context if the user already tracks it
    - illness, fever, cellulitis, wound, burn, dermatitis, or infection
    - sleep debt, alcohol, hydration, heat/cold/sauna exposure, massage, stretching, cold plunge, BFR, compression garments, or other recovery modalities
    - whether the session was stopped early, why, and whether symptoms resolved after removal
    notes:
    - Log early stops as useful safety data, not failed adherence.
    - Keep pressure and duration stable unless safety or comfort requires a lower dose.
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: opt_in_only
    reminderOptions:
    - none
    - pre_session
    - pre_session_plus_same_day_missing_log_check
    - weekly_digest
    weeklyDigestDefault: true
    missedLogFollowupCopy: Did you use the compression pants session today? Totally fine either way — I just want the experiment record and symptoms to be accurate.
    confirmationPrompt: Show protocol key, testPlanId, safety-screen result, selected device/model, garment coverage, pressure/intensity, mode, duration, target/minimum sessions, primary outcome, safety stop rules, baseline/intervention dates, and reminder policy before creating the active experiment.
whyItWorks:
- Cyclic external compression can plausibly move venous blood and fluid, change local perfusion, and alter oxygenation or hemoglobin-related signals; this is mechanism context, not proof of faster recovery (`source_artifact:pmid-29122964`, `source_artifact:pmid-30300043`, `source_artifact:pmid-41768774`).
- In direct post-exercise recovery evidence, the most user-relevant signal is how the legs feel—soreness, pain, fatigue, and perceived recovery—while performance and biomarker effects are smaller, mixed, or inconsistent (`source_artifact:doi-10.1519-ssc.0000000000000892`, `source_artifact:pmid-35456170`, `source_artifact:pmid-39416507`).
- The practical experiment tests whether a repeatable short compression session reliably improves comfort enough to be worth the time, rather than assuming the device reverses muscle damage or improves next-session output (`source_artifact:pmid-33418535`, `source_artifact:pmid-40325678`, `source_artifact:doi-10.1007-s11332-024-01217-5`).
claims:
- claimId: scope-consumer-recovery-not-medical-ipc
  type: design_guardrail
  text: Scope this variant to generally healthy adults using consumer lower-limb pneumatic compression pants, boots, or leg sleeves for post-exercise soreness, perceived recovery, or leg-comfort self-testing; do not frame it as medical IPC for DVT/PE prevention, swelling workup, lymphedema, lipedema, post-thrombotic syndrome, venous ulcers, PAD/CLTI, ischemic wounds, diabetes-related foot risk, surgery recovery, or disease treatment.
  strength: high
  sourceKeys:
  - source_artifact:fda-normatec3-510k-k220217-2022-02-25
  - source_artifact:pmid-39416507
  - source_artifact:pmid-40325678
  - source_artifact:pmid-35456170
  - source_artifact:cms-pneumatic-compression-devices-2002-01-14
  - source_artifact:doi-10.1177-02683555221145779
  - source_artifact:doi-10.3390-life15050725
  - source_artifact:pmid-31531971
  - source_artifact:doi-10.1111-ddg.15415
  - source_artifact:pmid-24974070
  - source_artifact:pmid-34528370
  - source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
  - source_artifact:cdc-dvt-pe-travel-2025-04-23
  caveats:
  - FDA and manufacturer labeling set device-use boundaries, not personal clearance or proof of broad recovery efficacy.
  - Healthy/athletic post-exercise studies should not be generalized to suspected clots, unexplained swelling, wounds, severe vascular disease, or post-surgical immobilization.
- claimId: mixed-direct-evidence-soreness-not-performance
  type: mixed_evidence
  text: 'Direct lower-limb IPC and pressotherapy recovery evidence is mixed: subjective soreness, pain, immediate fatigue, or perceived recovery may improve in some reviews and trials, but muscle mechanical function, performance, creatine kinase, inflammation markers, lactate, heart-rate responses, and broad recovery outcomes are inconsistent, null, or too heterogeneous for blanket claims.'
  strength: moderate
  sourceKeys:
  - source_artifact:doi-10.1519-ssc.0000000000000892
  - source_artifact:pmid-35456170
  - source_artifact:pmid-39416507
  - source_artifact:pmid-33418535
  - source_artifact:pmid-40325678
  - source_artifact:doi-10.1007-s11332-024-01217-5
  - source_artifact:pmid-27011305
  - source_artifact:pmid-40555415
  - source_artifact:pmid-41656279
  - source_artifact:pmid-41718172
  - source_artifact:pmid-39846675
  caveats:
  - Subjective soreness and perceived-recovery ratings are expectation-sensitive.
  - Study protocols, devices, pressures, postures, exercise stressors, populations, and comparators vary widely.
- claimId: common-dose-is-map-not-optimal-dose
  type: evidence_scope
  text: A 20–30 minute session is a reasonable starter map because many direct studies cluster around short post-exercise sessions and one review describes common protocols around 20–30 minutes and about 80 mmHg, but the literature does not establish an optimal pressure, mode, duration, or frequency for consumer pants.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-39416507
  - source_artifact:doi-10.1007-s11332-024-01217-5
  - source_artifact:pmid-27011305
  - source_artifact:pmid-40555415
  - source_artifact:pmid-41656279
  - source_artifact:therabody-jetboots-recoveryair-manuals-2026-04-25
  - source_artifact:fda-normatec3-510k-k220217-2022-02-25
  caveats:
  - Higher pressure should not be framed as better.
  - Device-specific pressure scales and modes may not be directly comparable across brands.
- claimId: subjective-outcomes-first-objective-secondary
  type: design_guardrail
  text: Murph measurement should prioritize participant-reported soreness or pain, muscular fatigue, perceived recovery/readiness, leg heaviness, comfort, and adverse symptoms; next-session performance, circumference, heart-rate responses, CK, and inflammatory markers should remain secondary or exploratory unless a separate protocol defines them.
  strength: high
  sourceKeys:
  - source_artifact:doi-10.1519-ssc.0000000000000892
  - source_artifact:pmid-35456170
  - source_artifact:pmid-39416507
  - source_artifact:pmid-40325678
  - source_artifact:pmid-41656279
  - source_artifact:pmid-34260560
  - source_artifact:pmid-36419142
  caveats:
  - Circumference measures can be noisy without consistent landmarks, timing, and posture.
  - Wearable recovery signals are confounded by training load, illness, stress, caffeine, alcohol, and travel.
- claimId: standing-sitting-travel-are-adjacent-not-direct-proof
  type: evidence_scope
  text: Prolonged standing, prolonged sitting, and travel can be logged as comfort contexts, but the standing-worker, stocking, travel-guidance, and venous-flow evidence is adjacent; it should not be converted into direct proof that consumer pneumatic compression pants reduce travel clots or objectively treat leg swelling.
  strength: high
  sourceKeys:
  - source_artifact:pmid-34260560
  - source_artifact:pmid-36419142
  - source_artifact:doi-10.1186-s13102-019-0138-4
  - source_artifact:pmid-35741420
  - source_artifact:cdc-dvt-pe-travel-2025-04-23
  - source_artifact:pmid-21083651
  - source_artifact:pmid-28042639
  - source_artifact:pmid-33878207
  - source_artifact:pmid-30738701
  - source_artifact:pmid-16879230
  - source_artifact:pmid-17012016
  caveats:
  - Static compression stockings are not intermittent pneumatic pants.
  - Travel guidance is primarily VTE risk guidance and does not validate consumer pants as prophylaxis.
- claimId: not-vte-prophylaxis-or-disease-treatment
  type: safety
  text: Consumer pneumatic compression pants should not be presented as DVT/PE prevention, clinician-directed VTE prophylaxis replacement, or self-treatment for lymphedema, lipedema, venous ulcers, PAD/CLTI, ischemic wounds, diabetes-related foot risk, post-thrombotic syndrome, or unexplained swelling; those indications belong in clinician-supervised medical compression pathways.
  strength: high
  sourceKeys:
  - source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
  - source_artifact:pmid-22315261
  - source_artifact:pmid-30482763
  - source_artifact:fhi-ipc-acute-stroke-hta-2020-12-22
  - source_artifact:pmid-23727163
  - source_artifact:cdc-dvt-pe-travel-2025-04-23
  - source_artifact:pmid-21083651
  - source_artifact:cms-pneumatic-compression-devices-2002-01-14
  - source_artifact:pmid-38743805
  - source_artifact:pmid-39207406
  - source_artifact:doi-10.1177-02683555221145779
  - source_artifact:doi-10.3390-life15050725
  - source_artifact:pmid-31531971
  - source_artifact:doi-10.1111-ddg.15415
  - source_artifact:pmid-24974070
  - source_artifact:pmid-34528370
  caveats:
  - Clinical IPC can be useful in selected supervised populations; that is the reason to keep medical variants separate, not to deny clinical IPC.
  - Travel stocking and anticoagulant evidence is adjacent or pharmacologic, not pneumatic-pants evidence.
- claimId: screen-out-core-contraindications
  type: safety
  text: Unsupervised use should screen out known, suspected, or prior DVT/PE; acute thrombophlebitis or active phlebitis; PE symptoms; acute pulmonary edema; acute or decompensated heart failure; CHF-related edema; severe arterial disease or PAD/CLTI; severe or uncontrolled hypertension; acute or severe heart, liver, or kidney disease; active infection/cellulitis/erysipelas/phlegmon; open wounds, leg ulcers, burns, blistering dermatoses, lesions, fragile skin, or tumor/cancerous lesions near the garment; fracture, dislocation, severe bony prominences, poor garment fit, suspected compartment syndrome, inability to sense warning symptoms, inability to remove the garment quickly, and conditions where increased venous or lymphatic return could be unsafe.
  strength: high
  sourceKeys:
  - source_artifact:hyperice-normatec-contraindications-2021-09-07
  - source_artifact:hyperice-normatec-elite-safety-instructions-2024-06-04
  - source_artifact:therabody-pneumatic-compression-precautions-2026-04-25
  - source_artifact:awmf-intermittent-pneumatic-compression-2025-04-28
  - source_artifact:vasocare-legacy-ipc-user-manual-2023-10-10
  - source_artifact:pmid-32122269
  - source_artifact:hopkinsmedicine-ipc-dvt-prevention-2026-04-25
  - source_artifact:doi-10.1177-02683555221145779
  - source_artifact:doi-10.3390-life15050725
  - source_artifact:pmid-31531971
  - source_artifact:doi-10.1111-ddg.15415
  - source_artifact:pmid-24974070
  - source_artifact:pmid-34528370
  caveats:
  - Manufacturer and guideline lists are safety-boundary sources, not adverse-event incidence estimates.
  - Some compression contraindications differ between sustained stockings and IPC; significant vascular or cardiac risk should not be self-cleared.
- claimId: clinician-guidance-for-caution-conditions
  type: safety
  text: Pregnancy/postpartum, diabetes, neuropathy or reduced sensation, abnormal pressure sensitivity, varicose veins, controlled hypertension, heart/liver/kidney disease, anticoagulant or bleeding-risk situations, recent injury or surgery, surgical hardware/site, recent skin graft or vascular bypass/graft, osteopenia/osteoporosis, relevant implants, severe bony prominences, poor garment fit, direct groin/genital pressure risk, and uncertain medical swelling should trigger clinician guidance or a modified monitored plan before use.
  strength: moderate
  sourceKeys:
  - source_artifact:therabody-pneumatic-compression-precautions-2026-04-25
  - source_artifact:awmf-intermittent-pneumatic-compression-2025-04-28
  - source_artifact:hopkinsmedicine-ipc-dvt-prevention-2026-04-25
  - source_artifact:vasocare-legacy-ipc-user-manual-2023-10-10
  - source_artifact:pmid-34528370
  - source_artifact:pmid-16484746
  - source_artifact:pmid-40065876
  caveats:
  - The exact disposition depends on indication, pressure, garment coverage, and clinical context.
  - This protocol is not a substitute for individual medical advice.
- claimId: stop-for-pain-skin-neurologic-clot-red-flags
  type: safety
  text: Stop the session, remove the garment, and escalate appropriately for severe or wrong-feeling pain, rapidly increasing tightness or swelling, hard/tight limb compartments, pain with toe/ankle movement, new numbness/tingling/weakness, foot drop, trouble lifting toes, foot slapping, gait instability, cold/pale/blue/mottled discoloration, new severe circulation symptoms, bruising, blisters, pressure sores, skin breakdown, burns, rash, wound opening, infection signs, pressure hot spots, proximal/genital swelling, genital/groin numbness or pain, unexplained calf pain, one-sided swelling/warmth/redness, chest pain, coughing blood, fainting, unexplained shortness of breath, device damage, liquid exposure, malfunction, abnormal pressure, or failure to deflate.
  strength: high
  sourceKeys:
  - source_artifact:hyperice-normatec-elite-safety-instructions-2024-06-04
  - source_artifact:therabody-jetboots-recoveryair-manuals-2026-04-25
  - source_artifact:clevelandclinic-intermittent-pneumatic-compression-2023-04-18
  - source_artifact:hopkinsmedicine-ipc-dvt-prevention-2026-04-25
  - source_artifact:pmid-39207406
  - source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
  - source_artifact:pmid-32122269
  - source_artifact:pmid-38300926
  - source_artifact:doi-10.1016-j.jemrpt.2025.100150
  - source_artifact:pmid-1580778
  - source_artifact:pmid-23549834
  - source_artifact:pmid-2586562
  - source_artifact:pmid-30100856
  - source_artifact:pmid-10719972
  - source_artifact:pmid-16484746
  - source_artifact:pmid-40065876
  - source_artifact:pmid-3782217
  - source_artifact:therabody-pneumatic-compression-precautions-2026-04-25
  caveats:
  - Non-emergency discomfort and urgent red flags should be separated in user copy.
  - Proximal/genital swelling is mainly clinical lymphedema context and should be treated as an escalation signal, not a common consumer outcome.
- claimId: comparators-do-not-support-superiority
  type: mixed_evidence
  text: Current comparator evidence should not support superiority claims over massage, static compression, cold-water immersion or cryotherapy, electrical stimulation, heat/TECAR, BFR, or manual lymphatic drainage; comparator sources are small, mixed, planned-only, adjacent, or clinical-boundary evidence.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-35475921
  - source_artifact:pmid-27011305
  - source_artifact:pmid-29513036
  - source_artifact:pmid-41003610
  - source_artifact:pmid-41718172
  - source_artifact:pmid-34774089
  - source_artifact:pmid-40555415
  - source_artifact:pmid-40325678
  caveats:
  - A comparator may still be useful for a specific person; the claim is about the evidence not justifying broad superiority language.
researchLandscape:
  bottomLine: Evidence supports a cautious, symptom-first self-experiment for soreness or leg comfort, not a strong efficacy claim for performance, biomarkers, clot prevention, swelling treatment, or disease management.
  confidenceLabel: mixed
  primaryClaim: Pneumatic compression pants may reduce perceived soreness, pain, or immediate fatigue for some post-exercise users, but objective recovery, performance, biomarker, and wearable-recovery outcomes remain inconsistent.
  mainCaveat: 'The safety and clinical-boundary evidence is stronger for page language than the consumer efficacy evidence: screen first, stop early, and keep medical indications out of this variant.'
  groups:
  - id: direct-post-exercise-recovery
    label: Direct post-exercise recovery evidence
    stance: mixed
    summary: Reviews and completed sports-recovery trials most consistently support cautious soreness, pain, immediate-fatigue, or perceived-recovery language while limiting performance, CK/inflammation, lactate, heart-rate-response, and broad recovery claims.
    sourceKeys:
    - source_artifact:doi-10.1519-ssc.0000000000000892
    - source_artifact:pmid-35456170
    - source_artifact:pmid-39416507
    - source_artifact:pmid-33418535
    - source_artifact:pmid-40325678
    - source_artifact:doi-10.1007-s11332-024-01217-5
    - source_artifact:pmid-27011305
    - source_artifact:pmid-40555415
    - source_artifact:pmid-41656279
    - source_artifact:pmid-41718172
    - source_artifact:pmid-39846675
    defaultOpen: true
  - id: dose-and-implementation-map
    label: Dose and implementation map
    stance: context_only
    summary: Studies and device labels show varied pressures, durations, modes, garment coverage, postures, and timing. A 20–30 minute low-comfortable-pressure starter session is a pragmatic map, not an optimal-dose claim.
    sourceKeys:
    - source_artifact:pmid-39416507
    - source_artifact:doi-10.1007-s11332-024-01217-5
    - source_artifact:pmid-27011305
    - source_artifact:pmid-40555415
    - source_artifact:pmid-41656279
    - source_artifact:therabody-jetboots-recoveryair-manuals-2026-04-25
    - source_artifact:fda-normatec3-510k-k220217-2022-02-25
  - id: mechanism-and-lab-context
    label: Mechanism and lab context
    stance: context_only
    summary: IPC has plausible acute hemodynamic and fluid-shift mechanisms, but mechanism markers should not become claims of guaranteed recovery, muscle-damage reversal, or performance improvement.
    sourceKeys:
    - source_artifact:pmid-29122964
    - source_artifact:pmid-30300043
    - source_artifact:pmid-41768774
    - source_artifact:pmid-39416507
    - source_artifact:pmid-35456170
  - id: adjacent-standing-sitting-travel
    label: Standing, sitting, and travel contexts
    stance: mixed
    summary: Occupational standing, static stockings, travel guidance, and surrogate venous-flow studies are useful context for comfort and safety but do not directly prove consumer pants prevent clots or treat swelling.
    sourceKeys:
    - source_artifact:pmid-34260560
    - source_artifact:pmid-36419142
    - source_artifact:doi-10.1186-s13102-019-0138-4
    - source_artifact:pmid-35741420
    - source_artifact:cdc-dvt-pe-travel-2025-04-23
    - source_artifact:pmid-21083651
    - source_artifact:pmid-28042639
    - source_artifact:pmid-33878207
  - id: clinical-supervised-boundary
    label: Clinical IPC boundary
    stance: safety_boundary
    summary: Hospital VTE prophylaxis, stroke, ICU, surgery, lymphedema, lipedema, post-thrombotic syndrome, venous-ulcer/wound-care, and PAD/CLTI uses are real clinical IPC contexts but require screening, monitoring, prescribed doses, and follow-up.
    sourceKeys:
    - source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
    - source_artifact:pmid-22315261
    - source_artifact:pmid-30482763
    - source_artifact:fhi-ipc-acute-stroke-hta-2020-12-22
    - source_artifact:cms-pneumatic-compression-devices-2002-01-14
    - source_artifact:pmid-39207406
    - source_artifact:pmid-38743805
    - source_artifact:doi-10.1177-02683555221145779
    - source_artifact:doi-10.3390-life15050725
    - source_artifact:pmid-31531971
    - source_artifact:doi-10.1111-ddg.15415
    - source_artifact:pmid-24974070
    - source_artifact:pmid-34528370
    defaultOpen: true
  - id: safety-screening-and-stop-rules
    label: Safety screening and stop rules
    stance: safety_boundary
    summary: Manufacturer materials, IPC guidance, patient education, and case reports justify conservative screening, skin checks, neurologic symptom stops, clot/PE red-flag escalation, no-walking handling, and malfunction stop rules.
    sourceKeys:
    - source_artifact:hyperice-normatec-contraindications-2021-09-07
    - source_artifact:hyperice-normatec-elite-safety-instructions-2024-06-04
    - source_artifact:therabody-pneumatic-compression-precautions-2026-04-25
    - source_artifact:therabody-jetboots-recoveryair-manuals-2026-04-25
    - source_artifact:pmid-32122269
    - source_artifact:awmf-intermittent-pneumatic-compression-2025-04-28
    - source_artifact:vasocare-legacy-ipc-user-manual-2023-10-10
    - source_artifact:clevelandclinic-intermittent-pneumatic-compression-2023-04-18
    - source_artifact:hopkinsmedicine-ipc-dvt-prevention-2026-04-25
    - source_artifact:pmid-38300926
    - source_artifact:doi-10.1016-j.jemrpt.2025.100150
    - source_artifact:pmid-1580778
    - source_artifact:pmid-2586562
    - source_artifact:pmid-30100856
    - source_artifact:pmid-40065876
    - source_artifact:pmid-23549834
    - source_artifact:pmid-10719972
    - source_artifact:pmid-16484746
    - source_artifact:pmid-3782217
    - source_artifact:pmid-34528370
    defaultOpen: true
safety:
  cautionLevel: high
  avoidOrGetClinicianGuidance:
  - Known, suspected, or prior DVT/PE; acute thrombophlebitis or active phlebitis; unexplained calf pain; one-sided swelling/warmth/redness; chest pain; coughing blood; fainting; unexplained shortness of breath; known thrombophilia or clotting disorder; or a clinician-directed clot-prevention plan.
  - Acute pulmonary edema, cardiopulmonary edema, acute or decompensated heart failure, edema from congestive heart failure, severe arterial disease, PAD/CLTI, acute limb ischemia, severe arteriosclerosis/ischemic vascular disease, severe/uncontrolled hypertension, or acute/severe heart, liver, or kidney disease.
  - Active infection/cellulitis/erysipelas/phlegmon, active phlebitis, open wound, leg ulcer, burn, blistering dermatosis, skin rash, local tissue inflammation, fragile skin, tumor/cancerous lesion near the garment site, lymphangiosarcoma, or any wound/lesion/infection under or near the garment.
  - Neuropathy or reduced sensation, abnormal pressure sensitivity, medicines that alter sensation or alertness, inability to reliably feel symptoms, inability to understand instructions, or inability to stop and remove the garment quickly.
  - Recent surgery, direct pressure over a surgical site or hardware, recent skin graft or vascular bypass/graft in the affected area, immobilization, cast/splint, fracture, dislocation, major injury, severe osteopenia/osteoporosis or bone fragility, suspected compartment syndrome, severe bony prominences, poor garment fit, or focal pressure over the fibular head/knee/ankle/groin/genitals.
  - Anticoagulant or blood-thinner use, bleeding disorder, major bruising risk, pregnancy/postpartum, controlled hypertension, diabetes, varicose veins, heart/liver/kidney disease, relevant implanted medical device, or any medical condition where pressure or increased venous/lymphatic return may be unsafe.
  - Any goal involving DVT/PE prevention, travel VTE prevention, unexplained swelling treatment, lymphedema/lipedema, venous ulcer, wound care, PAD/ischemia, diabetic foot risk, post-thrombotic syndrome, post-surgical prophylaxis, or replacing a medical compression plan.
  stopIf:
  - Severe pain, pain that feels wrong, pain out of proportion, rapidly increasing tightness/swelling, a hard/tight limb compartment, or pain with toe/ankle movement.
  - New numbness, tingling, weakness, gait instability, foot drop, trouble lifting the toes, foot slapping, dizziness, fainting, or any symptom that makes walking unsafe after removal.
  - Unexplained calf pain, one-sided swelling/warmth/redness, sudden chest pain, unexplained shortness of breath, coughing blood, fainting, or suspected DVT/PE symptoms; remove the garment and seek urgent/emergency care for chest symptoms, shortness of breath, coughing blood, fainting, or suspected PE.
  - Cold, pale, blue, mottled, or suddenly discolored foot/leg; new ischemic rest pain; loss of pulse; or new severe circulation symptoms.
  - Bruising, blisters, pressure sores, skin breakdown, marked irritation, burns, rash, wound opening, infection signs, pressure hot spots, proximal/genital swelling, genital/groin numbness or pain, or any wound under the garment.
  - Garment presses focally on the fibular head, knee, ankle bone, groin/genitals, surgical site/hardware, skin graft/bypass area, or another bony prominence.
  - Device malfunction, failure to deflate, liquid exposure, damaged hose/pump/garment, damaged power supply, fall/obstruction hazard, abnormal pressure, or inability to remove quickly.
  - Any session requires walking with leg attachments or any activity that prevents immediate stop/removal.
  - Symptoms recur or worsen across repeated sessions, delayed symptoms appear later the same day, or safety concerns outweigh any comfort benefit.
  notes:
  - Healthy recovery use has a different risk profile than supervised clinical IPC; do not borrow clinical efficacy claims into this page.
  - Rare serious harms are not well quantified for consumer recovery use, so conservative screening and stop rules are intentional.
  - When unsure whether a condition is relevant, choose clinician guidance before compression rather than self-clearing.
  - Travel or prolonged-sitting use is comfort-only in this protocol and does not replace mobility breaks, calf exercises, prescribed stockings, anticoagulation, or clinician-directed VTE prevention.
---

Use consumer pneumatic compression pants, boots, or leg sleeves as a bounded soreness-and-comfort experiment, not as a medical compression protocol.

## How to use this page

This protocol is for generally healthy adults testing whether a repeatable lower-limb IPC session helps post-exercise soreness, perceived recovery, leg heaviness, or comfort enough to be worth using. It is not a DVT/PE prevention plan, a lymphedema/lipedema or edema treatment, a post-thrombotic-syndrome plan, a venous-ulcer or wound-care protocol, a PAD/CLTI or diabetes-foot-risk protocol, or post-surgical prophylaxis. Those uses stay in clinician-guided variants.

## What to measure

Use soreness, muscular fatigue, perceived recovery/readiness, leg heaviness, comfort, and adverse symptoms as the primary experiment signals. Optional performance tests, circumference, heart-rate-response logs, CK, or inflammatory markers can be context only unless a separate test plan controls them carefully.

## Research readout

The research base does not support a simple “recovery boots work” headline. The most defensible direct claim is narrower: IPC or pressotherapy may reduce subjective soreness, pain, or immediate fatigue for some post-exercise contexts, while objective performance, muscle function, CK, inflammation, lactate, and broad recovery outcomes are mixed or uncertain.

Recent controlled athlete and EIMD trials also include null or no-clear-advantage findings for neuromuscular, biochemical, perceptual, jump-performance, and comparator outcomes, so positive soreness language should stay bounded to subjective or immediate-perception signals.

The starter dose is intentionally practical rather than authoritative. A 20–30 minute session at the lowest comfortable pressure/intensity tracks common direct-study and device-practice patterns, but pressure, chamber sequence, garment coverage, posture, and timing vary too much to claim an optimal setting.

## Safety readout

Screen first and stop early. Do not start unsupervised if there are clot/PE symptoms, prior DVT/PE or high-risk clot-prevention context, unexplained one-sided swelling, active infection or wounds, significant arterial disease, acute or decompensated heart failure, severe uncontrolled hypertension, recent surgery or injury, impaired sensation, inability to remove the garment quickly, direct pressure over a surgical/graft/groin/genital or bony-prominence risk area, or any medical treatment goal. Stop and remove the garment for severe pain, neurologic symptoms, skin injury, red-flag swelling/warmth/redness, shortness of breath, device malfunction, failure to deflate, abnormal pressure, or delayed symptoms; seek urgent/emergency care for chest symptoms, shortness of breath, coughing blood, fainting, or suspected PE.

Most consumer recovery sessions, when tolerated, are expected to be minor-comfort exposures, but direct recovery trials do not provide a robust adverse-event denominator. Compression-related reports and clinical sources justify conservative stop rules for skin breakdown, pressure injury, nerve symptoms including foot drop, compartment-syndrome-like severe pain/tightness, and clot/PE red flags.

## What not to conclude

Do not claim that pneumatic compression pants prevent DVT/PE, beat massage or cold therapy, restore performance, reverse muscle damage, improve wearable recovery scores, treat edema, treat lymphedema/lipedema/post-thrombotic syndrome, heal wounds, or manage PAD/CLTI. The extracted evidence can support a cautious comfort/soreness self-test and strong safety boundaries, not those stronger claims.
