---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
slug: protocols/iliotibial-band-syndrome-rehabilitation/it-band-syndrome-rehab-and-return-to-run
title: IT Band Rehab
summary: Hip and glute strengthening with graded run/walk re-entry, where stronger lateral-hip control reduces the load the iliotibial band puts on the outer knee at each stride.
status: draft
quality: usable
aliases:
- IT band syndrome rehab
- ITBS rehab
- iliotibial band syndrome rehabilitation
- iliotibial band friction syndrome rehab
- ITB friction syndrome conservative treatment
- return to running after ITBS
- return to run after IT band syndrome
- hip abductor strengthening for ITBS
- glute strengthening for ITBS
- gait retraining for ITBS
- step-rate retraining for ITBS
categories:
- rehab
- running
- injury-rehab
- lateral-knee-pain
- load-management
- strength-training
- murph-canonical
relations:
- type: parent_family
  target: experiment_family:iliotibial-band-syndrome-rehabilitation
- type: primary_biomarker
  target: biomarker:lateral-knee-pain
- type: secondary_biomarker
  target: biomarker:running-tolerance
- type: cites
  target: source_artifact:pmid-20145781
- type: cites
  target: source_artifact:pmid-22994651
- type: cites
  target: source_artifact:pmid-24226623
- type: cites
  target: source_artifact:pmid-24790783
- type: cites
  target: source_artifact:pmid-32448384
- type: cites
  target: source_artifact:pmid-34375405
- type: cites
  target: source_artifact:pmid-37300970
- type: cites
  target: source_artifact:pmid-39247485
- type: cites
  target: source_artifact:pmid-39593548
- type: cites
  target: source_artifact:massgeneral-itbs-rehab-protocol-2021-11-01
- type: cites
  target: source_artifact:massgeneral-return-to-running-program-2026-04-24
- type: cites
  target: source_artifact:osu-basic-return-to-running-guideline-2019-10-01
- type: cites
  target: source_artifact:brighamandwomens-itbs-standard-of-care-2007-01-01
- type: cites
  target: source_artifact:brighamandwomens-running-injury-prevention-return-to-running-2007-01-01
- type: cites
  target: source_artifact:pmid-17134904
- type: cites
  target: source_artifact:pmid-17728030
- type: cites
  target: source_artifact:pmid-23954385
- type: cites
  target: source_artifact:pmid-26573859
- type: cites
  target: source_artifact:pmid-36758425
- type: cites
  target: source_artifact:pmid-38618688
- type: cites
  target: source_artifact:pmid-14530229
- type: cites
  target: source_artifact:pmid-14734335
- type: cites
  target: source_artifact:pmid-19147613
- type: cites
  target: source_artifact:pmid-22134205
- type: cites
  target: source_artifact:pmid-23015995
- type: cites
  target: source_artifact:pmid-23821708
- type: cites
  target: source_artifact:pmid-30325638
- type: cites
  target: source_artifact:pmid-31194342
- type: cites
  target: source_artifact:pmid-32222797
- type: cites
  target: source_artifact:pmid-32370956
- type: cites
  target: source_artifact:pmid-15155424
- type: cites
  target: source_artifact:pmid-20836867
- type: cites
  target: source_artifact:pmid-32875305
- type: cites
  target: source_artifact:pmid-40015722
- type: cites
  target: source_artifact:pmid-8129101
- type: cites
  target: source_artifact:pmid-8166785
- type: cites
  target: source_artifact:pmid-33344012
- type: cites
  target: source_artifact:pmid-39304615
- type: cites
  target: source_artifact:aaos-orthoinfo-it-band-syndrome-2026-04-24
- type: cites
  target: source_artifact:aapmr-iliotibial-band-syndrome-2024-08-22
- type: cites
  target: source_artifact:choosept-it-band-syndrome-guide-2026-04-24
- type: cites
  target: source_artifact:hss-it-band-syndrome-2022-06-20
- type: cites
  target: source_artifact:dartmouth-hitchcock-it-band-exercises-2020-12-01
- type: cites
  target: source_artifact:pmid-2028354
- type: cites
  target: source_artifact:doi-10-1016-s0031-9406-10-61197-2
- type: cites
  target: source_artifact:doi-10-1080-15438629509512030
- type: cites
  target: source_artifact:pmid-26406193
- type: cites
  target: source_artifact:pmid-34123517
- type: cites
  target: source_artifact:pmid-35855103
- type: cites
  target: source_artifact:pmid-41167567
- type: cites
  target: source_artifact:clinicaltrials-nct02296151-2026-04-24
- type: cites
  target: source_artifact:clinicaltrials-nct03067545-2026-04-24
- type: cites
  target: source_artifact:clinicaltrials-nct05915754-2026-04-24
- type: cites
  target: source_artifact:clinicaltrials-nct05973708-2026-04-24
- type: cites
  target: source_artifact:clinicaltrials-nct06131658-2026-04-24
- type: cites
  target: source_artifact:clinicaltrials-nct06269757-2026-04-24
- type: cites
  target: source_artifact:pmid-39219463
lineage:
  relationship: root
  rationale: Murph canonical starter protocol for conservative, symptom-guided ITBS rehab and return-to-run tracking; external institutional protocols stay as context sources, not forks.
attribution:
  ownerType: murph
  note: Drafted from the ITBS Health Commons research run using the canonical source ledger and normalized local fallback source drafts. Full-text sample sizes, effect sizes, adverse-event rates, and exact source-level results were not added unless present in the supplied inputs.
media:
- kind: image
  relativePath: design-assets/hero-it-band-rehab.jpeg
  mediaType: image/jpeg
protocol:
  doseSignature: 6 weeks · 3 strength/control sessions per week · 2–3 run/walk re-entry sessions when symptoms allow · progress only with mild lateral-knee pain and no next-day rebound
  target: symptom-guided return to running after suspected or clinician-diagnosed ITBS
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 20
    max: 45
  sessionShape:
    label: One session
    segments:
    - label: rehab session
      kind: stimulus
      durationMinutes: 45
    ticks:
    - label: "0"
      offsetMinutes: 0
    - label: "20 min minimum"
      offsetMinutes: 20
    - label: "45 min"
      offsetMinutes: 45
  interventionSessionsMinimum: 12
  interventionSessionsTarget: 18
  steps:
    - "Screen first; do not start after trauma, locking, major swelling, unsafe weight bearing, fever, neurologic symptoms, bony pain, or unclear diagnosis."
    - "Baseline 7 days: log lateral knee pain, walking/stair symptoms, running load, terrain, hills, shoes, and cross-training."
    - "Reduce running until daily activity pain stays mild; use walking or low-irritation cross-training when running escalates pain."
    - "Complete 3 weekly strength/control sessions focused on hip abductors, glutes, external rotators, trunk, and single-leg control."
    - "Start run/walk only after walking, current rehab phase, and lateral-knee palpation are pain-free."
    - "Use short flat alternate-day run/walk intervals; avoid hills, camber, speed work, long strides, and mileage jumps."
    - "Stop if pain sharpens, rises above ceiling, changes gait, appears at rest, rebounds next day, or comes with red flags."
    - "Progress 1 variable at a time; keep strength work until easy running is consistently tolerated."
  tips:
  - "Baseline 7 days: log pain location, onset minute, stairs, walking, route, hills, shoes, pace, and mileage."
  - "Set pain ceiling before running; sharp pain, limping, or next-morning rebound ends progression."
  - "Start on flat, predictable routes in stable shoes; avoid hills, camber, speedwork, and long strides."
  - "Do hip, glute, external-rotator, trunk, and single-leg control work before mileage jumps."
  - "Do not stack new shoes, aggressive rolling, NSAID masking, injections, shockwave, or another knee protocol."
  - "Judge recovery by repeated pain-free runs plus next-day tolerance, not one good run."
  keepInMind:
  - The evidence supports active conservative components more than it validates one exact dose schedule or one guaranteed return-to-run timeline.
  - Runner ITBS rehab is the core protocol. Cycling-specific bike-fit and return-to-cycling evidence is adjacent and should not be merged into this runner protocol.
  - Biomechanics and hip-strength sources explain plausible targets, but they do not prove that one isolated correction fixes ITBS for everyone.
  - External named protocols help with implementation but are not Murph canonical efficacy evidence.
  - Medication, corticosteroid injection, shockwave or dry-needling modalities, manual or passive soft-tissue care, and surgery are clinician-directed escalation, adjacent treatment, or confounder pathways, not self-experiment steps.
  logFields:
  - pain location and onset pattern
  - onset mile or minute during run
  - lateral knee pain before session
  - peak lateral knee pain during session
  - pain after session
  - next-day pain
  - walking and stair tolerance
  - swelling, warmth, redness, locking, catching, buckling, numbness, weakness, rest pain, or night pain
  - clinician or physical-therapist ITBS confirmation status
  - run/walk minutes
  - run/walk interval pattern
  - weekly mileage and recent mileage jump
  - long-run distance
  - route surface, hills, downhill, or camber
  - pace, speedwork, or intensity
  - shoe model, shoe age, recent shoe change, orthotics, or terrain
  - strength/control exercise names, sets, reps, load, side-to-side differences, RPE, and pain response
  - gait cue used
  - cross-training or cycling exposure
  - sleep, fatigue, illness, and competing training load
  - stop-condition event
  - stretching, foam rolling, manual therapy, shockwave, dry needling, medication, injection, or other treatment change
  sessionFieldIds:
  - pain_location_and_onset_pattern
  - onset_mile_or_minute
  - lateral_knee_pain_before
  - peak_lateral_knee_pain
  - pain_after_session
  - next_day_pain
  - walking_and_stair_tolerance
  - red_flag_or_mimic_symptoms
  - run_walk_minutes
  - interval_pattern
  - strength_control_completed
  - exercise_sets_reps_load_rpe_pain_response
  - gait_cue_used
  - stop_condition_event
  stopConditions:
  - Do not start, or stop and seek appropriate care, after acute trauma, sudden swelling, deformity, a pop at injury, inability to bear weight, severe pain, a locked knee, major swelling, fever, hot/red/warm joint, major loss of motion, neurologic symptoms, focal bony pain, rest/night pain, or rapidly worsening pain.
  - Do not use this page as a self-diagnosis protocol for locking, catching, true giving-way, recurrent swelling, adolescent knee pain with hip pain, suspected stress fracture, suspected meniscal/ligament/cartilage injury, patellofemoral mimic, or unclear knee/hip/spine pain.
  - Stop the run or exercise immediately if lateral knee pain becomes sharp, rapidly worsens, rises above the agreed ceiling, changes gait, causes limping, appears at rest, spreads beyond the expected lateral-knee pattern, or comes with swelling, warmth, redness, locking, catching, buckling, numbness, weakness, or inability to bear weight.
  - If symptoms are worse later the same day or the next morning, do not progress; return to the last pain-free phase and reduce running load.
  - End the experiment and route to clinical review if symptoms worsen despite reducing running, persistently block ordinary walking or stairs, repeatedly recur whenever running resumes, or remain diagnostically unclear.
  - Do not use NSAIDs, acetaminophen, corticosteroid injection, or other pain-relieving treatment to pass a run-readiness test.
testPlans:
- planId: symptom-guided-return-to-run-49d
  durationDays: 49
  baselineDays: 7
  interventionDays: 42
  primaryBiomarkerKey: biomarker:lateral-knee-pain
  secondaryBiomarkerKeys:
  - biomarker:running-tolerance
  minimumAdherenceSessions: 12
  targetAdherenceSessions: 18
  notes:
  - Use manual symptom and function tracking as the primary readout; no extracted evidence supports a standalone wearable biomarker for ITBS recovery.
  - Compare the 6-week intervention against the user’s own 7-day baseline and inspect trend stability, not a single run.
  - 'Running load is both the exposure and a confounder: keep route, hills, pace, shoes, and cross-training visible.'
  - Rehab completion and running exposure support interpretation; they are not outcome wins.
  - Treat the test as conservative self-management for appropriate users, not diagnostic triage or a cure claim.
expectedSignalDescriptions:
- biomarkerKey: biomarker:lateral-knee-pain
  expected: Less run pain
  expectedDirection: down
  description: Reducing provocative running lowers lateral-knee irritation; hip/glute control gives each stride more capacity before pain escalates.
  estimatedChange:
    kind: absolute
    low: -4
    high: -1
    unit: points
    window: after 6 weeks
    confidence: low
    basis: Runner ITBS studies report pain reductions over 2–8 weeks, with a 2024 review summarizing 27–100% reductions across heterogeneous conservative treatments. This range converts to a practical 1–4 point drop on a 0–10 pain log for moderate starting pain.
  protocolProminence: focus
- biomarkerKey: biomarker:running-tolerance
  expected: More pain-free minutes
  expectedDirection: up
  description: Short, flat run/walk intervals reload the knee in small steps, rebuilding repeated-stride tolerance without rebound.
  estimatedChange:
    kind: absolute
    low: 10
    high: 45
    unit: minutes
    window: after 6 weeks
    confidence: low
    basis: Direct runner rehab sources use pain-free running, function, and graded return-to-run tolerance as endpoints; case evidence reaches pain-free running within 4–6 weeks, while starting branch and deload size determine the minute gain.
  protocolProminence: focus
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to explore an IT band syndrome rehab and return-to-run plan."
    intentSummary: "Explore ITBS Rehab And Return To Run"
  safetyScreen:
    dispositionIfAnyPositive: "do_not_start_unsupervised"
    mustAsk:
      - id: "acute_trauma_or_pop"
        prompt: "Did this knee pain begin after a fall, collision, twist, sudden pop, or other acute traumatic event?"
        ifPositive: "do_not_start_unsupervised"
      - id: "bear_weight_locked_swollen"
        prompt: "Do you have inability to bear weight, a locked knee, major swelling, marked instability, or major loss of knee motion?"
        ifPositive: "do_not_start_unsupervised"
      - id: "infection_or_systemic_signs"
        prompt: "Do you have fever, a hot or red joint, spreading redness, systemic illness, or severe unexplained night/rest pain?"
        ifPositive: "do_not_start_unsupervised"
      - id: "neurologic_or_spreading_symptoms"
        prompt: "Do you have new numbness, weakness, progressive neurologic symptoms, or pain spreading in a pattern that is not lateral knee pain during running?"
        ifPositive: "do_not_start_unsupervised"
      - id: "worsening_despite_deload"
        prompt: "Has pain kept worsening even after reducing running or avoiding the activities that trigger it?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "mechanical_focal_or_mimic_features"
        prompt: "Do you have true locking, catching, buckling/giving way, recurrent swelling, rest or night pain, focal bony tenderness, hip/back pain, anterior-knee symptoms, or anything that makes this feel unlike typical lateral running-related ITBS pain?"
        ifPositive: "do_not_start_unsupervised"
      - id: "separate_clinical_variant_needed"
        prompt: "Are you pregnant or postpartum, an adolescent, post-surgical, managing inflammatory arthritis/gout/significant osteoarthritis, a cyclist with bike-fit-driven symptoms, or currently planning medication, injection, shockwave, dry needling, manual therapy, imaging-driven care, or surgery for this knee?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
    stopIf:
      additionalConditions:
        - "Pain changes gait or causes limping"
        - "Pain appears at rest, persists after the session, or rebounds later that day or the next morning"
        - "Symptoms spread beyond expected lateral-knee pattern"
        - "Swelling, warmth, redness, fever, buckling, true locking, catching, inability to bear weight, numbness, weakness, or major motion loss appears"
        - "User adds medication, injection, shockwave, dry needling, manual therapy, surgery planning, or another major treatment"
  setupSlots:
    - id: "symptom_pattern"
      label: "Symptom pattern"
      question: "Briefly describe where the knee pain is, when it appears during running, and what makes it settle."
      writePath: "onboarding.answers.symptomPattern"
    - id: "pain_ceiling"
      label: "Pain ceiling"
      question: "What pain ceiling should stop a run session? Use a 0 to 10 scale, with 0 as no pain and 10 as worst pain."
      constraints:
        min: 0
        max: 10
        recommendedMax: 3
      writePath: "runPlan.painCeiling"
    - id: "starting_branch"
      label: "Starting branch"
      question: "Where should the plan start: no running yet, short run/walk re-entry, or already tolerating easy runs?"
      options:
        - "no_running_yet"
        - "run_walk_reentry"
        - "easy_runs_tolerated"
      writePath: "runPlan.startingBranch"
    - id: "rehab_days"
      label: "Rehab days"
      question: "Which three weekly windows are realistic for strength and control sessions?"
      writePath: "runPlan.rehabDays"
    - id: "run_walk_windows"
      label: "Run/walk windows"
      question: "Which two or three weekly windows could hold easy run/walk sessions once symptoms allow?"
      constraints:
        optional: true
      writePath: "runPlan.runWalkWindows"
    - id: "route_controls"
      label: "Route controls"
      question: "What flat, predictable route or surface can you use early, and are there hills, camber, or speed-work triggers to avoid?"
      constraints:
        optional: true
      writePath: "runPlan.routeControls"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Do you want rehab/run reminders and a next-day symptom check if no log appears?"
      options:
        - "none"
        - "session_reminders"
        - "session_reminders_plus_next_day_check"
      constraints:
        askWhen: "at_confirmation"
      writePath: "assistantSupport.reminderPolicy"
  planDefaults:
    testPlanId: "symptom-guided-return-to-run-49d"
    firstSessionGuidance: "Start with screening, baseline logging, and a low-irritation strength/control session. Do not force a run on day one if walking or stairs are still provocative."
  trackingHints:
    confounderFields:
      - "route_surface_hills_downhill_camber"
      - "pace_speedwork_or_intensity"
      - "weekly_mileage_long_run_and_recent_mileage_jump"
      - "shoe_age_model_orthotics_or_equipment_change"
      - "cross_training_or_cycling_exposure"
      - "sleep_fatigue_illness_or_competing_training_load"
      - "new_nsaid_acetaminophen_or_other_pain_medication"
      - "injection_shockwave_dry_needling_manual_therapy_or_other_treatment"
    notes:
      - "Symptoms and function are primary; wearable activity data is context."
      - "Next-day pain is part of session interpretation, not an optional extra."
  supportHints:
    missedLogFollowupCopy: "Did knee pain stay mild after the last rehab or run/walk session, and how did it feel the next morning?"
whyItWorks:
  - "## Irritation drops before capacity returns\n\nITBS rehab starts by reducing the running dose that keeps the lateral knee irritated. Pain falls when the tissue stops getting the same provocative stride load."
  - "## Hip control changes the stride\n\nGlute and hip-abductor work improves pelvis and femur control. Better lateral-hip control reduces how much load each stride dumps into the outer knee."
  - "## Run/walk rebuilds tolerance\n\nShort flat intervals reload the knee in small steps. Progress means more pain-free minutes with no same-day or next-morning rebound."
mechanismChain:
  -
    label: "Session"
    content: "3x/week hip and glute work · graded run/walk"
  -
    label: "Deload"
    content: "Provocative running drops; lateral knee irritation settles"
  -
    label: "Repeated signal"
    content: "Single-leg control · hip strength · easy strides repeat"
  -
    label: "Adaptation"
    content: "Better pelvic control · less lateral knee load · longer pain-free running"
claims:

- claimId: active-rehab-components-not-standardized
  type: evidence_scope
  text: Direct runner rehab and review sources support a cautious active-rehab rationale that includes reducing provocative running, hip/glute or neuromuscular-control work, optional gait work, and graded return-to-run tracking; external protocols provide implementation context. The supplied evidence does not establish one standardized dose protocol, guaranteed return-to-run timeline, or single best exercise recipe.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-20145781
  - source_artifact:pmid-22994651
  - source_artifact:pmid-24226623
  - source_artifact:pmid-24790783
  - source_artifact:pmid-32448384
  - source_artifact:pmid-34375405
  - source_artifact:pmid-37300970
  - source_artifact:pmid-39247485
  - source_artifact:pmid-39593548
  - source_artifact:massgeneral-itbs-rehab-protocol-2021-11-01
  - source_artifact:massgeneral-return-to-running-program-2026-04-24
  - source_artifact:osu-basic-return-to-running-guideline-2019-10-01
  - source_artifact:brighamandwomens-itbs-standard-of-care-2007-01-01
  caveats:
  - Evidence is heterogeneous and includes case reports, reviews, external protocols, and pilot or supervised clinical work.
  - External protocols are context-only implementation templates, not efficacy proof.

- claimId: pain-guided-progression-over-mileage-promises
  type: design_guardrail
  text: A practical Murph protocol should begin return-to-run only after walking, the current rehab phase, and lateral-knee palpation are pain-free, then use flat alternate-day run/walk exposure, next-day symptom checks, and reset rules rather than promising a fixed weekly mileage progression or universal return-to-run timeline.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-31194342
  - source_artifact:pmid-32448384
  - source_artifact:pmid-34375405
  - source_artifact:massgeneral-itbs-rehab-protocol-2021-11-01
  - source_artifact:massgeneral-return-to-running-program-2026-04-24
  - source_artifact:osu-basic-return-to-running-guideline-2019-10-01
  caveats:
  - External return-to-run templates are implementation context, not proof of efficacy.
  - Numeric pain caps are Murph safety heuristics unless a later ITBS-specific pain-monitoring source is extracted.
- claimId: outcomes-are-symptom-and-function-based
  type: evidence_scope
  text: 'The practical outcome set for self-guided runner ITBS rehab is symptom and function based: lateral knee pain, pain-free run/walk duration, return-to-run tolerance, and stop-condition events. Running exposure and rehab completion support attribution; they are not outcome wins.'
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-20145781
  - source_artifact:pmid-24226623
  - source_artifact:pmid-24790783
  - source_artifact:pmid-32448384
  - source_artifact:pmid-39247485
  - source_artifact:pmid-39593548
  caveats:
  - The fallback extraction does not support precise MCID, effect-size, or recurrence claims.
- claimId: no-standalone-wearable-biomarker
  type: evidence_scope
  text: No supplied extraction supports a standalone wearable biomarker for ITBS recovery; wearable activity data can contextualize running exposure but should not replace symptom response.
  strength: low
  sourceKeys:
  - source_artifact:pmid-37300970
  - source_artifact:pmid-39247485
  - source_artifact:pmid-23954385
  - source_artifact:pmid-26573859
  - source_artifact:pmid-36758425
  - source_artifact:pmid-38618688
  caveats:
  - Biomechanical and risk-factor evidence is mostly context rather than intervention validation.
- claimId: gait-retraining-optional-selected-runners
  type: mixed_evidence
  text: Gait retraining and cadence or step-rate changes are plausible tools for selected runners, but they should be framed as optional movement experiments rather than universal requirements.
  strength: low
  sourceKeys:
  - source_artifact:pmid-24226623
  - source_artifact:pmid-24790783
  - source_artifact:pmid-17134904
  - source_artifact:pmid-17728030
  - source_artifact:pmid-23954385
  caveats:
  - Direct gait evidence is case-report-heavy and mechanism evidence does not prove a one-size-fits-all correction.
- claimId: biomechanics-risk-context-not-causal-proof
  type: association_not_causation
  text: Biomechanics, hip strength, and running risk-factor sources can explain plausible targets but should not be treated as proof that changing one metric prevents or resolves ITBS.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-17134904
  - source_artifact:pmid-17728030
  - source_artifact:pmid-23954385
  - source_artifact:pmid-26573859
  - source_artifact:pmid-36758425
  - source_artifact:pmid-38618688
  caveats:
  - Mostly observational or mechanistic evidence; intervention effect details were not extracted.

- claimId: red-flags-route-out
  type: safety
  text: Do not start self-guided ITBS return-to-run work after acute trauma or with inability to bear weight, locked knee, major swelling, hot/red/warm joint, fever or systemic illness, sudden swelling or deformity, rapidly worsening pain, focal bony pain, rest or night pain, neurologic symptoms, major loss of motion, or mechanical symptoms such as true locking, catching, buckling, or recurrent swelling.
  strength: high
  sourceKeys:
  - source_artifact:pmid-14530229
  - source_artifact:pmid-14734335
  - source_artifact:pmid-19147613
  - source_artifact:pmid-22134205
  - source_artifact:pmid-23015995
  - source_artifact:pmid-23821708
  - source_artifact:pmid-30325638
  - source_artifact:pmid-31194342
  - source_artifact:pmid-32222797
  - source_artifact:pmid-32370956
  - source_artifact:pmid-39219463
  caveats:
  - These are conservative knee-pain triage boundaries, not ITBS efficacy findings.

- claimId: procedures-outside-self-experiment
  type: design_guardrail
  text: Medication, corticosteroid injection, shockwave or dry-needling modalities, manual or passive soft-tissue care, and surgery should stay outside the core self-guided active rehab plan unless clinician-directed or intentionally logged as confounders; these sources are escalation, passive-adjunct, context-only, or safety-boundary evidence, not proof of active return-to-run efficacy.
  strength: high
  sourceKeys:
  - source_artifact:pmid-2028354
  - source_artifact:pmid-15155424
  - source_artifact:pmid-20836867
  - source_artifact:pmid-32875305
  - source_artifact:pmid-40015722
  - source_artifact:doi-10-1016-s0031-9406-10-61197-2
  - source_artifact:doi-10-1080-15438629509512030
  - source_artifact:pmid-26406193
  - source_artifact:pmid-34123517
  - source_artifact:pmid-35855103
  - source_artifact:pmid-41167567
  caveats:
  - Do not imply passive or procedural modalities create durable return-to-run capacity unless later extraction separates that outcome from cointerventions.
  - Injection, medication, shockwave, and surgery records are escalation or confounder context, not self-directed protocol steps.

- claimId: external-protocols-context-not-efficacy-proof
  type: evidence_scope
  text: External protocol templates and selected clinical trial registry records can help implementation comparison and research-gap tracking, but external protocols are not Murph canonical efficacy evidence and registry records should not be treated as completed efficacy evidence unless linked results are extracted.
  strength: high
  sourceKeys:
  - source_artifact:massgeneral-itbs-rehab-protocol-2021-11-01
  - source_artifact:massgeneral-return-to-running-program-2026-04-24
  - source_artifact:osu-basic-return-to-running-guideline-2019-10-01
  - source_artifact:brighamandwomens-itbs-standard-of-care-2007-01-01
  - source_artifact:aaos-orthoinfo-it-band-syndrome-2026-04-24
  - source_artifact:choosept-it-band-syndrome-guide-2026-04-24
  - source_artifact:clinicaltrials-nct02296151-2026-04-24
  - source_artifact:clinicaltrials-nct03067545-2026-04-24
  - source_artifact:clinicaltrials-nct05915754-2026-04-24
  - source_artifact:clinicaltrials-nct05973708-2026-04-24
  - source_artifact:clinicaltrials-nct06131658-2026-04-24
  - source_artifact:clinicaltrials-nct06269757-2026-04-24
  caveats:
  - External named protocols stay separate from Murph canonical protocol claims.
  - Registry records are gap-tracking context unless linked results are extracted.
- claimId: cycling-evidence-adjacent
  type: evidence_scope
  text: Cycling ITBS and bike-fit sources should remain adjacent variants rather than direct evidence for this runner return-to-run protocol.
  strength: moderate
  sourceKeys:
  - source_artifact:pmid-8129101
  - source_artifact:pmid-8166785
  - source_artifact:pmid-33344012
  - source_artifact:pmid-39304615
  caveats:
  - Cycling-specific mechanisms and progression decisions can differ from running rehabilitation.
researchLandscape:
  bottomLine: The corpus supports a conservative active rehab and return-to-run tracker, but the direct runner evidence is limited and heterogeneous; safety and differential-diagnosis boundaries should read stronger than efficacy language.
  confidenceLabel: limited
  primaryClaim: For appropriate runners with lateral knee pain consistent with ITBS, a symptom-guided plan that reduces provocative running, builds hip/glute control, and reintroduces run/walk exposure is a reasonable conservative tracking protocol.
  mainCaveat: The supplied source extraction does not justify a guaranteed timeline, a single best exercise dose, a specific biomechanical cure, or wearable biomarker recovery targets.
  groups:
  - id: direct-runner-rehab
    label: Direct rehab and return-to-run
    stance: supports
    summary: Runner-specific rehab studies, reviews, clinical protocols, and registry records support active conservative care as a reasonable tracking frame, while keeping dose and timeline claims modest.
    sourceKeys:
    - source_artifact:pmid-20145781
    - source_artifact:pmid-22994651
    - source_artifact:pmid-24226623
    - source_artifact:pmid-24790783
    - source_artifact:pmid-32448384
    - source_artifact:pmid-34375405
    - source_artifact:pmid-37300970
    - source_artifact:pmid-39247485
    - source_artifact:pmid-39593548
    - source_artifact:doi-10-1007-s40141-024-00442-w
    - source_artifact:pmid-15896092
    - source_artifact:pmid-16558617
    - source_artifact:pmid-16778549
    - source_artifact:pmid-17208506
    - source_artifact:pmid-19706004
    - source_artifact:pmid-21509133
    - source_artifact:pmid-26075154
    - source_artifact:pmid-26464876
    - source_artifact:pmid-30898786
    - source_artifact:pmid-35007886
    - source_artifact:aaos-orthoinfo-it-band-syndrome-2026-04-24
    - source_artifact:aapmr-iliotibial-band-syndrome-2024-08-22
    - source_artifact:brighamandwomens-itbs-standard-of-care-2007-01-01
    - source_artifact:brighamandwomens-running-injury-prevention-return-to-running-2007-01-01
    - source_artifact:choosept-it-band-syndrome-guide-2026-04-24
    - source_artifact:clinicaltrials-nct02296151-2026-04-24
    - source_artifact:clinicaltrials-nct05915754-2026-04-24
    - source_artifact:clinicaltrials-nct05973708-2026-04-24
    - source_artifact:clinicaltrials-nct06131658-2026-04-24
    - source_artifact:clinicaltrials-nct06269757-2026-04-24
    - source_artifact:dartmouth-hitchcock-it-band-exercises-2020-12-01
    - source_artifact:hss-it-band-syndrome-2022-06-20
    - source_artifact:massgeneral-itbs-rehab-protocol-2021-11-01
    - source_artifact:massgeneral-return-to-running-program-2026-04-24
    - source_artifact:osu-basic-return-to-running-guideline-2019-10-01
    - source_artifact:pmid-10405728
    - source_artifact:pmid-15864895
    - source_artifact:pmid-21665168
    - source_artifact:pmid-32514741
    - source_artifact:pmid-32769015
    - source_artifact:pmid-465909
    - source_artifact:pmid-7237678
    - source_artifact:pmid-7396052
    - source_artifact:doi-10-32098-mltj.01.2021.04
    - source_artifact:doi-10-33438-ijdshs.1249364
    - source_artifact:doi-10-4102-sajp.v67i2.42
    - source_artifact:doi-10-32098-mltj.02.2019.05
    defaultOpen: true
  - id: mechanism-risk-context
    label: Biomechanics and risk context
    stance: context_only
    summary: Mechanism, anatomy, epidemiology, assessment, and risk-factor sources explain likely drivers and confounders, but they do not prove that one correction or exercise dose fixes ITBS.
    sourceKeys:
    - source_artifact:pmid-17134904
    - source_artifact:pmid-17728030
    - source_artifact:pmid-23954385
    - source_artifact:pmid-24450366
    - source_artifact:pmid-26573859
    - source_artifact:pmid-27693442
    - source_artifact:pmid-29234554
    - source_artifact:pmid-29373059
    - source_artifact:pmid-33344012
    - source_artifact:pmid-36758425
    - source_artifact:pmid-38618688
    - source_artifact:pmid-39304615
    - source_artifact:doi-10-3390-physiologia4040032
    - source_artifact:pmid-10959926
    - source_artifact:pmid-12649036
    - source_artifact:pmid-12782549
    - source_artifact:pmid-12839207
    - source_artifact:pmid-16533314
    - source_artifact:pmid-16996312
    - source_artifact:pmid-17023254
    - source_artifact:pmid-18050060
    - source_artifact:pmid-18583001
    - source_artifact:pmid-18843156
    - source_artifact:pmid-20118523
    - source_artifact:pmid-20617908
    - source_artifact:pmid-21063495
    - source_artifact:pmid-21615188
    - source_artifact:pmid-21962907
    - source_artifact:pmid-23312729
    - source_artifact:pmid-23677835
    - source_artifact:pmid-24183546
    - source_artifact:pmid-24923269
    - source_artifact:pmid-25622800
    - source_artifact:pmid-25701012
    - source_artifact:pmid-26317300
    - source_artifact:pmid-26755689
    - source_artifact:pmid-27239728
    - source_artifact:pmid-27490817
    - source_artifact:pmid-27718393
    - source_artifact:pmid-28217413
    - source_artifact:pmid-28238018
    - source_artifact:pmid-28609131
    - source_artifact:pmid-28618309
    - source_artifact:pmid-29920153
    - source_artifact:pmid-30556469
    - source_artifact:pmid-30662495
    - source_artifact:pmid-30743163
    - source_artifact:pmid-30973056
    - source_artifact:pmid-31141437
    - source_artifact:pmid-31439366
    - source_artifact:pmid-31999979
    - source_artifact:pmid-32388078
    - source_artifact:pmid-32566382
    - source_artifact:pmid-32938222
    - source_artifact:pmid-34249647
    - source_artifact:pmid-34540268
    - source_artifact:pmid-34706617
    - source_artifact:pmid-35247202
    - source_artifact:pmid-36232250
    - source_artifact:pmid-39007893
    - source_artifact:pmid-39285616
    - source_artifact:pmid-40628903
    - source_artifact:pmid-7564981
    - source_artifact:pmid-8734891
    - source_artifact:pmid-11103969
    - source_artifact:pmid-1201997
    - source_artifact:pmid-13549519
    - source_artifact:pmid-16558169
    - source_artifact:pmid-8298633
    - source_artifact:doi-10-16965-ijpr.2015.105
    - source_artifact:doi-10-1111-j.1600-0838.2009.01045.x
    - source_artifact:doi-10-1123-ijatt.2016-0075
    - source_artifact:doi-10-30621-jbachs.1298818
    defaultOpen: false
  - id: context-and-variant-boundaries
    label: Adjacent variants and passive modalities
    stance: context_only
    summary: Cycling, passive soft-tissue care, shockwave, dry needling, acupuncture, procedures, registry-only records, and broader running-injury context stay separate from the core runner rehab claim.
    sourceKeys:
    - source_artifact:pmid-8129101
    - source_artifact:pmid-8166785
    - source_artifact:doi-10-1016-j-jbmt-2005-01-007
    - source_artifact:doi-10-1016-s0031-9406-10-61197-2
    - source_artifact:doi-10-1080-15438629509512030
    - source_artifact:doi-10-14260-jemds-2014-3186
    - source_artifact:doi-10-15621-ijphy-2017-v4i6-163919
    - source_artifact:mospace-itbs-cyclist-2007
    - source_artifact:pmid-11916889
    - source_artifact:pmid-11994795
    - source_artifact:pmid-18063715
    - source_artifact:pmid-19966104
    - source_artifact:pmid-20847225
    - source_artifact:pmid-22389869
    - source_artifact:pmid-25155475
    - source_artifact:pmid-25184012
    - source_artifact:pmid-26406193
    - source_artifact:pmid-29791183
    - source_artifact:pmid-30312310
    - source_artifact:pmid-30682136
    - source_artifact:pmid-34123517
    - source_artifact:pmid-34142644
    - source_artifact:pmid-34422283
    - source_artifact:pmid-35151569
    - source_artifact:pmid-35855103
    - source_artifact:pmid-36362725
    - source_artifact:pmid-36498062
    - source_artifact:pmid-37367238
    - source_artifact:pmid-41167567
    - source_artifact:pmid-8111852
    - source_artifact:clinicaltrials-gov-myofascial-release-mets-itbs-2026-04-24
    - source_artifact:clinicaltrials-gov-radial-eswt-itbs-2026-04-24
    - source_artifact:clinicaltrials-nct03067545-2026-04-24
    - source_artifact:clinicaltrials-nct04164316-2026-04-24
    - source_artifact:clinicaltrials-nct05427110-2026-04-24
    - source_artifact:clinicaltrials-nct05459623-2026-04-24
    - source_artifact:clinicaltrials-nct06089005-2026-04-24
    - source_artifact:clinicaltrials-nct06867159-2026-04-24
    - source_artifact:clinicaltrials-nct06980324-2026-04-24
    - source_artifact:clinicaltrials-nct07118371-2026-04-24
    - source_artifact:clinicaltrials-nct07534605-2026-04-24
    - source_artifact:doi-10-26603-ijspt20180652
    - source_artifact:doi-10-1089-acu.2016.1212
    - source_artifact:doi-10-12968-ijtr.2014.21.12.569
    - source_artifact:doi-10-4085-1062-6050-0463.25
    - source_artifact:else-moodley-foam-rolling-itbfs-2016
    defaultOpen: false
  - id: safety-escalation
    label: Safety and escalation boundaries
    stance: safety_boundary
    summary: Differential diagnosis, red flags, imaging, injection, medication, surgery, and broader knee-pain triage sources define when self-guided return-to-run work should stop or move to clinical care.
    sourceKeys:
    - source_artifact:pmid-14530229
    - source_artifact:pmid-14734335
    - source_artifact:pmid-15155424
    - source_artifact:pmid-19147613
    - source_artifact:pmid-20836867
    - source_artifact:pmid-22134205
    - source_artifact:pmid-23015995
    - source_artifact:pmid-23821708
    - source_artifact:pmid-30325638
    - source_artifact:pmid-31194342
    - source_artifact:pmid-31728373
    - source_artifact:pmid-32222797
    - source_artifact:pmid-32370956
    - source_artifact:pmid-32875305
    - source_artifact:pmid-39219463
    - source_artifact:pmid-40015722
    - source_artifact:albertahealthservices-provincial-knee-primary-care-clinical-pathway-2026-01
    - source_artifact:health-qld-acute-knee-pain-2024-02-13
    - source_artifact:hweclinicalguidance-knee-pain-2024-03
    - source_artifact:mskdorset-lateral-knee-pain-itbs-2026-04-24
    - source_artifact:nice-cks-knee-pain-assessment-2026-04-24
    - source_artifact:patient-info-swollen-knee-2023-07-20
    - source_artifact:pmid-10512211
    - source_artifact:pmid-16902230
    - source_artifact:pmid-19286912
    - source_artifact:pmid-2028354
    - source_artifact:pmid-23804342
    - source_artifact:pmid-24156006
    - source_artifact:pmid-2610280
    - source_artifact:pmid-27172085
    - source_artifact:pmid-29385940
    - source_artifact:pmid-29872355
    - source_artifact:pmid-30392599
    - source_artifact:pmid-31475628
    - source_artifact:pmid-32809682
    - source_artifact:pmid-33418617
    - source_artifact:pmid-35072941
    - source_artifact:pmid-38095838
    - source_artifact:pmid-39488356
    - source_artifact:pmid-39897984
    - source_artifact:pmid-9656942
    - source_artifact:pmid-25157051
    defaultOpen: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
  - acute_traumatic_onset_or_fall
  - sudden_pop_or_high_energy_injury
  - immediate_swelling_or_deformity
  - instability_or_inability_to_bear_weight
  - hot_red_or_swollen_knee
  - fever_or_systemic_illness
  - severe_unexplained_night_or_rest_pain
  - true_locking_or_inability_to_extend
  - recurrent_swelling
  - painful_clicking_or_catching
  - buckling_or_giving_way
  - numbness_weakness_or_neurologic_symptoms
  - focal_bony_tenderness
  - suspected_stress_fracture
  - suspected_meniscal_or_ligament_injury
  - patellofemoral_mimic
  - hip_or_back_referral_pattern
  - adolescent_knee_pain
  - prior_knee_surgery_or_replacement
  - inflammatory_or_crystal_arthritis
  - significant_osteoarthritis
  - infection_history_or_immunosuppression
  - symptoms_beyond_short_deload_period
  - recurrence_on_running_resumption
  - pregnancy_or_postpartum_return_to_run
  - elite_or_tactical_military_loading
  - cyclist_bike_fit_driven_symptoms
  - post_surgical_knees
  - nsaid_or_pain_masking_use
  - corticosteroid_injection
  - shockwave_or_dry_needling
  - clinician_directed_manual_therapy
  - imaging_driven_decisions_or_surgery
  stopIf:
  - Lateral knee pain becomes sharp, rapidly worsens, alters gait, causes limping, exceeds the protocol pain cap, or keeps increasing during a run
  - Pain appears at rest, persists after the session, or is worse later that day or the next morning after a run/walk or rehab session
  - Swelling, warmth, redness, fever, buckling, true locking, catching, inability to bear weight, numbness, weakness, or major motion loss appears
  - Pain spreads, changes location, or becomes diagnostically unclear
  - Walking, stairs, or ordinary daily activity become meaningfully worse
  - The user starts a new medication, injection, shockwave, dry needling, manual-therapy plan, surgery pathway, or another major treatment that changes attribution
  notes:
  - Not a diagnostic tool — route unclear or urgent knee pain to clinical evaluation.
  - Pain caps are conservative safety rules, not proven ITBS-specific thresholds.
  - Stop conditions are intentionally conservative given limited adverse-event data.
  - Safety language should be more forceful than efficacy language.
---

This protocol is a **conservative, symptom-guided return-to-run tracker** for runners whose lateral knee pain is consistent with iliotibial band syndrome (ITBS) or who already have a clinician diagnosis.

It is not a diagnosis, a cure claim, or a race-timeline promise. The goal is to make the next steps observable: lower the running load that provokes symptoms, build tolerable hip/glute and single-leg control capacity, and reintroduce easy running only when the knee response stays mild during the session and the next day.

Do not start this self-guided protocol, and seek urgent clinical care, if knee pain followed a major injury or is accompanied by sudden swelling, deformity, a pop at injury, inability to bear weight, severe pain, fever, a hot/red/warm swollen joint, or major loss of knee motion.

Do not use this page as a self-diagnosis protocol for locking, catching, true giving-way, recurrent swelling, pain at rest or night, focal bony tenderness, adolescent knee pain with hip pain, or unclear knee/hip/spine pain. Get assessed first.

## Who this is for

This ordinary self-guided variant is for adults with likely uncomplicated lateral iliotibial-band pain that settles with load reduction and has no red flags. Use this when the practical question is: “Can I rebuild easy running without lateral knee pain escalating?”

## Who this is not for

Do not use this as a workaround for urgent, traumatic, mechanically symptomatic, systemic, or unclear knee pain. Acute trauma, inability to bear weight, a locked or very swollen knee, fever or a hot/red joint, neurologic symptoms, rapidly worsening pain, major motion loss, stress-fracture-like focal bony pain, suspected meniscal, ligament, cartilage, or patellofemoral mimic, adolescent knee/hip pain, or symptoms that do not behave like lateral running-related knee pain should route to appropriate clinical evaluation before self-guided return-to-run work.

Cycling ITBS, bike-fit adjustment, pregnancy/postpartum return-to-run, post-surgical knees, persistent or refractory symptoms, injection, medication, shockwave, dry needling, clinician-directed manual therapy, and surgical pathways are adjacent, clinician-guided, or escalation variants. They can be logged as context, but they are not steps inside this Murph protocol.

## How to run the protocol

Start with a 7-day baseline. Log lateral knee pain location, onset minute or mile, walking and stair symptoms, running exposure, weekly mileage, recent mileage jumps, terrain, hills, downhill, camber, shoes, cross-training, sleep/fatigue/illness, and any treatment changes. During the baseline, avoid runs that clearly flare symptoms.

For this 6-week Murph template, complete three weekly strength/control sessions. Keep the first sessions tolerable and boring: lateral-hip and glute work, trunk control, and single-leg control are reasonable targets to test, but the goal is repeatable loading rather than heroic soreness.

Foam rolling or soft-tissue work is optional comfort work. Keep pressure mild, avoid bruising, numbness, or sharp pain, and do not treat rolling as required or as proof that the iliotibial band has been lengthened.

Begin return-to-run only after normal walking, the current rehab phase, and lateral-knee palpation are pain-free. Start with short, flat, alternate-day run-walk sessions. Keep hills, downhill running, cambered roads, speedwork, sudden mileage jumps, and long strides out until flat running is consistently symptom-free. If symptoms recur, stop the progression, rest/reset, and restart from the last pain-free phase.

## What to measure

The primary signal is lateral knee pain during and after running. The supporting signal is pain-free run/walk tolerance: how many flat, easy minutes the knee handles without forcing a stop or rebounding later that day or the next morning.

Weekly mileage, route, pace, hills, rehab completion, and wearable activity data help explain the result. They are exposure context, not proof that the protocol worked. No supplied extraction supports a wearable biomarker that proves ITBS recovery.

## Evidence stance

Evidence for ITBS rehabilitation is heterogeneous and often limited. Hip-abductor strengthening is a common conservative-care component, but this page should not claim that weak glutes are the cause for every runner or that any single exercise cures ITBS.

The evidence landscape is useful but not definitive. Direct runner rehab sources, recent reviews, and case reports support a cautious active-rehab rationale; external clinical protocols help with implementation structure; and mechanism or biomechanics sources explain why load, hip control, and gait cues are plausible monitoring targets. The package does not justify exact effect sizes, universal timelines, or a single best exercise recipe.

## Practical safety rule

When in doubt, regress before you progress. A run that feels tolerable during the session but rebounds the next day is not yet a successful progression.

Stop the run or exercise now if lateral knee pain becomes sharp, rapidly worsens, changes your gait, causes limping, appears at rest, or is accompanied by swelling, warmth, redness, locking, catching, buckling, numbness, weakness, or inability to bear weight. If symptoms are worse later the same day or the next morning, do not progress.

The numeric pain cap used here is a conservative safety rule for this self-experiment, not a proven ITBS-specific threshold. Do not use NSAIDs, acetaminophen, corticosteroid injection, or other pain-relieving treatment to pass a run-readiness test.

Ask a clinician or physical therapist if symptoms do not clearly improve after an appropriate deload and rehab trial, if pain recurs whenever running resumes, if diagnosis is uncertain, or if you cannot progress without symptoms. Persistent or refractory symptoms are outside this ordinary self-guided variant.
