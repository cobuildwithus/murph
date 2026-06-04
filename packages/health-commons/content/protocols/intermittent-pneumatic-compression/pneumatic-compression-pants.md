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
media:
- kind: image
  relativePath: design-assets/hero-pneumatic-compression-pants.jpg
  mediaType: image/jpeg
  caption: Pneumatic Compression Pants
relations:
- type: parent_family
  target: experiment_family:intermittent-pneumatic-compression
- type: primary_biomarker
  target: biomarker:muscle-soreness-score
- type: secondary_biomarker
  target: biomarker:leg-heaviness-score
- type: secondary_biomarker
  target: biomarker:perceived-recovery-score
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
  sessionShape:
    label: One session
    segments:
    - label: compression
      kind: stimulus
      durationMinutes: 20
    ticks:
    - "0"
    - "20 min minimum"
  interventionSessionsMinimum: 8
  interventionSessionsTarget: 12
  steps:
    - "Complete safety screen; do not use for clot prevention, swelling treatment, wound care, surgery prophylaxis, or medical compression."
    - "Record device model, garment coverage, pressure/intensity, mode, duration, posture, and trigger context."
    - "Inspect skin and equipment; confirm quick removal and no focal pressure on nerves, joints, groin, hardware, grafts, or lesions."
    - "Sit or recline; do not walk with attachments; keep tubing, cords, and garments from creating fall risk."
    - "Start at lowest comfortable setting; stop for pain, numbness, tingling, hotspots, or bracing against pressure."
    - "Run 20–30 min after the chosen trigger, keeping the rest of recovery stable."
    - "Stop early for any stop condition; remove garment, inspect skin, and log symptoms."
    - "Keep device, pressure, duration, mode, and timing consistent unless safety or comfort requires lowering dose."
  safetyNotes:
  - This is not a DVT/PE-prevention, lymphedema/lipedema, wound-care, PAD/CLTI, venous-ulcer, post-thrombotic-syndrome, diabetes-foot-risk, or post-surgical protocol.
  - Safety screening and stop rules are stronger than efficacy claims because direct recovery trials do not provide a robust consumer adverse-event denominator.
  - Use clinician guidance before starting if any relevant medical condition, medication, recent surgery/injury, sensory issue, skin issue, unexplained swelling, or clot/travel-risk context makes compression risk uncertain.
  tips:
  - Before day 1, record device model, garment coverage, mode, pressure level, posture, and trigger.
  - Make the first session a tolerance check: lowest comfortable pressure, 20 minutes, easy removal path.
  - Sit or recline and keep tubing clear; stop and remove the garment for bracing, tingling, numbness, or hotspot pressure.
  - Do not add massage, cold plunge, sauna, aggressive stretching, blood-flow restriction, or new recovery supplements during the test.
  - After removal, inspect skin immediately and later that day; log pressure marks, symptoms, and resolution.
  - Compare matched triggers: same workout type, standing day, or sitting duration; never use it as a clot plan.
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
  sessionFieldIds:
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
  expected: Less sore
  expectedDirection: down
  estimatedChange:
    kind: mixed_or_contextual
    window: 24–96 hours after hard lower-body training
    confidence: moderate
    basis: "source_artifact:pmid-35456170 reports SMD -0.33 for soreness from 24–96 hours after DOMS induction; source_artifact:pmid-39416507 supports pain/soreness as a clearer practical signal than objective recovery. Mapping that standardized effect to a simple soreness check-in is approximate."
  protocolProminence: focus
- biomarkerKey: biomarker:leg-heaviness-score
  description: "Sequential pressure empties and refills the lower legs, reducing pooled fluid that makes legs feel heavy."
  expected: Lighter legs
  expectedDirection: down
  estimatedChange:
    kind: mixed_or_contextual
    window: Same evening or within 2 hours after a standing/sitting trigger
    confidence: low
    basis: "source_artifact:pmid-34260560 and source_artifact:pmid-36419142 reported leg-pain and circumference improvements after prolonged-standing contexts. Confidence stays low because leg heaviness was not pooled and this consumer protocol is not a swelling-treatment plan."
  protocolProminence: focus
- biomarkerKey: biomarker:perceived-recovery-score
  description: "Fluid movement and quiet rest reduce immediate leg fatigue, making the next session feel more available."
  expected: More recovered
  expectedDirection: up
  estimatedChange:
    kind: mixed_or_contextual
    window: Immediately after the session to next morning
    confidence: low
    basis: "source_artifact:doi-10.1007-s11332-024-01217-5 reported higher total-quality-recovery without better cycling power, and source_artifact:pmid-27011305 reported immediate fatigue relief after ultramarathon IPC. Null athlete trials keep confidence low."
  protocolProminence: focus
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Set up a cautious pneumatic compression pants experiment for post-exercise soreness, perceived recovery, or leg comfort—not for clot prevention or medical swelling treatment."
    intentSummary: "Consumer lower-limb IPC recovery or comfort self-experiment"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "clot_or_pe_red_flags"
        prompt: "known or suspected DVT/PE, acute thrombophlebitis, unexplained calf pain, one-sided swelling/warmth/redness, chest pain, unexplained shortness of breath, coughing blood, fainting, or current clinician-directed clot-prevention plan"
        ifPositive: "do_not_start_unsupervised"
      - id: "vte_history_or_high_risk_travel_context"
        prompt: "previous DVT/PE, known thrombophilia/clotting disorder, active cancer, recent hospitalization/surgery/trauma, cast/splint or prolonged bed rest, pregnancy/postpartum, estrogen therapy/hormonal contraception/HRT, strong family history of VTE, or travel/prolonged sitting where the goal is clot prevention"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "cardiopulmonary_or_vascular_risk"
        prompt: "acute pulmonary edema, cardiopulmonary edema, acute or decompensated heart failure, edema from congestive heart failure, severe arterial disease or PAD/CLTI, acute limb ischemia, severe arteriosclerosis/ischemic vascular disease, severe/uncontrolled hypertension, acute/severe heart/liver/kidney disease, systemic edema, or a condition where increasing venous or lymphatic return may be unsafe"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "skin_infection_wound_or_sensation_risk"
        prompt: "active infection, cellulitis, erysipelas, phlegmon, active phlebitis, open wound, leg ulcer, burn, blister, skin rash, fragile skin, tumor/cancerous lesion near the garment site, diabetes-related foot risk, neuropathy or reduced sensation, abnormal pressure sensitivity, severe bony prominences, or medicines that alter sensation or alertness"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "recent_injury_surgery_or_structural_risk"
        prompt: "recent surgery, direct pressure over a surgical site or hardware, recent skin graft or vascular bypass/graft, immobilization, cast/splint, fracture, dislocation, suspected compartment syndrome, major recent injury, severe osteopenia/osteoporosis or bone fragility, severe bony prominences, poor garment fit, focal pressure over the fibular head/knee/ankle/groin/genitals, anticoagulant or bleeding-risk situation, pregnancy/postpartum, or relevant implanted medical device"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "can_stop_and_remove_device"
        prompt: "can you reliably feel warning symptoms, understand the stop rules, reach the power/disconnect path, and remove the garment quickly without help?"
        ifNegative: "do_not_start_unsupervised"
      - id: "medical_treatment_goal"
        prompt: "is the intended goal DVT/PE prevention, travel VTE prevention, unexplained swelling treatment, lymphedema/lipedema, venous ulcer, wound care, PAD/ischemia, diabetes-related foot risk, post-thrombotic syndrome, post-surgical prophylaxis, or replacing a medical compression plan"
        ifPositive: "do_not_start_unsupervised"
    stopIf:
      additionalConditions:
        - "device fails to deflate, pressure feels abnormal, or the garment cannot be removed quickly"
        - "session requires walking with leg attachments or creates a tubing, cord, obstruction, or fall hazard"
        - "garment presses focally on the fibular head, knee, ankle bone, groin/genitals, surgical site/hardware, skin graft/bypass area, or another bony prominence"
        - "goal shifts from comfort/recovery to medical treatment or clot prevention"
  setupSlots:
    - id: "target_use_case"
      label: "Target use case"
      question: "What are you testing: post-exercise soreness, perceived recovery/readiness, leg heaviness/comfort after standing or sitting, or something else? If you choose ''other'', it cannot mean new swelling, one-sided swelling, painful swelling, injury, numbness, wound care, circulation disease, or medical treatment."
      options:
        - "post_exercise_soreness"
        - "perceived_recovery"
        - "leg_heaviness_comfort"
        - "other_nonmedical_comfort"
      writePath: "runPlan.targetUseCase"
    - id: "device_model"
      label: "Device model"
      question: "What brand/model or device type will you use?"
      writePath: "runPlan.deviceModel"
    - id: "garment_coverage"
      label: "Garment coverage"
      question: "Which areas will the garment cover? Do not use direct groin/genital compression or a fit that creates focal pressure over bony prominences, surgical sites/hardware, skin graft/bypass areas, or lesions."
      options:
        - "feet_calves"
        - "calves_thighs"
        - "full_legs"
        - "pants_hips"
        - "other"
      writePath: "runPlan.garmentCoverage"
    - id: "pressure_intensity"
      label: "Pressure or intensity"
      question: "What pressure, level, or intensity setting will you start with? Use the lowest comfortable setting within the device manual. Do not copy high-pressure study settings, do not use the device maximum as a target, and do not increase pressure to force a stronger effect."
      writePath: "runPlan.pressureIntensity"
    - id: "compression_mode"
      label: "Compression mode"
      question: "What mode, sequence, zone pattern, or program will you use?"
      constraints:
        optional: true
      writePath: "runPlan.compressionMode"
    - id: "duration_minutes"
      label: "Session duration"
      question: "How many minutes per session will you use? The ordinary starter plan is 20–30 minutes; do not use continuous, overnight, or >30-minute sessions in this wellness protocol."
      constraints:
        minimum: 10
        maximum: 30
        recommendedMinimum: 20
        recommendedMaximum: 30
        aboveMaximumDisposition: "separate_device_specific_or_clinician_guided_variant"
      writePath: "runPlan.durationMinutes"
    - id: "sessions_per_week"
      label: "Sessions per week"
      question: "How many sessions per week are realistic? The default is 3, with a target of 12 over 21 days."
      constraints:
        minimum: 1
        maximum: 7
        default: 3
      writePath: "runPlan.sessionsPerWeek"
    - id: "timing_after_trigger"
      label: "Timing after trigger"
      question: "When will you usually do the session relative to the trigger?"
      options:
        - "within_2h_after_exercise"
        - "same_day_after_exercise"
        - "after_standing_or_sitting_day"
        - "travel_comfort_only"
        - "other_consistent_timing"
      writePath: "runPlan.timingAfterTrigger"
    - id: "posture"
      label: "Posture"
      question: "What stable position will you use during sessions?"
      options:
        - "seated"
        - "reclined"
        - "lying_down"
      writePath: "runPlan.posture"
    - id: "measurement_focus"
      label: "Measurement focus"
      question: "Which primary outcome should Murph use?"
      options:
        - "muscle_soreness"
        - "perceived_recovery"
        - "leg_heaviness"
      writePath: "analysisPlan.primaryOutcomePreference"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Would you like session reminders and one same-day missing-log check?"
      options:
        - "none"
        - "pre_session"
        - "pre_session_plus_same_day_missing_log_check"
      constraints:
        askWhen: "at_confirmation"
      writePath: "assistantSupport.reminderPolicy"
  planDefaults:
    testPlanId: "soreness-comfort-28d"
    firstSessionGuidance: "Make the first session a tolerance check: lowest comfortable pressure, reachable disconnect, no walking, no focal pressure over fibular head/knee/ankle/groin/genitals or surgical/graft areas, and stop at the first wrong-feeling symptom."
  trackingHints:
    confounders:
      - "exact time since workout, workout type, intensity, muscle group, and DOMS/injury distinction"
      - "time of day, posture before measurement, and session posture"
      - "exact device model, garment coverage, zones, mode, pressure/intensity, duration, and any pressure/duration change"
      - "whether the garment contacted fibular head, knee/ankle bony prominences, groin/genitals, surgical hardware/site, graft/bypass area, or skin lesion"
      - "travel duration, prolonged sitting/standing duration, cast/splint/immobility, and whether mobility breaks/calf exercises occurred"
      - "skin check before, immediately after, and later the same day"
      - "new injury, calf pain, swelling, warmth, redness, numbness, weakness, foot drop, skin mark, blister, bruise, wound, infection sign, or delayed symptom"
      - "medications: anticoagulants, antiplatelets, NSAIDs/analgesics, sensory-altering meds, stimulants, diuretics, hormone therapy/estrogen if travel or swelling is relevant"
      - "pregnancy/postpartum status if relevant, menstrual cycle/hormonal context if the user already tracks it"
      - "illness, fever, cellulitis, wound, burn, dermatitis, or infection"
      - "sleep debt, alcohol, hydration, heat/cold/sauna exposure, massage, stretching, cold plunge, BFR, compression garments, or other recovery modalities"
      - "whether the session was stopped early, why, and whether symptoms resolved after removal"
    notes:
      - "Log early stops as useful safety data, not failed adherence."
      - "Keep pressure and duration stable unless safety or comfort requires a lower dose."
  supportHints:
    missedLogFollowupCopy: "Did you use the compression pants session today? Totally fine either way — I just want the experiment record and symptoms to be accurate."
whyItWorks:
  - "## Mechanical squeeze moves fluid\n\nSequential compression empties veins and interstitial fluid from the legs during inflation. Deflation allows refill; each cycle moves blood and fluid through tissue."
  - "## Comfort is the practical endpoint\n\nThe best signal is how the legs feel after a matched trigger: soreness, heaviness, and fatigue. It is not proof that muscle damage reversed."
  - "## Dose fails when pressure becomes stress\n\nLowest comfortable pressure keeps the mechanism circulatory. Pain, numbness, skin marks, swelling, or focal pressure means the device is loading the wrong tissue."
mechanismChain:
  -
    label: "Session"
    content: "20–30 min sequential leg compression · low comfortable pressure"
  -
    label: "Pressure cycle"
    content: "Inflation empties veins and fluid; deflation allows refill"
  -
    label: "Repeated signal"
    content: "Post-exercise pooling, heaviness, and soreness meet same cycle"
  -
    label: "Adaptation"
    content: "Legs feel lighter · soreness drops · comfort improves"
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
    - source_artifact:pmid-40094188
    - source_artifact:pmid-41048245
    - source_artifact:pmid-29513036
    - source_artifact:pmid-35475921
    - source_artifact:pmid-41003610
    - source_artifact:pmid-34774089
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
    - source_artifact:pmid-30738701
    - source_artifact:pmid-16879230
    - source_artifact:pmid-17012016
  - id: clinical-supervised-boundary
    label: Clinical IPC boundary
    stance: safety_boundary
    summary: Hospital VTE prophylaxis, stroke, ICU, surgery, lymphedema, lipedema, post-thrombotic syndrome, venous-ulcer/wound-care, and PAD/CLTI uses are real clinical IPC contexts but require screening, monitoring, prescribed doses, and follow-up.
    sourceKeys:
    - source_artifact:nice-ng89-vte-risk-reduction-2018-03-21
    - source_artifact:pmid-22315261
    - source_artifact:pmid-30482763
    - source_artifact:fhi-ipc-acute-stroke-hta-2020-12-22
    - source_artifact:pmid-23727163
    - source_artifact:pmid-30779530
    - source_artifact:cms-pneumatic-compression-devices-2002-01-14
    - source_artifact:pmid-39207406
    - source_artifact:pmid-32521126
    - source_artifact:pmid-30339493
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
  - known_suspected_or_prior_dvt_pe
  - acute_thrombophlebitis_or_active_phlebitis
  - unexplained_calf_pain_or_swelling
  - chest_pain_coughing_blood_or_fainting
  - unexplained_shortness_of_breath
  - known_thrombophilia_or_clotting_disorder
  - clinician_directed_clot_prevention_plan
  - acute_or_decompensated_heart_failure
  - pulmonary_or_cardiopulmonary_edema
  - severe_arterial_disease_pad_or_clti
  - acute_limb_ischemia
  - severe_uncontrolled_hypertension
  - acute_severe_heart_liver_or_kidney_disease
  - active_infection_cellulitis_or_phlebitis
  - open_wound_leg_ulcer_burn_or_skin_rash
  - fragile_skin_or_blistering_dermatosis
  - tumor_or_cancerous_lesion_near_garment
  - lymphangiosarcoma
  - neuropathy_or_reduced_sensation
  - abnormal_pressure_sensitivity
  - medication_altering_sensation_or_alertness
  - inability_to_feel_symptoms_or_remove_garment
  - recent_surgery_or_pressure_over_surgical_site
  - recent_skin_graft_or_vascular_bypass_graft
  - fracture_dislocation_or_major_injury
  - cast_splint_or_immobilization
  - severe_osteoporosis_or_bone_fragility
  - suspected_compartment_syndrome
  - poor_garment_fit_or_focal_bony_pressure
  - anticoagulant_or_blood_thinner_use
  - bleeding_disorder_or_major_bruising_risk
  - pregnancy_or_postpartum
  - diabetes
  - varicose_veins
  - relevant_implanted_medical_device
  - unsafe_venous_or_lymphatic_return_condition
  - dvt_pe_or_vte_prevention_goal
  - lymphedema_lipedema_or_venous_ulcer_goal
  - replacing_a_medical_compression_plan
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
  - Consumer recovery use differs from clinical IPC — do not borrow clinical claims.
  - Rare serious harms are poorly quantified — conservative screening is intentional.
  - When in doubt, get clinician guidance before compression rather than self-clearing.
  - Travel/sitting use is comfort-only — does not replace VTE prevention, stockings, or mobility breaks.
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
