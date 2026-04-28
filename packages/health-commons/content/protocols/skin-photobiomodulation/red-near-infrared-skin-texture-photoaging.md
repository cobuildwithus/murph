---
schemaVersion: "murph.commons.page.v1"
entityType: "protocol_variant"
key: "protocol_variant:skin-photobiomodulation/red-near-infrared-skin-texture-photoaging"
slug: "protocols/skin-photobiomodulation/red-near-infrared-skin-texture-photoaging"
title: "Red And Near Infrared Light For Skin Texture And Photoaging"
summary: "Use a specified adult facial or periocular red-plus-near-infrared LED/IRED mask on a conservative fixed schedule, with eye protection, standardized photos, and tolerability logs, to test whether skin texture or photoaging scores change over weeks."
status: "draft"
quality: "usable"
aliases:
  - "red near infrared light for skin texture"
  - "red and NIR LED mask for photoaging"
  - "red light therapy for wrinkles"
  - "facial photobiomodulation"
  - "LED mask skin texture experiment"
  - "red/NIR photoaging PBM"
categories:
  - "skin"
  - "photoaging"
  - "photobiomodulation"
  - "cosmetic"
  - "light"
  - "murph-canonical"
relations:
  -
    type: "parent_family"
    target: "experiment_family:skin-photobiomodulation"
  -
    type: "primary_biomarker"
    target: "biomarker:standardized-skin-photo-score"
  -
    type: "secondary_biomarker"
    target: "biomarker:periocular-wrinkle-score"
  -
    type: "secondary_biomarker"
    target: "biomarker:skin-texture-roughness-score"
  -
    type: "safety_outcome"
    target: "biomarker:skin-tolerability-symptoms"
  -
    type: "default_measurement_method"
    target: "measurement_method:skin/standardized-photo-score-workflow"
  -
    type: "optional_measurement_method"
    target: "measurement_method:skin/home-standardized-photo-roi-analysis"
  -
    type: "measurement_upgrade"
    target: "measurement_method:skin/clinic-imaging-upgrade"
  -
    type: "cites"
    target: "source_artifact:pmid-39960921"
  -
    type: "cites"
    target: "source_artifact:pmid-32649063"
  -
    type: "cites"
    target: "source_artifact:doi-10.3390-cosmetics12010004"
  -
    type: "cites"
    target: "source_artifact:pmid-40167796"
  -
    type: "cites"
    target: "source_artifact:pmid-36749255"
  -
    type: "cites"
    target: "source_artifact:pmid-16414908"
  -
    type: "cites"
    target: "source_artifact:pmid-17566756"
  -
    type: "cites"
    target: "source_artifact:pmid-15909229"
  -
    type: "cites"
    target: "source_artifact:pmid-16989189"
  -
    type: "cites"
    target: "source_artifact:pmid-17760698"
  -
    type: "cites"
    target: "source_artifact:pmid-37418018"
  -
    type: "cites"
    target: "source_artifact:pmid-39439130"
  -
    type: "cites"
    target: "source_artifact:pmid-32716115"
  -
    type: "cites"
    target: "source_artifact:pmid-38309304"
  -
    type: "cites"
    target: "source_artifact:pmid-24049929"
  -
    type: "cites"
    target: "source_artifact:pmid-38674067"
  -
    type: "cites"
    target: "source_artifact:pmid-38307144"
  -
    type: "cites"
    target: "source_artifact:pmid-33594706"
  -
    type: "cites"
    target: "source_artifact:pmid-19587693"
  -
    type: "cites"
    target: "source_artifact:fda-currentbody-series-2-k250966-2025-06-25"
  -
    type: "cites"
    target: "source_artifact:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20"
  -
    type: "cites"
    target: "source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09"
  -
    type: "cites"
    target: "source_artifact:fda-light-tree-led-mask-k221946-2022-11-22"
  -
    type: "cites"
    target: "source_artifact:pmid-41032498"
  -
    type: "cites"
    target: "source_artifact:pmid-26964800"
  -
    type: "cites"
    target: "source_artifact:pmid-20799848"
  -
    type: "cites"
    target: "source_artifact:pmid-30044464"
  -
    type: "cites"
    target: "source_artifact:pmid-22461763"
  -
    type: "cites"
    target: "source_artifact:pmid-39122507"
  -
    type: "cites"
    target: "source_artifact:pmid-39335685"
  -
    type: "cites"
    target: "source_artifact:pmid-37533142"
  -
    type: "cites"
    target: "source_artifact:pmid-32541484"
  -
    type: "cites"
    target: "source_artifact:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17"
  -
    type: "cites"
    target: "source_artifact:pmid-35606999"
  -
    type: "cites"
    target: "source_artifact:pmid-28891192"
  -
    type: "cites"
    target: "source_artifact:fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27"
  -
    type: "cites"
    target: "source_artifact:pmid-31483941"
  -
    type: "cites"
    target: "source_artifact:pmid-24888214"
  -
    type: "cites"
    target: "source_artifact:pmid-20410914"
  -
    type: "cites"
    target: "source_artifact:pmid-26745730"
  -
    type: "cites"
    target: "source_artifact:canada-risk-thermal-harm-energy-devices-2020-08-21"
  -
    type: "cites"
    target: "source_artifact:aad-red-light-therapy-safety-2024-09-13"
  -
    type: "cites"
    target: "source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24"
  -
    type: "cites"
    target: "source_artifact:cdc-sun-exposure-photosensitizing-medications-2025-04-23"
  -
    type: "cites"
    target: "source_artifact:pmid-33640513"
  -
    type: "cites"
    target: "source_artifact:pmid-30888626"
  -
    type: "cites"
    target: "source_artifact:pmid-33491908"
  -
    type: "cites"
    target: "source_artifact:pmid-36722207"
  -
    type: "cites"
    target: "source_artifact:bmla-laser-ipl-treatment-guidelines-2019-05-01"
  -
    type: "cites"
    target: "source_artifact:pmid-30506819"
  -
    type: "cites"
    target: "source_artifact:pmid-34575408"
  -
    type: "cites"
    target: "source_artifact:pmid-36780572"
  -
    type: "cites"
    target: "source_artifact:pmid-39133416"
  -
    type: "cites"
    target: "source_artifact:pmid-39319750"
  -
    type: "cites"
    target: "source_artifact:pmid-33921839"
  -
    type: "cites"
    target: "source_artifact:pmid-24286286"
  -
    type: "cites"
    target: "source_artifact:pmid-37522497"
  -
    type: "cites"
    target: "source_artifact:pmid-41091280"
  -
    type: "cites"
    target: "source_artifact:pmid-28195844"
  -
    type: "cites"
    target: "source_artifact:pmid-29858421"
  -
    type: "cites"
    target: "source_artifact:pmid-20456545"
  -
    type: "cites"
    target: "source_artifact:pmid-27257391"
  -
    type: "cites"
    target: "source_artifact:clinicaltrials-nct04145999-photobiomodulation-prp-facial-rejuvenation-2019-10-31"
  -
    type: "cites"
    target: "source_artifact:pmid-29356026"
  -
    type: "cites"
    target: "source_artifact:pmid-36310510"
  -
    type: "cites"
    target: "source_artifact:pmid-33938981"
  -
    type: "cites"
    target: "source_artifact:pmid-40253006"
  -
    type: "cites"
    target: "source_artifact:pmid-40751922"
  -
    type: "cites"
    target: "source_artifact:pmid-25705949"
  -
    type: "cites"
    target: "source_artifact:pmid-28741866"
lineage:
  relationship: "root"
  rationale: "Murph canonical starter for adult facial/periocular red+NIR LED/IRED mask self-experiments; adjacent wavelengths, body areas, and medical light protocols remain sibling or excluded variants."
attribution:
  ownerType: "murph"
protocol:
  doseSignature: "6 weeks · 5 sessions/week · 10 min/session · red 630-660 nm + NIR 830-855 nm facial/periocular LED/IRED wrinkle or texture mode · eye protection required"
  target: "specified adult facial or periocular red+NIR LED/IRED mask, wrinkle or texture mode only"
  frequency:
    sessionsPerWeek: 5
  durationMinutes:
    min: 10
    max: 10
  interventionSessionsMinimum: 24
  interventionSessionsTarget: 30
  steps:
    - "Confirm the device model, red/NIR wavelengths or mode, labeled session length, treatment area, timer or auto-shutoff, and manufacturer eye-protection instructions before starting."
    - "Take baseline standardized photos of the chosen face regions before the first intervention session, using the same lighting, camera, distance, expression, and makeup/sunscreen rule you will use later."
    - "Use only the red/NIR wrinkle or texture mode for this run; do not use blue, violet, acne, UV, heat-seeking, laser, IPL, PDT, or topical-activation modes as part of this protocol."
    - "Put on the manufacturer-specified eye inserts, shields, or goggles before turning the device on, and do not look directly at active LEDs."
    - "Run one 10-minute session on 5 days each week for 6 weeks, unless the selected device label is more conservative; do not increase duration, frequency, or closeness to chase faster results."
    - "Keep skincare actives, exfoliation, peels, fillers, lasers/IPL, PDT, sun exposure habits, and other cosmetic interventions as stable as practical during the run."
    - "After each session, log session minutes, mode, treatment area, eye protection, heat or discomfort, skin irritation, pigment changes, headache, eye symptoms, and any skincare or procedure changes."
    - "Repeat the same standardized photos at week 4 and week 6; score only pre-specified regions and, if using optional image-derived endpoints, rerun the same ROI templates and ImageJ/Fiji settings before reviewing adherence and confounders."
  tips:
    - "Manufacturer wavelength and irradiance values are useful to record, but they are not the same as independent radiometry."
    - "A mask that sits on the skin has different exposure geometry from a panel; use a panel only as a separate fork with distance and angle logged."
    - "Periocular or crow's-feet outcomes are region-specific; do not count them as proof of whole-face change."
    - "A useful result should be visible across repeated photos or scores and still make sense after checking adherence, skincare, lighting, sun exposure, sleep, stress, and procedures."
    - "Optional wrinkle-length, calibrated-color, and texture-index measurements are personal trend proxies only; use the same ROI, lighting, calibration, and free analysis workflow every time rather than changing methods mid-run."
  keepInMind:
    - "Direct home/facial red+NIR evidence is supportive but heterogeneous; this is a cautious self-test, not a promise of rejuvenation."
    - "Outcome changes are slow and may be subtle; first-session warmth, glow, or satisfaction is not the endpoint."
    - "Red-only, amber/yellow, blue/acne, neck, under-eye-only, full-body panel, post-procedure, PDT, laser/IPL, and ophthalmology PBM evidence belongs to adjacent variants unless explicitly cited as boundary context."
    - "Safety and eye protection outrank efficacy; stop rather than modifying the device or removing shields to treat closer to the eyes."
  logFields:
    - "device model"
    - "wavelengths or mode"
    - "treatment area"
    - "session date"
    - "session minutes"
    - "sessions this week"
    - "eye protection used"
    - "skin heat or pain"
    - "redness or irritation"
    - "pigment change"
    - "skin tone or pigment-history context"
    - "headache"
    - "eye discomfort or visual symptoms"
    - "eye protection fit, displacement, heat, or contact irritation"
    - "skincare changes"
    - "medication or topical changes"
    - "cosmetic procedures"
    - "sun exposure"
    - "standardized photo checkpoint"
  stopConditions:
    - "Stop for tearing, distorted vision, temporary vision loss, persistent or recurrent afterimage, flashes, spots, floaters, blurry vision, eye pain, eye irritation, or any new ocular or visual symptom during or after use."
    - "Stop if eye inserts, shields, or goggles shift, fit poorly, feel hot, cause contact irritation or allergy, or cannot be used without removing them near the eyelids."
    - "Stop for burning or stinging, itching, swelling or edema, vesicles, bullae, blistering, prolonged redness, pain, or new/worsening hyperpigmentation or melasma-like change."
    - "Stop and seek clinical review for any new, changing, bleeding, crusting, painful, suspicious, or undiagnosed lesion in the treatment area."
    - "Pause before continuing if a photosensitizing medication or topical is started or changed, a major skincare active is added, a cosmetic procedure occurs or is planned, or sunburn/recent intense tanning occurs."
    - "Stop for damaged device parts, device malfunction, unexpected heat or hot spots, timer or auto-shutoff failure, unclear mode behavior, or any pressure to increase dose, frequency, closeness, or remove protection."
    - "End the experiment if adherence is too low for interpretation, if skincare/procedure changes make the photos uninterpretable, or if the protocol creates anxiety or unsafe behavior."
testPlans:
  -
    planId: "skin-photo-56d"
    durationDays: 56
    baselineDays: 14
    interventionDays: 42
    primaryBiomarkerKey: "biomarker:standardized-skin-photo-score"
    secondaryBiomarkerKeys:
      - "biomarker:periocular-wrinkle-score"
      - "biomarker:skin-texture-roughness-score"
    safetyOutcomeKeys:
      - "biomarker:skin-tolerability-symptoms"
    minimumAdherenceSessions: 24
    targetAdherenceSessions: 30
    notes:
      - "Use the 14 baseline days to lock camera, lighting, region, expression, skincare, and scoring rules before any intervention sessions."
      - "Score week-4 photos as an early check and week-6 photos as the first starter read; a 12-to-16-week extension can be created as a separate fork when the device label and user burden support it."
      - "Analyze standardized photo scores separately from satisfaction or skin-feel ratings because subjective and objective signals can diverge."
      - "Use optional image-analysis method outputs only when the ROI template, lighting, calibration, and analysis settings are locked before comparing baseline with week-4 or week-6 images."
      - "Treat tolerability and eye symptoms as safety outcomes, not as noise to be averaged away."
expectedSignalDescriptions:
  -
    biomarkerKey: "biomarker:standardized-skin-photo-score"
    description: "Red and near-infrared light may affect skin-cell signaling and how skin rebuilds collagen over repeated sessions. Standardized photos show whether visible texture or photoaging changed."
  -
    biomarkerKey: "biomarker:periocular-wrinkle-score"
    description: "The closest home-mask evidence includes crow's-feet and around-eye outcomes. If repeated red/NIR exposure affects skin remodeling there, lines in that region may soften."
  -
    biomarkerKey: "biomarker:skin-texture-roughness-score"
    description: "Red/NIR light may affect cell energy, inflammation, and skin remodeling. That gives a plausible path to smoother texture, though direct evidence is mixed."
measurementPlan:
  schemaVersion: "murph.commons.measurement-plan.v1"
  defaultPathId: "home-photo-score"
  paths:
    -
      pathId: "home-photo-score"
      label: "Home photo score"
      tier: "default_home"
      required: true
      methodKeys:
        - "measurement_method:skin/standardized-photo-score-workflow"
      outcomeKeys:
        - "biomarker:standardized-skin-photo-score"
        - "biomarker:periocular-wrinkle-score"
        - "biomarker:skin-texture-roughness-score"
      safetyOutcomeKeys:
        - "biomarker:skin-tolerability-symptoms"
      notes:
        - "Default path: standardized photos, fixed scoring rubrics, and session-by-session tolerability logs. This is the lowest-burden starter path."
    -
      pathId: "home-image-analysis-add-on"
      label: "Home image-analysis add-on"
      tier: "optional_home"
      required: false
      methodKeys:
        - "measurement_method:skin/home-standardized-photo-roi-analysis"
      outcomeKeys:
        - "biomarker:periocular-wrinkle-score"
        - "biomarker:skin-texture-roughness-score"
      safetyOutcomeKeys:
        - "biomarker:skin-tolerability-symptoms"
      notes:
        - "Optional add-on: fixed ROI analysis can quantify wrinkle-line and texture proxies, while calibrated color stays a safety/context proxy unless a pigment or erythema outcome is added."
        - "Do not require this path for a normal starter run; use it only when the user can keep ROI templates, calibration, and analysis settings stable."
    -
      pathId: "clinic-imaging-upgrade"
      label: "Clinic imaging upgrade"
      tier: "clinic"
      required: false
      methodKeys:
        - "measurement_method:skin/clinic-imaging-upgrade"
      outcomeKeys:
        - "biomarker:standardized-skin-photo-score"
        - "biomarker:periocular-wrinkle-score"
        - "biomarker:skin-texture-roughness-score"
      safetyOutcomeKeys:
        - "biomarker:skin-tolerability-symptoms"
      notes:
        - "Upgrade path only: use clinic imaging, profilometry, colorimetry, or validated scales when they already exist or the user intentionally chooses the extra cost and burden."
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v1"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore a red and near-infrared LED mask experiment for skin texture or photoaging."
    intentSummary: "Explore Red/NIR Skin Texture And Photoaging"
  contextReview:
    vaultChecks:
      -
        id: "active_experiments"
        label: "Active experiments"
        reason: "Avoid stacking another visible-skin, sleep, supplement, skincare, or recovery experiment on top of this one unless attribution is intentionally weak."
        readHints:
          - "experiment list --status active"
      -
        id: "skin_photo_baseline"
        label: "Existing skin photos or notes"
        reason: "Check whether the user already has comparable baseline photos, skincare notes, or recent cosmetic changes before asking for a new baseline workflow."
        freshnessDays: 30
        readHints:
          - "journal show"
          - "memory show"
          - "search query \"skin photos skincare red light LED mask photoaging\""
      -
        id: "device_context"
        label: "Device model and mode"
        reason: "The protocol should not become active unless the selected device, red/NIR mode, session duration, treatment area, and eye-protection setup are identifiable."
        freshnessDays: 30
        readHints:
          - "memory show"
          - "search query \"LED mask red NIR device model mode eye protection\""
      -
        id: "safety_context"
        label: "Skin, medication, procedure, and eye-safety context"
        reason: "Screen for pigment risk, photosensitivity, active irritation, suspicious lesions, recent procedures, ocular risk, and inability to use eye protection."
        freshnessDays: 30
        readHints:
          - "memory show"
          - "journal show"
          - "search query \"photosensitivity medication eye skin procedure melasma\""
    notes:
      - "Onboarding is planning-only until the user explicitly confirms the device, eye protection, baseline-photo workflow, schedule, and logging path."
  safetyScreen:
    cautionLevel: "moderate"
    mode: "ask_compact_then_expand_if_positive"
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      -
        id: "under_18"
        prompt: "Are you under 18?"
        ifPositive: "do_not_start_unsupervised"
        why: "This starter is an adult facial/periocular cosmetic self-experiment; pediatric red-light evidence is not direct skin-photoaging evidence."
      -
        id: "pregnancy_lactation"
        prompt: "Are you pregnant, trying to become pregnant, breastfeeding, or lactating?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
        why: "No pregnancy/lactation-specific source was extracted, so the page should not present this protocol as cleared for pregnancy or lactation."
      -
        id: "eye_risk_or_symptoms"
        prompt: "Do you have retinal disease, macular disease, ocular albinism, retinitis pigmentosa, congenital retinal disease, another known ocular abnormality, ocular photosensitivity, recent eye procedure, photosensitizing medication exposure, or current eye pain, tearing, flashes, floaters, afterimages, blurry or distorted vision, temporary vision loss, or other visual symptoms?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
        why: "Face-adjacent light-device sources support conservative eye screening, required protection, and stop rules for any ocular or visual symptom."
      -
        id: "eye_protection_unavailable"
        prompt: "Are the manufacturer-specified eye inserts, shields, or goggles unavailable, poorly fitting, uncomfortable, hot, or impossible for you to use for every session, or would you need to remove them to treat closer to the eyelids?"
        ifPositive: "do_not_start_unsupervised"
        why: "The starter should not run without stable manufacturer-specified eye protection, and eye symptoms or protection problems should stop the run."
      -
        id: "pigment_or_photosensitivity_risk"
        prompt: "Do you have melasma, post-inflammatory hyperpigmentation history, active pigment flare, Fitzpatrick IV-VI skin with pigment concern, a photosensitivity condition, prior light-triggered reaction, or any systemic/topical medication or skincare active that may increase photosensitivity or barrier irritation?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
        why: "Pigment and photosensitivity evidence is mixed and adjacent, so uncertain cases should use clinician or pharmacist review rather than automatic unsupervised setup."
      -
        id: "active_skin_or_wound"
        prompt: "Is the treatment area sunburned, recently tanned from intense UV, inflamed, infected, blistered, wounded, healing from a procedure, or affected by an active rash or painful irritation?"
        ifPositive: "do_not_start_unsupervised"
        why: "Active or healing skin problems should not be folded into a cosmetic LED self-test."
      -
        id: "suspicious_lesion_or_cancer_history"
        prompt: "Is there any unexplained, changing, bleeding, crusting, suspicious, pre-cancerous, cancerous, or undiagnosed lesion in the treatment area, or do you have active or recent cancer history?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
        why: "Oncologic safety evidence is limited and supports suspicious-lesion and active/recent cancer-history screening, not reassurance."
      -
        id: "recent_energy_or_pdt"
        prompt: "Have you recently had laser, IPL, RF, microneedling, peel, filler, PRP, PDT/photosensitizer treatment, or another cosmetic procedure in the target area?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
        why: "Post-procedure and photosensitizer protocols are separate variants with different supervision and outcomes."
      -
        id: "unknown_or_hot_device"
        prompt: "Is the device model, red/NIR-only wrinkle or texture mode, timer, or nonthermal comfort unclear, or does it feel hot or painful?"
        ifPositive: "do_not_start_unsupervised"
        why: "Unknown device parameters and heat/pain undermine both safety and attribution."
    stopIf:
      inheritFromProtocolSafety: true
      additionalConditions:
        - "tearing, distorted vision, temporary vision loss, persistent/recurrent afterimage, flashes, spots, floaters, blurry vision, eye pain, irritation, discomfort, or any new ocular/visual symptom"
        - "eye protection unavailable, displaced, poorly fitting, hot, uncomfortable, allergenic, or removed near the eyelids"
        - "device heat, hot spots, damaged parts, malfunction, timer or auto-shutoff failure, burning, blistering, painful irritation, vesicles, bullae, swelling, prolonged redness, or pain"
        - "new or worsening pigment change, hyperpigmentation, or melasma-like change"
        - "new, changing, bleeding, crusting, painful, suspicious, or undiagnosed lesion in the treatment area"
        - "medication/topical change, major skincare-active change, cosmetic procedure, sunburn, or recent intense tanning that invalidates safety or interpretation"
    notes:
      - "Positive screens do not diagnose risk; they move the user to planning, clinician guidance, postponement, or a non-run education path."
      - "This adult starter should not be presented as cleared for minors, pregnancy, lactation, active/recent cancer history, suspicious lesions, eye disease, active pigment disorders, photosensitizing medications, open/healing skin, or immediate post-procedure use."
      - "Direct home/facial mask tolerability findings are short-term and incompletely characterized; safety boundaries rely on direct tolerability evidence plus adjacent eye, pigment, medication, procedure, oncologic, and thermal safety sources."
  setupSlots:
    -
      id: "device_model"
      label: "Device model"
      purpose: "safety"
      valueType: "free_text"
      askPolicy: "always"
      required: true
      question: "What exact LED mask/device model would you use?"
      target:
        object: protocol
        field: personalization.setup.deviceModel
    -
      id: "red_nir_mode"
      label: "Red/NIR mode"
      purpose: "safety"
      valueType: "free_text"
      askPolicy: "always"
      required: true
      question: "Which red/NIR wrinkle or texture mode will you use, and what wavelengths does the device report?"
      target:
        object: protocol
        field: personalization.setup.mode
    -
      id: "treatment_area"
      label: "Treatment area"
      purpose: "measurement_fidelity"
      valueType: "enum"
      askPolicy: "always"
      required: true
      options:
        - "full_face"
        - "periocular_crows_feet"
        - "split_face"
      question: "Which region will you treat and score?"
      target:
        object: protocol
        field: personalization.setup.treatmentArea
    -
      id: "session_duration_minutes"
      label: "Session duration"
      purpose: "safety"
      valueType: "integer"
      askPolicy: "always"
      required: true
      constraints:
        default: 10
        min: 1
        max: 10
      question: "What session length does the selected red/NIR mode use? This starter caps sessions at 10 minutes; if the device label requires longer use, do not activate this starter without a device-specific fork."
      target:
        object: experimentRun
        field: sessionDurationMinutes
    -
      id: "sessions_per_week"
      label: "Sessions per week"
      purpose: "adherence"
      valueType: "integer"
      askPolicy: "always"
      required: true
      constraints:
        default: 5
        min: 1
        max: 5
      question: "How many sessions per week will you do? This starter caps frequency at 5 sessions/week; more frequent use requires a separate device-specific fork."
      target:
        object: experimentRun
        field: sessionsPerWeek
    -
      id: "eye_protection_plan"
      label: "Eye protection plan"
      purpose: "safety"
      valueType: "free_text"
      askPolicy: "always"
      required: true
      question: "What eye inserts, shields, or goggles will you use every session?"
      target:
        object: protocol
        field: personalization.setup.eyeProtection
    -
      id: "baseline_photo_plan"
      label: "Baseline photo workflow"
      purpose: "measurement_fidelity"
      valueType: "free_text"
      askPolicy: "always"
      required: true
      question: "What workflow and private/local storage plan will you use to keep camera, lighting, distance, expression, and makeup/sunscreen rules identical for baseline and follow-up photos without uploading or sharing identifiable originals unless you intentionally import them?"
      target:
        object: analysisPlan
        field: measurement.photoWorkflow
    -
      id: "skincare_stability"
      label: "Skincare stability"
      purpose: "confounder_control"
      valueType: "free_text"
      askPolicy: "ask_if_unknown"
      required: true
      question: "Which skincare products, actives, procedures, and sun-exposure habits will you keep stable during the run?"
      target:
        object: onboardingCapture
        field: confounders.skincare
    -
      id: "session_log_path"
      label: "Session log path"
      purpose: "measurement_fidelity"
      valueType: "free_text"
      askPolicy: "always"
      required: true
      question: "Where will sessions, symptoms, eye protection, and photo checkpoints be logged?"
      target:
        object: experimentRun
        field: logging.path
    -
      id: "reminder_policy"
      label: "Reminder preference"
      purpose: "assistant_support"
      valueType: "reminder_policy"
      askPolicy: "ask_at_confirmation"
      required: false
      question: "Would you like opt-in session reminders or only a weekly summary?"
      target:
        object: assistantSupport
        field: reminders
  planDefaults:
    testPlanId: "skin-photo-56d"
    baselineDays: 14
    interventionDays: 42
    sessionsPerWeek: 5
    targetSessions: 30
    minimumUsefulSessions: 24
    firstSessionGuidance: "Do the first session only after device/model, red/NIR mode, eye protection, nonthermal comfort, baseline photos, and log path are confirmed."
  logging:
    sessionFields:
      - "session_date"
      - "device_model"
      - "red_nir_mode"
      - "treatment_area"
      - "session_minutes"
      - "eye_protection_used"
      - "skin_heat_or_pain"
      - "redness_or_irritation"
      - "pigment_change"
      - "headache"
      - "ocular_symptoms"
      - "skincare_changes"
      - "photo_checkpoint"
    confounders:
      - "sun_exposure"
      - "retinoids_or_acids"
      - "exfoliation"
      - "cosmetic_procedure"
      - "photosensitizing_medication"
      - "illness_or_stress"
      - "makeup_or_lighting_change"
    notes:
      - "Device/app logging is optional; manual Murph logging is acceptable, but do not describe a run as device-logged unless the selected device exposes usable session records."
  assistantPolicy:
    maxSetupQuestionsPerTurn: 2
    askBeforeCreatingAutomations: true
    missedLogFollowup: "opt_in_only"
    reminderOptions:
      - "no_reminders"
      - "session_reminders"
      - "weekly_digest"
    weeklyDigestDefault: true
    missedLogFollowupCopy: "Want to log whether you used the LED mask session and any symptoms?"
    confirmationPrompt: "Confirm the exact protocol, device, eye protection, baseline-photo workflow, schedule, logging fields, stop conditions, and reminder preference before creating an active experiment."
whyItWorks:
  - "Photobiomodulation plausibility is parameter-dependent: reviews propose photoreceptor and mitochondrial signaling pathways, including cytochrome c oxidase, ATP, reactive oxygen species, calcium signaling, and downstream skin-cell responses, but this is mechanism context rather than proof of visible rejuvenation. [source_artifact:pmid-38309304; source_artifact:pmid-24049929; source_artifact:pmid-38674067; source_artifact:pmid-38307144]"
  - "The closest human skin-aging evidence uses red light around 630-660 nm paired with near-infrared around 830-855 nm in home masks, split-face facial devices, or clinic-style LED systems, with outcomes assessed over repeated multi-week courses rather than one-off sessions. [source_artifact:pmid-39960921; source_artifact:pmid-32649063; source_artifact:doi-10.3390-cosmetics12010004; source_artifact:pmid-16414908; source_artifact:pmid-17566756]"
  - "The protocol stays conservative because LED dermatology dose reporting is heterogeneous and incomplete, and because PBM literature does not support a simple more-is-better rule. [source_artifact:pmid-41032498; source_artifact:pmid-26964800; source_artifact:pmid-22461763]"
claims:
  -
    claimId: "supportive-but-heterogeneous-direct-evidence"
    type: "evidence_scope"
    text: "Direct and near-direct human evidence for facial or periocular red/NIR LED/PBM is supportive but heterogeneous. The closest evidence includes a 630/850 nm home-mask sham-controlled crow's-feet RCT, a small 637/854 nm split-face home-device pilot, a small red-to-NIR facial-mask study without an extracted sham/randomized comparator, older clinic-supervised 633/830 nm studies, and attribution-limited home-mask or topical-combination studies; it should not be presented as a strong blanket claim that any red-light device reverses photoaging."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-39960921"
      - "source_artifact:pmid-32649063"
      - "source_artifact:doi-10.3390-cosmetics12010004"
      - "source_artifact:pmid-16414908"
      - "source_artifact:pmid-17566756"
      - "source_artifact:pmid-16989189"
      - "source_artifact:pmid-17760698"
      - "source_artifact:pmid-37418018"
      - "source_artifact:pmid-39439130"
      - "source_artifact:pmid-32716115"
    caveats:
      - "Studies differ by wavelength, device geometry, treatment area, comparator, population, schedule, and outcome method."
      - "Some home-mask sources are uncontrolled, unclear-control, male-only, device-validation, deeper-NIR, or LED-plus-topical evidence rather than clean LED-only efficacy evidence."
  -
    claimId: "closest-home-red-nir-positive-signals"
    type: "intervention_result"
    text: "The closest home/facial red+NIR sources report positive skin-aging signals, including a 630/850 nm home LED/IRED mask that favored active treatment over sham for crow's-feet outcomes, a 637/854 nm split-face home-use pilot that favored elasticity and texture-related measures, and a red-to-NIR facial mask study reporting brightening or anti-aging parameters."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-39960921"
      - "source_artifact:pmid-32649063"
      - "source_artifact:doi-10.3390-cosmetics12010004"
    caveats:
      - "The strongest direct home evidence is periocular/crow's-feet rather than a universal whole-face endpoint; some sources lack sham controls or have limited extraction detail."
  -
    claimId: "older-clinic-evidence-supportive-not-template"
    type: "evidence_scope"
    text: "Older clinic-supervised 633/830 nm facial LED studies support plausibility for periorbital or wrinkle, profilometry, elasticity, satisfaction, tone/smoothness, and dermal-remodeling signals, but they should not be used as exact home-mask dose templates."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-16414908"
      - "source_artifact:pmid-17566756"
      - "source_artifact:pmid-16989189"
      - "source_artifact:pmid-17760698"
    caveats:
      - "Clinic supervision, device geometry, schedule, control details, and measurement methods differ from current unsupervised consumer masks."
  -
    claimId: "preserve-mixed-null-outcomes"
    type: "mixed_evidence"
    text: "Mixed and null findings must stay visible: a small Omnilux Revive facial LED study reported subjective/photo response but no statistically significant objective hydration or elasticity improvement; a 660 nm red-only facial mask trial found no significant blinded Wrinkle Assessment Scale group difference despite ImageJ and satisfaction signals and no clear two-versus-three-session frequency advantage; other adjacent studies report null hydration/viscoelasticity, non-significant objective wrinkle scores, no clear red-over-white advantage, or no clear broadband red/NIR advantage over red-only."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-15909229"
      - "source_artifact:pmid-40167796"
      - "source_artifact:pmid-36780572"
      - "source_artifact:pmid-39133416"
      - "source_artifact:pmid-28195844"
      - "source_artifact:pmid-24286286"
    caveats:
      - "Most of these are adjacent or older clinical sources rather than direct red+NIR home-mask trials."
      - "They calibrate expectations and endpoint choice; they do not erase the positive direct red+NIR signals."
  -
    claimId: "outcomes-require-standardized-photos"
    type: "design_guardrail"
    text: "The most defensible Murph outcomes are pre-specified region photos and scores for crow's-feet or periocular wrinkles, texture/roughness, and overall appearance, with elasticity or firmness proxies, pores, brown spots, satisfaction, adherence, and tolerability treated as secondary or context-derived domains; these should be scored with a standardized photo workflow rather than a generic anti-aging impression."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-39960921"
      - "source_artifact:pmid-32649063"
      - "source_artifact:doi-10.3390-cosmetics12010004"
      - "source_artifact:pmid-17566756"
      - "source_artifact:pmid-15909229"
      - "source_artifact:pmid-32716115"
      - "source_artifact:pmid-37418018"
      - "source_artifact:pmid-24286286"
    caveats:
      - "Self photos and self-ratings are lower-grade proxies than blinded dermatologist review, validated imaging, or instrumented measures."
      - "Pores and brown spots mainly come from attribution-limited, co-intervention, or image-analysis contexts and should remain secondary."
  -
    claimId: "dose-is-not-optimized"
    type: "design_guardrail"
    text: "The extraction does not establish an optimized wavelength, irradiance, fluence, frequency, distance, or duration; device model, wavelengths, mode, treatment area, session minutes, geometry, and eye-protection setup must be recorded for attribution."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-41032498"
      - "source_artifact:pmid-26964800"
      - "source_artifact:pmid-20799848"
      - "source_artifact:pmid-30044464"
      - "source_artifact:fda-currentbody-series-2-k250966-2025-06-25"
      - "source_artifact:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20"
      - "source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09"
    caveats:
      - "Regulatory 510(k) summaries provide device-parameter and safety context, not clinical efficacy proof or a universal optimal dose."
  -
    claimId: "no-more-is-better-rule"
    type: "mixed_evidence"
    text: "The evidence should not be framed as more-is-better: a red-only facial-mask trial did not show clear frequency superiority and had mixed outcome-method results, a small facial LED study preserved objective hydration/elasticity null findings, broad PBM literature describes biphasic dose responses, and high-fluence red-LED safety studies do not justify home dose escalation."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-40167796"
      - "source_artifact:pmid-15909229"
      - "source_artifact:pmid-22461763"
      - "source_artifact:pmid-31483941"
    caveats:
      - "The frequency evidence is red-only and adjacent rather than clean red+NIR facial-mask efficacy evidence."
      - "The high-fluence red-LED safety evidence is not a consumer face-mask dosing recommendation."
  -
    claimId: "eye-protection-required"
    type: "safety"
    text: "Eye protection is a required control for face-adjacent red/NIR use: the protocol should require manufacturer-specified inserts, shields, or goggles, direct-gaze avoidance, and stop-use rules for any ocular symptom."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-39122507"
      - "source_artifact:pmid-39335685"
      - "source_artifact:pmid-37533142"
      - "source_artifact:pmid-32541484"
      - "source_artifact:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17"
      - "source_artifact:pmid-35606999"
      - "source_artifact:pmid-28891192"
      - "source_artifact:fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27"
    caveats:
      - "MAUDE reports, blue-mask recall/case records, and broader laser/light safety reviews cannot estimate incidence for red+NIR cosmetic masks; they support conservative guardrails."
  -
    claimId: "skin-pigment-photosensitivity-screening"
    type: "safety"
    text: "Screening should explicitly ask about pigment risk, melasma or post-inflammatory hyperpigmentation concerns, photosensitizing medications or conditions, active irritated skin, suspicious or unexplained lesions, active/recent cancer history, and recent cosmetic light/laser/IPL/filler/PDT procedures before unsupervised setup."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-20410914"
      - "source_artifact:pmid-24888214"
      - "source_artifact:pmid-33640513"
      - "source_artifact:pmid-30888626"
      - "source_artifact:pmid-33491908"
      - "source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24"
      - "source_artifact:cdc-sun-exposure-photosensitizing-medications-2025-04-23"
      - "source_artifact:pmid-36722207"
      - "source_artifact:bmla-laser-ipl-treatment-guidelines-2019-05-01"
      - "source_artifact:pmid-30506819"
      - "source_artifact:pmid-34575408"
    caveats:
      - "Many screening sources concern visible light, UV-associated photosensitivity, lasers, IPL, PDT, or medical procedures rather than LED-only red/NIR masks; this is conservative screening language."
  -
    claimId: "adjacent-variants-not-efficacy-proof"
    type: "evidence_scope"
    text: "Red-only, amber/yellow, blue/acne, neck/decollete, under-eye-only, handheld, large-panel, whole-body, post-procedure, PDT, laser/IPL, ophthalmology, transcranial, and intranasal PBM records should remain adjacent, safety, or exclusion context rather than direct efficacy proof for this facial red+NIR photoaging starter."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-36780572"
      - "source_artifact:pmid-39133416"
      - "source_artifact:pmid-39319750"
      - "source_artifact:pmid-33921839"
      - "source_artifact:pmid-24286286"
      - "source_artifact:pmid-37522497"
      - "source_artifact:pmid-41091280"
      - "source_artifact:pmid-28195844"
      - "source_artifact:pmid-29858421"
      - "source_artifact:pmid-20456545"
      - "source_artifact:pmid-27257391"
      - "source_artifact:clinicaltrials-nct04145999-photobiomodulation-prp-facial-rejuvenation-2019-10-31"
    caveats:
      - "Adjacent records may still inform outcome selection, anatomy-specific forks, safety screening, or non-claim context."
  -
    claimId: "onboarding-is-conditional"
    type: "design_guardrail"
    text: "Experiment onboarding is appropriate only as a gated planning flow for an adult facial/periocular red+NIR LED/IRED wrinkle or texture mask with identifiable device specs, eye protection, nonthermal/no-UV/no-blue boundaries, baseline photos, session logging, and conservative stop rules."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-39960921"
      - "source_artifact:pmid-32649063"
      - "source_artifact:doi-10.3390-cosmetics12010004"
      - "source_artifact:fda-currentbody-series-2-k250966-2025-06-25"
      - "source_artifact:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20"
      - "source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09"
      - "source_artifact:pmid-30044464"
      - "source_artifact:pmid-34575408"
    caveats:
      - "If device specs, eye protection, nonthermal comfort, or logging are unresolved, Murph should educate and defer rather than create an active run."
safety:
  cautionLevel: "moderate"
  avoidOrGetClinicianGuidance:
    - "Under 18; this is an adult cosmetic self-experiment, not a pediatric or ophthalmology protocol."
    - "Pregnancy, trying to become pregnant, breastfeeding, or lactation; no pregnancy/lactation-specific source was extracted."
    - "Retinal/macular disease, ocular albinism, retinitis pigmentosa, another known ocular abnormality, ocular photosensitivity, recent eye procedure, photosensitizing medication exposure, or any current visual symptom."
    - "No manufacturer-specified eye inserts, shields, or goggles available for every session, or protection that fits poorly, feels hot, causes irritation, or would need to be removed near the eyelids."
    - "Melasma, post-inflammatory hyperpigmentation concern, active pigment flare, Fitzpatrick IV-VI skin with pigment concern, photosensitivity condition, prior light-triggered reaction, or photosensitizing medication/topical exposure."
    - "Active sunburn, recent intense tanning, rash, infection, blistering, wound, healing skin, unexplained lesion, suspicious lesion, or active/recent cancer history."
    - "Recent laser, IPL, RF, microneedling, peel, filler, PRP, PDT/photosensitizer, or other cosmetic procedure in the target area."
    - "Unknown device model, unknown mode, blue/violet/acne/UV/PDT/heat mode, or device that feels hot or painful."
  stopIf:
    - "Tearing, distorted vision, temporary vision loss, persistent or recurrent afterimage, flashes, spots, floaters, blurry vision, eye pain, eye irritation, discomfort, or any new ocular or visual symptom during or after use."
    - "Eye inserts, shields, or goggles shift, fit poorly, feel hot, cause contact irritation/allergy, or cannot be used without removing them near the eyelids."
    - "Burning or stinging, itching, swelling or edema, vesicles, bullae, blistering, prolonged redness, pain, or new/worsening hyperpigmentation or melasma-like change."
    - "Any new, changing, bleeding, crusting, painful, suspicious, or undiagnosed lesion in the treatment area."
    - "A photosensitizing medication/topical is started or changed, a major skincare active is added, a cosmetic procedure occurs or is planned, or sunburn/recent intense tanning occurs."
    - "Damaged device parts, device malfunction, unexpected heat or hot spots, timer or auto-shutoff failure, unclear mode behavior, or any pressure to increase dose, frequency, closeness, or remove protection."
    - "The protocol encourages dose escalation, unsafe device modification, anxiety, or disregard for stop rules."
  notes:
    - "Direct home/facial mask studies generally reported favorable short-term tolerability, but adverse-event detail, ocular reporting, long-term follow-up, and population/device coverage are incomplete. [source_artifact:pmid-39960921; source_artifact:pmid-32649063; source_artifact:doi-10.3390-cosmetics12010004; source_artifact:pmid-31483941]"
    - "Eye, pigment, photosensitivity, procedure, and heat cautions are intentionally stronger than efficacy language because many safety sources are adjacent but high-consequence. [source_artifact:pmid-39122507; source_artifact:pmid-39335685; source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24; source_artifact:canada-risk-thermal-harm-energy-devices-2020-08-21]"
    - "This adult starter is not cleared for minors, pregnancy, lactation, active/recent cancer history, suspicious lesions, eye disease, active pigment disorders, photosensitizing medications, open/healing skin, or immediate post-procedure use."
researchLandscape:
  bottomLine: "Supportive but mixed: the closest facial/periocular red+NIR studies justify a cautious adult self-experiment with standardized photos and strong safety gates, but the evidence is heterogeneous and does not establish a universal device, dose, or promise of visible rejuvenation."
  confidenceLabel: "mixed"
  primaryClaim: "A fixed red+NIR facial/periocular LED mask routine can be tested for personal changes in standardized skin-photo and wrinkle/texture scores over weeks."
  mainCaveat: "Direct evidence is strongest for specific devices and regions, especially periocular/crow's-feet outcomes; adjacent wavelengths, body areas, and medical light protocols must not be pooled as direct proof."
  groups:
    -
      id: "direct-home-and-facial-red-nir"
      label: "Closest direct and attribution-limited facial red/NIR evidence"
      stance: "supports"
      summary: "The strongest direct home source is the 630/850 nm sham-controlled crow's-feet mask RCT; additional home/facial red+NIR or red-to-NIR studies report texture, elasticity, brightening, satisfaction, or image-analysis signals, but they include small split-face, uncontrolled/unclear-control, male-only, device-validation, deeper-NIR, and LED-plus-topical designs. Do not read this group as clean LED-only proof for all full-face photoaging outcomes."
      sourceKeys:
        - "source_artifact:doi-10.3390-cosmetics12010004"
        - "source_artifact:pmid-32649063"
        - "source_artifact:pmid-32716115"
        - "source_artifact:pmid-37418018"
        - "source_artifact:pmid-39439130"
        - "source_artifact:pmid-39960921"
      defaultOpen: true
    -
      id: "clinic-and-methods-context"
      label: "Clinic-supervised and methods context"
      stance: "context_only"
      summary: "Older clinic-supervised 633/830 nm studies and radiometry/methods papers support plausibility and implementation discipline, but they are not exact home-mask dose templates; mixed red-only clinical evidence is handled in the mixed/null group."
      sourceKeys:
        - "source_artifact:pmid-16414908"
        - "source_artifact:pmid-16989189"
        - "source_artifact:pmid-17566756"
        - "source_artifact:pmid-17760698"
        - "source_artifact:pmid-26964800"
        - "source_artifact:pmid-30044464"
        - "source_artifact:pmid-41032498"
    -
      id: "mixed-and-adjacent-outcomes"
      label: "Mixed or adjacent variants"
      stance: "mixed"
      summary: "Red-only, amber/yellow, periocular-only, under-eye, neck, large-area panel, handheld, multimodal, and red-only clinical studies can inform boundaries and outcome choice; several preserve null or mixed findings for blinded clinical scales, hydration/viscoelasticity, objective wrinkle scores, comparator superiority, or broadband red/NIR advantage."
      sourceKeys:
        - "source_artifact:pmid-15909229"
        - "source_artifact:pmid-24286286"
        - "source_artifact:pmid-28195844"
        - "source_artifact:pmid-36780572"
        - "source_artifact:pmid-39133416"
        - "source_artifact:pmid-39319750"
        - "source_artifact:pmid-40167796"
        - "source_artifact:pmid-41091280"
    -
      id: "safety-boundaries"
      label: "Eye, heat, pigment, medication, and procedure safety boundaries"
      stance: "safety_boundary"
      summary: "Safety evidence and regulatory context support required eye protection, nonthermal use, no blue/UV/acne/PDT modes, conservative photosensitivity and pigment screening, and stop rules for ocular symptoms, irritation, blistering, or pigment change."
      sourceKeys:
        - "source_artifact:aad-red-light-therapy-safety-2024-09-13"
        - "source_artifact:canada-risk-thermal-harm-energy-devices-2020-08-21"
        - "source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24"
        - "source_artifact:pmid-31483941"
        - "source_artifact:pmid-32541484"
        - "source_artifact:pmid-37533142"
        - "source_artifact:pmid-39122507"
        - "source_artifact:pmid-39335685"
        - "source_artifact:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17"
      defaultOpen: true
    -
      id: "excluded-protocol-families"
      label: "Excluded protocol families"
      stance: "context_only"
      summary: "PDT/photosensitizer, laser/IPL, post-procedure wound healing, acne, ophthalmology/myopia PBM, transcranial/intranasal PBM, infrared sauna, and whole-body panel records should be re-homed or used only as safety/context, not as direct cosmetic efficacy evidence."
      sourceKeys:
        - "source_artifact:clinicaltrials-nct04145999-photobiomodulation-prp-facial-rejuvenation-2019-10-31"
        - "source_artifact:pmid-20456545"
        - "source_artifact:pmid-27257391"
        - "source_artifact:pmid-29356026"
        - "source_artifact:pmid-34575408"
        - "source_artifact:pmid-36310510"
        - "source_artifact:pmid-40253006"
    -
      id: "alster-wanitphakdeedecha-2009-postfractional"
      label: "Alster Wanitphakdeedecha 2009 Postfractional"
      stance: "safety_boundary"
      summary: "590 nm LED reduced early postfractional-laser erythema, with effects largely limited to early recovery. The Alster Wanitphakdeedecha 2009 Postfractional group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-19397672"
    -
      id: "batch-001:clinicaltrials-nct04911140"
      label: "Batch 001 Clinicaltrials NCT04911140"
      stance: "context_only"
      summary: "Registry anchor for the facial LED mask frequency trial and its planned arms/outcomes. The Batch 001 Clinicaltrials NCT04911140 group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-nct04911140-led-mask-facial-rejuvenation-2021-06-02"
    -
      id: "batch-001:pmid-19146602"
      label: "Batch 001 PMID 19146602"
      stance: "supports"
      summary: "A handheld LED device study reported visible fine-line/wrinkle improvement in most participants after treatment. The Batch 001 PMID 19146602 group currently links one appraisal-backed source with adjacent variant scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-19146602"
    -
      id: "batch-001:pmid-36749255"
      label: "Batch 001 PMID 36749255"
      stance: "context_only"
      summary: "Protocol/design paper defines dosing arms, planned sample size, and outcomes for the later facial LED mask frequency trial. The Batch 001 PMID 36749255 group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-36749255"
    -
      id: "batch-002-adjacent_variant"
      label: "Batch 002 Adjacent Variant"
      stance: "mixed"
      summary: "A registry record describes a single-group iRestore face plus neck/chest LED mask study with daily 10-minute use and photo/questionnaire endpoints. A 1072 nm periocular light study reported self-identified improvements, but the wavelength and self-report design limit direct use. The Batch 002 Adjacent Variant group currently links 8 appraisal-backed sources with adjacent variant scope and not efficacy evidence, positive, negative interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-nct07025837-irestore-led-face-neck-chest-2024-09-06"
        - "source_artifact:pmid-17852628"
        - "source_artifact:pmid-19215260"
        - "source_artifact:pmid-19839877"
        - "source_artifact:pmid-27910259"
        - "source_artifact:pmid-32949447"
        - "source_artifact:pmid-33921839"
        - "source_artifact:pmid-37522497"
    -
      id: "batch-002-background"
      label: "Batch 002 Background"
      stance: "context_only"
      summary: "A ClinicalTrials.gov registry record describes a red/gold/IR LED combination intervention but provides no extracted outcome evidence for this batch. A protocol describes a planned red-versus-amber LED randomized trial for periorbital wrinkles, but it does not provide outcome data. The Batch 002 Background group currently links 2 appraisal-backed sources with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-nct04525573-2026-04-24"
        - "source_artifact:pmid-29858421"
    -
      id: "batch-002-clinical_supervised"
      label: "Batch 002 Clinical Supervised"
      stance: "supports"
      summary: "A clinic-supervised 590 nm LED photomodulation report described improvement in photoaging signs and no side effects in extracted summaries. A 590 nm LED study reported photoaging, profilometry, collagen I, and MMP-1 changes after repeated full-face exposure. The Batch 002 Clinical Supervised group currently links 4 appraisal-backed sources with clinical supervised scope and positive, not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-15624743"
        - "source_artifact:pmid-15654716"
        - "source_artifact:pmid-16176771"
        - "source_artifact:pmid-16414904"
    -
      id: "batch-002-same_mechanism"
      label: "Batch 002 Same Mechanism"
      stance: "context_only"
      summary: "An OLED study provides adjacent safety/mechanism context for skin rejuvenation and wound healing, not a direct red+NIR facial-mask trial. The Batch 002 Same Mechanism group currently links one appraisal-backed source with same mechanism scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-38288650"
    -
      id: "batch-006-pmid-19150294"
      label: "Batch 006 PMID 19150294"
      stance: "context_only"
      summary: "LED dermatology literature has long emphasized nonthermal PBM and device-parameter considerations. The Batch 006 PMID 19150294 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-19150294"
    -
      id: "batch-006-pmid-19587693"
      label: "Batch 006 PMID 19587693"
      stance: "context_only"
      summary: "Pulsed 660 nm LED exposure was associated with collagen-metabolism changes and clinical wrinkle/roughness improvement signals. The Batch 006 PMID 19587693 group currently links one appraisal-backed source with same mechanism scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-19587693"
    -
      id: "batch-006-pmid-20799848"
      label: "Batch 006 PMID 20799848"
      stance: "context_only"
      summary: "Pulsing parameters may change cellular responses to red light and should be reported. The Batch 006 PMID 20799848 group currently links one appraisal-backed source with general guideline scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-20799848"
    -
      id: "batch-006-pmid-22461763"
      label: "Batch 006 PMID 22461763"
      stance: "context_only"
      summary: "Low-level light therapy can show biphasic dose responses, so higher dose is not automatically superior. The Batch 006 PMID 22461763 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-22461763"
    -
      id: "batch-006-pmid-24049929"
      label: "Batch 006 PMID 24049929"
      stance: "context_only"
      summary: "Skin PBM mechanisms include mitochondrial and signaling effects, with broad dermatologic application claims. The Batch 006 PMID 24049929 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-24049929"
    -
      id: "batch-006-pmid-25705949"
      label: "Batch 006 PMID 25705949"
      stance: "context_only"
      summary: "Home-use light-device evidence is often modest and limited by small, short, uncontrolled, or industry-sponsored studies. The Batch 006 PMID 25705949 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-25705949"
    -
      id: "batch-006-pmid-26155326"
      label: "Batch 006 PMID 26155326"
      stance: "context_only"
      summary: "LED clinical experience and older studies show mixed context rather than definitive protocol evidence. The Batch 006 PMID 26155326 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-26155326"
    -
      id: "batch-006-pmid-28741866"
      label: "Batch 006 PMID 28741866"
      stance: "context_only"
      summary: "Home optical devices span IPL, LED, heat, infrared, and other technologies and require indication-specific appraisal. The Batch 006 PMID 28741866 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-28741866"
    -
      id: "batch-006-pmid-29552272"
      label: "Batch 006 PMID 29552272"
      stance: "context_only"
      summary: "LED phototherapy is reviewed across blue, red, and near-infrared dermatology applications. The Batch 006 PMID 29552272 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-29552272"
    -
      id: "batch-006-pmid-31345324"
      label: "Batch 006 PMID 31345324"
      stance: "context_only"
      summary: "Skin rejuvenation evidence spans many light technologies that should not be collapsed into red/NIR LED PBM. The Batch 006 PMID 31345324 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-31345324"
    -
      id: "batch-006-pmid-33471046"
      label: "Batch 006 PMID 33471046"
      stance: "context_only"
      summary: "Aesthetic PBM evidence is promising but methodologically limited and not always LED-specific. The Batch 006 PMID 33471046 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-33471046"
    -
      id: "batch-006-pmid-33594706"
      label: "Batch 006 PMID 33594706"
      stance: "context_only"
      summary: "Combined low-level 640 nm red and 830 nm near-infrared exposure increased collagen/elastin-related markers in laboratory skin models. The Batch 006 PMID 33594706 group currently links one appraisal-backed source with same mechanism scope and positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-33594706"
    -
      id: "batch-006-pmid-33938981"
      label: "Batch 006 PMID 33938981"
      stance: "context_only"
      summary: "Home dermatology devices require separate safety, efficacy, and usability appraisal from supervised clinical devices. The Batch 006 PMID 33938981 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-33938981"
    -
      id: "batch-006-pmid-37252792"
      label: "Batch 006 PMID 37252792"
      stance: "context_only"
      summary: "A commentary exists on a direct periocular wrinkle PBM RCT and should be checked before synthesizing that trial. The Batch 006 PMID 37252792 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-37252792"
    -
      id: "batch-006-pmid-38307144"
      label: "Batch 006 PMID 38307144"
      stance: "context_only"
      summary: "PBM is discussed as a dermatology tool across multiple indications, including skin rejuvenation, but standardized trials remain needed. The Batch 006 PMID 38307144 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-38307144"
    -
      id: "batch-006-pmid-38309304"
      label: "Batch 006 PMID 38309304"
      stance: "context_only"
      summary: "PBM mechanisms are parameter-dependent and involve mitochondrial and signaling pathways. The Batch 006 PMID 38309304 group currently links one appraisal-backed source with same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-38309304"
    -
      id: "batch-006-pmid-38476342"
      label: "Batch 006 PMID 38476342"
      stance: "context_only"
      summary: "Facial-rejuvenation home-device studies need evidence-based efficacy assessment and validated endpoints. The Batch 006 PMID 38476342 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-38476342"
    -
      id: "batch-006-pmid-38674067"
      label: "Batch 006 PMID 38674067"
      stance: "context_only"
      summary: "PBM skin literature spans mechanisms, dermatologic applications, and technology development. The Batch 006 PMID 38674067 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-38674067"
    -
      id: "batch-006-pmid-40751922"
      label: "Batch 006 PMID 40751922"
      stance: "context_only"
      summary: "Recent review frames LED as a promising cosmetic dermatology modality across multiple indications. The Batch 006 PMID 40751922 group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-40751922"
    -
      id: "batch003:doi-10.5318-wjo.v4.i1.1:ocular"
      label: "Batch003 Doi 10.5318 Wjo.v4.i1.1 Ocular"
      stance: "safety_boundary"
      summary: "Ocular damage secondary to lights and lasers: How to avoid and treat if necessary. The Batch003 Doi 10.5318 Wjo.v4.i1.1 Ocular group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:doi-10.5318/wjo.v4.i1.1"
    -
      id: "batch003:fda-currentbody-series-2-k250966-2025-06-25:ocular"
      label: "Batch003 FDA Currentbody Series 2 K250966 2025 06 25 Ocular"
      stance: "safety_boundary"
      summary: "510(k) Summary: CurrentBody Skin LED Light Therapy Mask Series 2, Model MK-90H. The Batch003 FDA Currentbody Series 2 K250966 2025 06 25 Ocular group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-currentbody-series-2-k250966-2025-06-25"
    -
      id: "batch003:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20:ocular"
      label: "Batch003 FDA K221775 Led Light Therapy Mask Eye Protection 2022 12 20 Ocular"
      stance: "safety_boundary"
      summary: "510(k) Summary: LED Light Therapy Mask, models MK-78, MK-04, MK66-H, MK66R-B, EL00003. The Batch003 FDA K221775 Led Light Therapy Mask Eye Protection 2022 12 20 Ocular group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20"
    -
      id: "batch003:fda-k230124-led-facewear-mask-eye-protection-2023-02-09:ocular"
      label: "Batch003 FDA K230124 Led Facewear Mask Eye Protection 2023 02 09 Ocular"
      stance: "safety_boundary"
      summary: "510(k) Summary: LUSTRE ClearSkin Renew Pro Facewear Mask. The Batch003 FDA K230124 Led Facewear Mask Eye Protection 2023 02 09 Ocular group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09"
    -
      id: "batch003:fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27:ocular"
      label: "Batch003 FDA K243040 Led Light Therapy Mask Eye Shield 2024 09 27 Ocular"
      stance: "safety_boundary"
      summary: "510(k) Summary: Shenzhen Siken LED Light Therapy Mask. The Batch003 FDA K243040 Led Light Therapy Mask Eye Shield 2024 09 27 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-k243040-led-light-therapy-mask-eye-shield-2024-09-27"
    -
      id: "batch003:pmid-25790150:ocular"
      label: "Batch003 PMID 25790150 Ocular"
      stance: "safety_boundary"
      summary: "Ocular adverse effects after facial cosmetic procedures: a review of case reports. The Batch003 PMID 25790150 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-25790150"
    -
      id: "batch003:pmid-28891192:ocular"
      label: "Batch003 PMID 28891192 Ocular"
      stance: "mixed"
      summary: "Light therapy: is it safe for the eyes? The Batch003 PMID 28891192 Ocular group currently links one appraisal-backed source with adjacent variant scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-28891192"
    -
      id: "batch003:pmid-29552271:ocular"
      label: "Batch003 PMID 29552271 Ocular"
      stance: "safety_boundary"
      summary: "Ocular Injury in Cosmetic Laser Treatments of the Face. The Batch003 PMID 29552271 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-29552271"
    -
      id: "batch003:pmid-32541484:ocular"
      label: "Batch003 PMID 32541484 Ocular"
      stance: "safety_boundary"
      summary: "Photochemical Retinopathy induced by blue light emitted from a light-emitting diode Face Mask: A case report and literature review. The Batch003 PMID 32541484 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-32541484"
    -
      id: "batch003:pmid-33390779:ocular"
      label: "Batch003 PMID 33390779 Ocular"
      stance: "context_only"
      summary: "Near Infrared (NIR) Light Therapy of Eye Diseases: A Review. The Batch003 PMID 33390779 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-33390779"
    -
      id: "batch003:pmid-33731574:ocular"
      label: "Batch003 PMID 33731574 Ocular"
      stance: "safety_boundary"
      summary: "Ocular Complications After Laser or Light-Based Therapy-Dangers Dermatologists Should Know. The Batch003 PMID 33731574 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-33731574"
    -
      id: "batch003:pmid-34863776:ocular"
      label: "Batch003 PMID 34863776 Ocular"
      stance: "safety_boundary"
      summary: "Effect of Repeated Low-Level Red-Light Therapy for Myopia Control in Children: A Multicenter Randomized Controlled Trial. The Batch003 PMID 34863776 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-34863776"
    -
      id: "batch003:pmid-35333214:ocular"
      label: "Batch003 PMID 35333214 Ocular"
      stance: "safety_boundary"
      summary: "Review of Eye Injuries Associated With Dermatologic Laser Treatment. The Batch003 PMID 35333214 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-35333214"
    -
      id: "batch003:pmid-35606999:ocular"
      label: "Batch003 PMID 35606999 Ocular"
      stance: "safety_boundary"
      summary: "ICNIRP Guidelines on Limits of Exposure to Incoherent Visible and Infrared Radiation. The Batch003 PMID 35606999 Ocular group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-35606999"
    -
      id: "batch003:pmid-37227712:ocular"
      label: "Batch003 PMID 37227712 Ocular"
      stance: "safety_boundary"
      summary: "Retinal Damage After Repeated Low-level Red-Light Laser Exposure. The Batch003 PMID 37227712 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-37227712"
    -
      id: "batch003:pmid-37533142:ocular"
      label: "Batch003 PMID 37533142 Ocular"
      stance: "safety_boundary"
      summary: "Preventing Eye Injuries From Light and Laser-Based Dermatologic Procedures: A Practical Review. The Batch003 PMID 37533142 Ocular group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-37533142"
    -
      id: "batch003:pmid-37858054:ocular"
      label: "Batch003 PMID 37858054 Ocular"
      stance: "safety_boundary"
      summary: "Dermatologic laser-induced ocular and periocular complications: a review. The Batch003 PMID 37858054 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-37858054"
    -
      id: "batch003:pmid-39122507:ocular"
      label: "Batch003 PMID 39122507 Ocular"
      stance: "safety_boundary"
      summary: "Keep an Eye on At-Home Devices: Energy-Based Acne and Anti-Aging Devices are Associated with Ocular Adverse Events in a Retrospective Analysis Using the MAUDE Database. The Batch003 PMID 39122507 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39122507"
    -
      id: "batch003:pmid-39211002:ocular"
      label: "Batch003 PMID 39211002 Ocular"
      stance: "context_only"
      summary: "Photobiomodulation use in ophthalmology - an overview of translational research from bench to bedside. The Batch003 PMID 39211002 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39211002"
    -
      id: "batch003:pmid-39335685:ocular"
      label: "Batch003 PMID 39335685 Ocular"
      stance: "safety_boundary"
      summary: "Ocular Complication in Facial Aesthetic Laser and Light Treatments: A Comprehensive Review. The Batch003 PMID 39335685 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39335685"
    -
      id: "batch003:pmid-39429338:ocular"
      label: "Batch003 PMID 39429338 Ocular"
      stance: "context_only"
      summary: "Photobiomodulation in Ophthalmology: A Comprehensive Review of Bench-to-Bedside Research and Clinical Integration. The Batch003 PMID 39429338 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39429338"
    -
      id: "batch003:pmid-39547340:ocular"
      label: "Batch003 PMID 39547340 Ocular"
      stance: "context_only"
      summary: "Correlation Between Repeated Low-Level Red Light-Induced Afterimage and Axial Changes in Myopia Control. The Batch003 PMID 39547340 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39547340"
    -
      id: "batch003:pmid-39672511:ocular"
      label: "Batch003 PMID 39672511 Ocular"
      stance: "mixed"
      summary: "Safety of repeated low-level red-light therapy for myopia: A systematic review. The Batch003 PMID 39672511 Ocular group currently links one appraisal-backed source with adjacent variant scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39672511"
    -
      id: "batch003:ranzco-red-light-nir-pbm-eye-position-statement-2020-11-01:ocular"
      label: "Batch003 RANZCO Red Light NIR PBM Eye Position Statement 2020 11 01 Ocular"
      stance: "context_only"
      summary: "RANZCO Position Statement: Impact of Red Light (photobiomodulation) near infrared light therapy (NIR). The Batch003 RANZCO Red Light NIR PBM Eye Position Statement 2020 11 01 Ocular group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:ranzco-red-light-nir-pbm-eye-position-statement-2020-11-01"
    -
      id: "batch003:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17:ocular"
      label: "Batch003 TGA Neutrogena Led Mask Eye Damage Recall 2019 07 17 Ocular"
      stance: "safety_boundary"
      summary: "Neutrogena Visibly Clear Light Therapy Acne Mask and Activator: potential for eye damage recall notice. The Batch003 TGA Neutrogena Led Mask Eye Damage Recall 2019 07 17 Ocular group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17"
    -
      id: "bmla-light-treatment-guideline-2019"
      label: "BMLA Light Treatment Guideline 2019"
      stance: "safety_boundary"
      summary: "BMLA guideline supports conservative boundaries for professional light-based treatments. The BMLA Light Treatment Guideline 2019 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:bmla-laser-ipl-treatment-guidelines-2019-05-01"
    -
      id: "consumer-red-light-safety"
      label: "Consumer Red Light Safety"
      stance: "safety_boundary"
      summary: "AAD guidance supports cautious red/NIR PBM use with dermatologist review for darker skin, photosensitive conditions, medications, and eye protection. The Consumer Red Light Safety group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:aad-red-light-therapy-safety-2024-09-13"
    -
      id: "correia-2021-pdt-review"
      label: "Correia 2021 PDT Review"
      stance: "safety_boundary"
      summary: "PDT depends on photosensitizer activation and reactive oxygen species, making it mechanistically distinct from PBM. The Correia 2021 PDT Review group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-34575408"
    -
      id: "fda-anti-wrinkle-light-2010"
      label: "FDA Anti Wrinkle Light 2010"
      stance: "context_only"
      summary: "Handheld periocular wrinkle device used 605, 630, 660, and 855 nm LEDs. The FDA Anti Wrinkle Light 2010 group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-anti-wrinkle-light-k092800-2010-01-15"
    -
      id: "fda-biophotas-celluma3-2017"
      label: "FDA Biophotas Celluma3 2017"
      stance: "context_only"
      summary: "Celluma3 regulatory summary gives panel-style red/NIR dose context for full-face wrinkles. The FDA Biophotas Celluma3 2017 group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-biophotas-celluma3-k171323-2017-09-01"
    -
      id: "fda-light-tree-mask-2022"
      label: "FDA Light Tree Mask 2022"
      stance: "context_only"
      summary: "Full-face OTC wrinkle mask uses red 630±5 nm and NIR 830 nm LEDs. The FDA Light Tree Mask 2022 group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-light-tree-led-mask-k221946-2022-11-22"
    -
      id: "fda-omnilux-new-u-2008"
      label: "FDA Omnilux New U 2008"
      stance: "context_only"
      summary: "Early OTC periorbital wrinkle device cleared with red and near-infrared LEDs. The FDA Omnilux New U 2008 group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-omnilux-new-u-k072459-2008-03-03"
    -
      id: "fda-wrinkle-retreat-pro-2025"
      label: "FDA Wrinkle Retreat Pro 2025"
      stance: "context_only"
      summary: "Recent OTC full-face wrinkle mask combines amber, red, deep-red, and NIR LEDs. The FDA Wrinkle Retreat Pro 2025 group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:fda-wrinkle-retreat-pro-k252983-2025-12-17"
    -
      id: "govuk-light-device-guidance-2015"
      label: "Govuk Light Device Guidance 2015"
      stance: "safety_boundary"
      summary: "Professional light-device guidance emphasizes controlled use, training, hazard assessment, and incident response. The Govuk Light Device Guidance 2015 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:govuk-laser-ipl-led-guidance-2015-09-01"
    -
      id: "infrared-skin-boundary"
      label: "Infrared Skin Boundary"
      stance: "safety_boundary"
      summary: "Infrared skin effects depend on wavelength, irradiance, dose, and heating context. Older infrared study suggested wrinkle/texture effects but did not improve hyperpigmented lesions. The Infrared Skin Boundary group currently links 2 appraisal-backed sources with general guideline, adjacent variant scope and not efficacy evidence, mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-16941737"
        - "source_artifact:pmid-26745730"
    -
      id: "khoury-goldman-2008-led-after-ipl"
      label: "Khoury Goldman 2008 Led After Ipl"
      stance: "safety_boundary"
      summary: "LED photomodulation may reduce erythema and discomfort after IPL, but this is an adjunctive procedure setting. The Khoury Goldman 2008 Led After Ipl group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-18254808"
    -
      id: "laser-ipl-medication-guidance"
      label: "Laser Ipl Medication Guidance"
      stance: "safety_boundary"
      summary: "Laser/IPL medication guidance cautions against rigid overinterpretation of photosensitizing-drug lists. BMLA guidance supports medication review while warning against overly rigid drug-light rules. The Laser Ipl Medication Guidance group currently links 2 appraisal-backed sources with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:bmla-drugs-and-lasers-ipls-2018-11-30"
        - "source_artifact:pmid-25192842"
    -
      id: "medication-photosensitivity"
      label: "Medication Photosensitivity"
      stance: "safety_boundary"
      summary: "Photosensitizing medications warrant screening before elective light exposure. Many drugs have reported photosensitizing potential, but evidence strength differs. The Medication Photosensitivity group currently links 6 appraisal-backed sources with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:cdc-sun-exposure-photosensitizing-medications-2025-04-23"
        - "source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24"
        - "source_artifact:pmid-21879777"
        - "source_artifact:pmid-30888626"
        - "source_artifact:pmid-33491908"
        - "source_artifact:pmid-34451820"
    -
      id: "melasma-pbm-adjacent"
      label: "Melasma PBM Adjacent"
      stance: "mixed"
      summary: "Small split-face melasma pilot suggested 940 nm pulsed PBM plus microdermabrasion reduced pigment versus control. Underpowered amber PBM versus tranexamic acid pilot found no clear MASI/PGA advantage. The Melasma PBM Adjacent group currently links 4 appraisal-backed sources with adjacent variant scope and positive, no clear advantage, mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-29657669"
        - "source_artifact:pmid-30227084"
        - "source_artifact:pmid-38018017"
        - "source_artifact:pmid-40650752"
    -
      id: "nct04145999-pbm-prp-facial-rejuvenation"
      label: "NCT04145999 PBM PRP Facial Rejuvenation"
      stance: "context_only"
      summary: "PBM combined with PRP is an adjunctive injectable protocol, not LED-only PBM. The NCT04145999 PBM PRP Facial Rejuvenation group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-nct04145999-photobiomodulation-prp-facial-rejuvenation-2019-10-31"
    -
      id: "nct07054710-cosmetic-light-mask"
      label: "NCT07054710 Cosmetic Light Mask"
      stance: "context_only"
      summary: "Recent registry record tests an at-home cosmetic LED mask over 12 weeks. The NCT07054710 Cosmetic Light Mask group currently links one appraisal-backed source with direct protocol scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-nct07054710-cosmetic-light-mask-2026-04-24"
    -
      id: "nikolis-2016-klox-led-gel"
      label: "Nikolis 2016 Klox Led Gel"
      stance: "context_only"
      summary: "KLOX gel plus LED is excluded because gel/light activation is not LED-only PBM. The Nikolis 2016 Klox Led Gel group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-27257391"
    -
      id: "oh-kim-2013-led-after-co2"
      label: "Oh Kim 2013 Led After Co2"
      stance: "safety_boundary"
      summary: "635 nm LED was associated with faster erythema resolution after fractional CO2 laser in a small pilot. The Oh Kim 2013 Led After Co2 group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-23551853"
    -
      id: "oncologic-safety"
      label: "Oncologic Safety"
      stance: "safety_boundary"
      summary: "Aesthetic PBM oncologic-safety review found no clinical signal of new or recurrent malignancy in available evidence. The Oncologic Safety group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-36722207"
    -
      id: "pih-pie-led-adjacent"
      label: "PIH PIE Led Adjacent"
      stance: "context_only"
      summary: "In a small induced PIE/PIH model, 830 nm LED showed therapeutic effects on erythema and melanin indices; 590 nm was more limited therapeutically. The PIH PIE Led Adjacent group currently links one appraisal-backed source with adjacent variant scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-39899363"
    -
      id: "red-led-safety-dose-escalation"
      label: "Red Led Safety Dose Escalation"
      stance: "safety_boundary"
      summary: "High-fluence red LED safety differed by skin phenotype, with dose-limiting reactions at very high fluences. The STARS 1 protocol established planned high-fluence red LED dose-escalation and adverse-event rules. The Red Led Safety Dose Escalation group currently links 3 appraisal-backed sources with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-27484782"
        - "source_artifact:pmid-30894210"
        - "source_artifact:pmid-31483941"
    -
      id: "red-led-safety-registry"
      label: "Red Led Safety Registry"
      stance: "safety_boundary"
      summary: "ClinicalTrials.gov registration anchors the high-fluence red LED healthy-adult safety study. The registry documents Fitzpatrick I-III high-fluence red LED safety testing. The Red Led Safety Registry group currently links 2 appraisal-backed sources with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrials-nct02630303-2026-04-24"
        - "source_artifact:clinicaltrials-nct03433222-2026-04-24"
    -
      id: "red-nir-optical-boundary"
      label: "Red NIR Optical Boundary"
      stance: "safety_boundary"
      summary: "Skin color, tissue thickness, wavelength, and dose altered red/NIR laser penetration and temperature behavior. The Red NIR Optical Boundary group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-29178437"
    -
      id: "retinoid-photosensitivity"
      label: "Retinoid Photosensitivity"
      stance: "safety_boundary"
      summary: "Controlled trials reported no tretinoin phototoxicity or photoallergy for a tested 0.05% gel formulation. Older retinoid photosensitivity evidence suggests rare or idiosyncratic reactions rather than a uniform retinoid rule. The Retinoid Photosensitivity group currently links 2 appraisal-backed sources with general guideline scope and not efficacy evidence, mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-19438994"
        - "source_artifact:pmid-3530309"
    -
      id: "sanclemente-2011-mal-red-light-photodamage"
      label: "Sanclemente 2011 Mal Red Light Photodamage"
      stance: "context_only"
      summary: "MAL plus red-light PDT is an exclusion anchor, despite facial photodamage outcomes. The Sanclemente 2011 Mal Red Light Photodamage group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-20456545"
    -
      id: "sensitive-skin-tolerability"
      label: "Sensitive Skin Tolerability"
      stance: "safety_boundary"
      summary: "Small uncontrolled pilot found red LED phototherapy tolerable for sensitive skin, with nickel-goggle allergy as a reported side effect. The Sensitive Skin Tolerability group currently links one appraisal-backed source with adjacent variant scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-32118019"
    -
      id: "thermal-device-safety"
      label: "Thermal Device Safety"
      stance: "safety_boundary"
      summary: "Regulatory notice flags >45°C surface skin temperature as unsafe without objective rationale and includes LEDs among covered energy devices. The Thermal Device Safety group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:canada-risk-thermal-harm-energy-devices-2020-08-21"
    -
      id: "trelles-allones-2006-post-blepharoplasty"
      label: "Trelles Allones 2006 Post Blepharoplasty"
      stance: "safety_boundary"
      summary: "Red LED appeared to speed periocular post-procedure healing, but the setting is not standalone rejuvenation. The Trelles Allones 2006 Post Blepharoplasty group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-16581685"
    -
      id: "trelles-allones-mayo-2006-post-resurfacing"
      label: "Trelles Allones Mayo 2006 Post Resurfacing"
      stance: "safety_boundary"
      summary: "Visible/NIR LED enhanced post-ablation healing, but did not show a clear standalone wrinkle endpoint advantage. The Trelles Allones Mayo 2006 Post Resurfacing group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:doi-10.1016-j.mla.2006.06.001"
    -
      id: "visible-light-photodermatology"
      label: "Visible Light Photodermatology"
      stance: "safety_boundary"
      summary: "Visible light has biologic skin effects, including pigmentation and erythema. Visible light can interact with skin differently by skin type, with pigmentary concerns in darker skin. The Visible Light Photodermatology group currently links 3 appraisal-backed sources with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-31922171"
        - "source_artifact:pmid-32289393"
        - "source_artifact:pmid-33640508"
    -
      id: "visible-light-photoprotection"
      label: "Visible Light Photoprotection"
      stance: "safety_boundary"
      summary: "Visible-light photoprotection differs from UV-only photoprotection and may matter for pigment-prone users. The Visible Light Photoprotection group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-33640513"
    -
      id: "visible-light-pigmentation"
      label: "Visible Light Pigmentation"
      stance: "safety_boundary"
      summary: "Visible light can induce sustained pigmentation in melanocompetent skin. Blue/violet visible light induced persistent pigmentation, whereas 630 nm red light did not in this wavelength-comparison study. The Visible Light Pigmentation group currently links 4 appraisal-backed sources with general guideline, same mechanism scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-20410914"
        - "source_artifact:pmid-23111621"
        - "source_artifact:pmid-24888214"
        - "source_artifact:pmid-26121474"
    -
      id: "wanitphakdeedecha-2019-post-ablative-erythema"
      label: "Wanitphakdeedecha 2019 Post Ablative Erythema"
      stance: "mixed"
      summary: "Post-resurfacing LED findings were mixed: split-face local comparisons were null, while group comparisons suggested lower erythema on some days. The Wanitphakdeedecha 2019 Post Ablative Erythema group currently links one appraisal-backed source with general guideline scope and mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-30074109"
    -
      id: "wong-2019-topical-pdt-guideline"
      label: "Wong 2019 Topical PDT Guideline"
      stance: "safety_boundary"
      summary: "Topical PDT guidance is relevant to photosensitizer exclusions, not PBM efficacy. The Wong 2019 Topical PDT Guideline group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-30506819"
    -
      id: "yoo-2015-led-after-filler"
      label: "Yoo 2015 Led After Filler"
      stance: "safety_boundary"
      summary: "635/830 nm LED was reported for filler injection-site reactions, but evidence details are limited. The Yoo 2015 Led After Filler group currently links one appraisal-backed source with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-25266806"
---

## Question this experiment answers

After a stable baseline photo workflow, does a **specified red-plus-near-infrared facial or periocular LED/IRED mask** produce a repeatable change in your own standardized skin-photo, periocular wrinkle, or texture score over a multi-week course?

## Simple version

Run a 56-day experiment:

- **14 baseline days** to lock photos, scoring, skincare, and confounder logging.
- **42 intervention days**.
- **5 sessions per week**.
- **10 minutes per session** using the device’s red/NIR wrinkle or texture mode.
- **30 target sessions**, with **24 sessions** as the minimum useful first read.
- **Eye inserts, shields, or goggles every session**.
- No blue, violet, acne, UV, PDT/photosensitizer, laser/IPL, RF, heat-seeking, or topical-activation mode during the run.

The protocol is intentionally narrow. The closest and near-direct evidence is supportive for facial or periocular red/NIR LED devices, but it is heterogeneous by device, wavelength, comparator, schedule, treatment area, population, and outcome method, and it includes attribution-limited sources. [source_artifact:pmid-39960921; source_artifact:pmid-32649063; source_artifact:doi-10.3390-cosmetics12010004; source_artifact:pmid-16414908; source_artifact:pmid-17566756; source_artifact:pmid-17760698]

## Why this version

The best direct fit is not “red light” in general. It is a **known device and mode** delivering red light around 630-660 nm plus near-infrared around 830-855 nm to a defined facial or periocular region, with outcomes judged after repeated sessions over weeks. The direct studies and regulatory summaries are useful enough for a cautious personal experiment, but they do not prove an optimized universal dose. [source_artifact:pmid-39960921; source_artifact:pmid-32649063; source_artifact:fda-currentbody-series-2-k250966-2025-06-25; source_artifact:fda-k221775-led-light-therapy-mask-eye-protection-2022-12-20; source_artifact:pmid-41032498]

This page uses 10 minutes, five times weekly, for six intervention weeks as a conservative starter because that exact schedule appears in a direct red/NIR mask 510(k) device-configuration summary; it is not an optimized clinical dose and should defer to a more conservative selected-device label. Do not escalate duration, frequency, or closeness to chase faster results; PBM dosing is parameter-dependent, a red-only facial-mask frequency trial did not show a simple more-is-better pattern, and high-fluence red-LED safety data do not justify home dose escalation. [source_artifact:fda-currentbody-series-2-k250966-2025-06-25; source_artifact:pmid-40167796; source_artifact:pmid-22461763; source_artifact:pmid-31483941; source_artifact:pmid-41032498]

## What counts as a signal

Primary signal:

- change in **standardized skin photo score** versus the 14-day baseline workflow.

Secondary signals:

- periocular or crow’s-feet wrinkle score when that region is treated,
- texture or roughness score,
- satisfaction or skin-feel rating, analyzed separately from photos,
- skin and eye tolerability symptoms.

Use week 4 as an early adherence, safety, and photo-workflow check and week 6 as the first read for this fixed starter, not as a definitive efficacy endpoint. Direct and adjacent sources reported outcomes across 4 weeks, 6-8 weeks, 8-12 weeks, and 12-16 weeks; a longer 8-to-16-week fork may be reasonable for specific device labels or periocular endpoints when user burden and safety gates allow it. [source_artifact:doi-10.3390-cosmetics12010004; source_artifact:pmid-32649063; source_artifact:pmid-39960921; source_artifact:pmid-16414908; source_artifact:pmid-17566756]

## Setup gates before Murph creates a run

Murph should not create an active run until all of these are true:

1. The user is an adult and is not pregnant, trying to become pregnant, breastfeeding, or lactating without clinician guidance.
2. The exact device model is known.
3. The user can identify a red/NIR wrinkle or texture mode.
4. The treatment area is predefined and limited to a face/periocular variant.
5. Eye protection is available, fits, and will be used every session.
6. The device is nonthermal in use and does not require blue, UV, PDT, or heat-seeking modes for this run.
7. The user has a baseline photo workflow and a session-log path.
8. Safety screening does not produce an unresolved eye, pigment, photosensitivity, active-skin, suspicious-lesion, cancer-history, recent-procedure, medication, or topical concern.

These gates come from the direct home-mask evidence, device-parameter context, methods limitations, and safety sources; they are not claims that every consumer device is safe or effective. [source_artifact:pmid-39960921; source_artifact:pmid-32649063; source_artifact:fda-k230124-led-facewear-mask-eye-protection-2023-02-09; source_artifact:pmid-39122507; source_artifact:pmid-41032498]

## What not to conclude

Do not conclude that:

- any red-light panel, bed, bulb, or sauna is equivalent to a facial red/NIR LED mask;
- periocular crow’s-feet improvement proves whole-face rejuvenation;
- FDA 510(k) parameter summaries prove clinical efficacy or an optimal schedule;
- red-only, amber/yellow, blue/acne, neck, under-eye-only, whole-body, laser/IPL, PDT, ophthalmology, transcranial, or intranasal PBM evidence directly supports this protocol;
- a first-session glow, warmth, or satisfaction rating is the endpoint.

Adjacent and excluded records are still useful for boundaries, safety, and future sibling protocols, but they should not be pooled into this red+NIR facial photoaging claim. [source_artifact:pmid-36780572; source_artifact:pmid-39133416; source_artifact:pmid-39319750; source_artifact:pmid-24286286; source_artifact:pmid-20456545; source_artifact:pmid-27257391]

Mixed and null findings should shape expectations. A small Omnilux Revive facial LED study reported visible/photo responses but no statistically significant objective hydration or elasticity improvement; a 660 nm red-only mask trial found no significant blinded Wrinkle Assessment Scale group difference despite ImageJ and satisfaction signals and no clear two-versus-three-session frequency advantage; other adjacent studies report null hydration/viscoelasticity, non-significant objective wrinkle-score, no clear red-over-white advantage, or no clear broadband red/NIR advantage over red-only. Treat these as calibration for endpoint choice, not as direct disproof of the closest red+NIR home-mask findings. [source_artifact:pmid-15909229; source_artifact:pmid-40167796; source_artifact:pmid-36780572; source_artifact:pmid-39133416; source_artifact:pmid-28195844; source_artifact:pmid-24286286]

## Safety emphasis

Eye protection is non-negotiable. Use the manufacturer-specified inserts, shields, or goggles, do not stare at active LEDs, and stop for any eye discomfort or visual symptom. Ocular adverse-event reports, broader facial light-device safety reviews, blue-mask safety records, and regulatory mask summaries support conservative eye-protection language even though they do not estimate red/NIR mask incidence. [source_artifact:pmid-39122507; source_artifact:pmid-39335685; source_artifact:pmid-37533142; source_artifact:pmid-32541484; source_artifact:tga-neutrogena-led-mask-eye-damage-recall-2019-07-17]

Also screen conservatively for pigment concerns, photosensitizing medications or conditions, active irritation, suspicious or changing lesions, active/recent cancer history, pregnancy/lactation evidence gaps, recent cosmetic procedures, and PDT/photosensitizer exposure. Many of these sources are adjacent to LED-only red/NIR masks, so the right conclusion is not “red/NIR is proven harmful”; it is “do not turn unresolved higher-risk context into an unsupervised self-experiment.” [source_artifact:dermnet-drug-induced-photosensitivity-2026-04-24; source_artifact:cdc-sun-exposure-photosensitizing-medications-2025-04-23; source_artifact:pmid-20410914; source_artifact:pmid-24888214; source_artifact:pmid-30506819; source_artifact:pmid-34575408; source_artifact:pmid-36722207]

## Off-ramp

At the end of the first read, choose the plainest interpretation:

1. **Worth repeating or extending** if standardized photos or pre-specified scores improved, adherence was adequate, safety logs were clean, and confounders were stable.
2. **Probably noise** if only satisfaction changed, lighting or skincare changed, adherence was low, or the signal appears in only one checkpoint.
3. **Not worth it** if eye protection is burdensome, symptoms appear, pigment worsens, photos are uninterpretable, or the routine creates anxiety or unsafe dose escalation.
