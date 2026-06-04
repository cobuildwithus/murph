---
schemaVersion: "murph.commons.page.v1"
entityType: "protocol_variant"
key: "protocol_variant:hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy"
slug: "protocols/hyperbaric-oxygen-therapy/hyperbaric-oxygen-therapy"
title: "Hyperbaric Oxygen Therapy"
summary: "Breathing pure oxygen in a pressurized chamber, where the pressure dissolves extra oxygen directly into blood plasma to reach tissue that normal circulation may not supply enough."
status: "field-testing"
quality: "usable"
aliases:
  - "clinical hyperbaric oxygen therapy"
  - "systemic hyperbaric oxygen therapy"
  - "chamber-based HBOT"
categories:
  - "oxygen-therapy"
  - "clinical-supervised"
  - "wound-care"
  - "radiation-injury"
  - "acute-care"
  - "safety-sensitive"
  - "murph-canonical"
media:

  -
    kind: image
    relativePath: design-assets/hero-hyperbaric-oxygen-therapy.jpeg
    mediaType: image/jpeg
    caption: Hyperbaric Oxygen Therapy
relations:

  -
    type: "parent_family"
    target: "experiment_family:hyperbaric-oxygen-therapy"
  -
    type: "primary_biomarker"
    target: "biomarker:morning-blood-pressure"
  -
    type: "secondary_biomarker"
    target: "biomarker:estimated-vo2max"
  -
    type: "secondary_biomarker"
    target: "biomarker:resting-heart-rate"
  -
    type: "secondary_biomarker"
    target: "biomarker:hrv-rmssd"
  -
    type: "cites"
    target: "source_artifact:ama-oppose-unsafe-mild-hyperbaric-therapy-2022-06-01"
  -
    type: "cites"
    target: "source_artifact:clinicaltrialsgov-nct02085330-hbot-mild-cognitive-impairment-2026-04-23"
  -
    type: "cites"
    target: "source_artifact:clinicaltrialsgov-nct03036254-hbot-cognition-diabetic-elderly-2026-04-23"
  -
    type: "cites"
    target: "source_artifact:clinicaltrialsgov-nct05297019-hbot-epigenetic-aging-2026-04-23"
  -
    type: "cites"
    target: "source_artifact:clinicaltrialsgov-nct05349318-hbot-prodromal-alzheimers-cvd-2026-04-23"
  -
    type: "cites"
    target: "source_artifact:clinicaltrialsgov-nct07361861-hbot-vo2max-inflammation-2026-04-23"
  -
    type: "cites"
    target: "source_artifact:cms-ncd-20-29-hyperbaric-oxygen-2017-11-17"
  -
    type: "cites"
    target: "source_artifact:cms-topical-oxygen-decision-memo-2017-04-03"
  -
    type: "cites"
    target: "source_artifact:doi-10-22462-05-06-2018-15"
  -
    type: "cites"
    target: "source_artifact:doi-10-22462-07-08-2018-15"
  -
    type: "cites"
    target: "source_artifact:doi-10-2478-phr-2023-0020"
  -
    type: "cites"
    target: "source_artifact:eubs-mild-hyperbaric-therapies-2022-12-20"
  -
    type: "cites"
    target: "source_artifact:fda-hbot-get-the-facts-2021-07-26"
  -
    type: "cites"
    target: "source_artifact:fda-safe-use-hbot-devices-2025-08-25"
  -
    type: "cites"
    target: "source_artifact:fda-topical-oxygen-chamber-extremities-guidance-2018-06-28"
  -
    type: "cites"
    target: "source_artifact:nbdhmt-physician-attendance-supervision-2013-07-01"
  -
    type: "cites"
    target: "source_artifact:nfpa-hyperbaric-facilities-fire-protection-2021-08-22"
  -
    type: "cites"
    target: "source_artifact:pmid-10092916"
  -
    type: "cites"
    target: "source_artifact:pmid-10685584"
  -
    type: "cites"
    target: "source_artifact:pmid-12362006"
  -
    type: "cites"
    target: "source_artifact:pmid-1443845"
  -
    type: "cites"
    target: "source_artifact:pmid-14586625"
  -
    type: "cites"
    target: "source_artifact:pmid-15520052"
  -
    type: "cites"
    target: "source_artifact:pmid-15547420"
  -
    type: "cites"
    target: "source_artifact:pmid-15559001"
  -
    type: "cites"
    target: "source_artifact:pmid-15674964"
  -
    type: "cites"
    target: "source_artifact:pmid-15881548"
  -
    type: "cites"
    target: "source_artifact:pmid-16180928"
  -
    type: "cites"
    target: "source_artifact:pmid-16259656"
  -
    type: "cites"
    target: "source_artifact:pmid-17393937"
  -
    type: "cites"
    target: "source_artifact:pmid-17443585"
  -
    type: "cites"
    target: "source_artifact:pmid-18225611"
  -
    type: "cites"
    target: "source_artifact:pmid-18251434"
  -
    type: "cites"
    target: "source_artifact:pmid-18342453"
  -
    type: "cites"
    target: "source_artifact:pmid-20427683"
  -
    type: "cites"
    target: "source_artifact:pmid-20456243"
  -
    type: "cites"
    target: "source_artifact:pmid-20957342"
  -
    type: "cites"
    target: "source_artifact:pmid-21125215"
  -
    type: "cites"
    target: "source_artifact:pmid-21491385"
  -
    type: "cites"
    target: "source_artifact:pmid-22383545"
  -
    type: "cites"
    target: "source_artifact:pmid-23076907"
  -
    type: "cites"
    target: "source_artifact:pmid-23087025"
  -
    type: "cites"
    target: "source_artifact:pmid-23374620"
  -
    type: "cites"
    target: "source_artifact:pmid-23423696"
  -
    type: "cites"
    target: "source_artifact:pmid-24035333"
  -
    type: "cites"
    target: "source_artifact:pmid-24189086"
  -
    type: "cites"
    target: "source_artifact:pmid-24260334"
  -
    type: "cites"
    target: "source_artifact:pmid-24343585"
  -
    type: "cites"
    target: "source_artifact:pmid-24377194"
  -
    type: "cites"
    target: "source_artifact:pmid-25003636"
  -
    type: "cites"
    target: "source_artifact:pmid-25596835"
  -
    type: "cites"
    target: "source_artifact:pmid-25596836"
  -
    type: "cites"
    target: "source_artifact:pmid-2569600"
  -
    type: "cites"
    target: "source_artifact:pmid-25813083"
  -
    type: "cites"
    target: "source_artifact:pmid-26068515"
  -
    type: "cites"
    target: "source_artifact:pmid-26152103"
  -
    type: "cites"
    target: "source_artifact:pmid-26152105"
  -
    type: "cites"
    target: "source_artifact:pmid-26703894"
  -
    type: "cites"
    target: "source_artifact:pmid-26709672"
  -
    type: "cites"
    target: "source_artifact:pmid-26740639"
  -
    type: "cites"
    target: "source_artifact:pmid-27000010"
  -
    type: "cites"
    target: "source_artifact:pmid-27265988"
  -
    type: "cites"
    target: "source_artifact:pmid-27416689"
  -
    type: "cites"
    target: "source_artifact:pmid-28198743"
  -
    type: "cites"
    target: "source_artifact:pmid-28209748"
  -
    type: "cites"
    target: "source_artifact:pmid-28357821"
  -
    type: "cites"
    target: "source_artifact:pmid-28613605"
  -
    type: "cites"
    target: "source_artifact:pmid-28968346"
  -
    type: "cites"
    target: "source_artifact:pmid-29054767"
  -
    type: "cites"
    target: "source_artifact:pmid-29074815"
  -
    type: "cites"
    target: "source_artifact:pmid-29083713"
  -
    type: "cites"
    target: "source_artifact:pmid-29607850"
  -
    type: "cites"
    target: "source_artifact:pmid-29734566"
  -
    type: "cites"
    target: "source_artifact:pmid-29888378"
  -
    type: "cites"
    target: "source_artifact:pmid-30028914"
  -
    type: "cites"
    target: "source_artifact:pmid-30192320"
  -
    type: "cites"
    target: "source_artifact:pmid-30267033"
  -
    type: "cites"
    target: "source_artifact:pmid-30380530"
  -
    type: "cites"
    target: "source_artifact:pmid-30690920"
  -
    type: "cites"
    target: "source_artifact:pmid-30851351"
  -
    type: "cites"
    target: "source_artifact:pmid-30950414"
  -
    type: "cites"
    target: "source_artifact:pmid-31002414"
  -
    type: "cites"
    target: "source_artifact:pmid-31051054"
  -
    type: "cites"
    target: "source_artifact:pmid-31062232"
  -
    type: "cites"
    target: "source_artifact:pmid-31084683"
  -
    type: "cites"
    target: "source_artifact:pmid-31369359"
  -
    type: "cites"
    target: "source_artifact:pmid-31409407"
  -
    type: "cites"
    target: "source_artifact:pmid-31537473"
  -
    type: "cites"
    target: "source_artifact:pmid-31619393"
  -
    type: "cites"
    target: "source_artifact:pmid-31865663"
  -
    type: "cites"
    target: "source_artifact:pmid-32040434"
  -
    type: "cites"
    target: "source_artifact:pmid-32176450"
  -
    type: "cites"
    target: "source_artifact:pmid-32491593"
  -
    type: "cites"
    target: "source_artifact:pmid-32589613"
  -
    type: "cites"
    target: "source_artifact:pmid-32809708"
  -
    type: "cites"
    target: "source_artifact:pmid-3289861"
  -
    type: "cites"
    target: "source_artifact:pmid-32931678"
  -
    type: "cites"
    target: "source_artifact:pmid-32961816"
  -
    type: "cites"
    target: "source_artifact:pmid-33086495"
  -
    type: "cites"
    target: "source_artifact:pmid-33206062"
  -
    type: "cites"
    target: "source_artifact:pmid-33500533"
  -
    type: "cites"
    target: "source_artifact:pmid-33847854"
  -
    type: "cites"
    target: "source_artifact:pmid-33979229"
  -
    type: "cites"
    target: "source_artifact:pmid-34143855"
  -
    type: "cites"
    target: "source_artifact:pmid-34376365"
  -
    type: "cites"
    target: "source_artifact:pmid-34709348"
  -
    type: "cites"
    target: "source_artifact:pmid-34843843"
  -
    type: "cites"
    target: "source_artifact:pmid-34862223"
  -
    type: "cites"
    target: "source_artifact:pmid-34867135"
  -
    type: "cites"
    target: "source_artifact:pmid-35353963"
  -
    type: "cites"
    target: "source_artifact:pmid-35593010"
  -
    type: "cites"
    target: "source_artifact:pmid-35821512"
  -
    type: "cites"
    target: "source_artifact:pmid-35952529"
  -
    type: "cites"
    target: "source_artifact:pmid-36100927"
  -
    type: "cites"
    target: "source_artifact:pmid-36100931"
  -
    type: "cites"
    target: "source_artifact:pmid-36151105"
  -
    type: "cites"
    target: "source_artifact:pmid-37232034"
  -
    type: "cites"
    target: "source_artifact:pmid-37256885"
  -
    type: "cites"
    target: "source_artifact:pmid-37275378"
  -
    type: "cites"
    target: "source_artifact:pmid-37475734"
  -
    type: "cites"
    target: "source_artifact:pmid-37693762"
  -
    type: "cites"
    target: "source_artifact:pmid-37708067"
  -
    type: "cites"
    target: "source_artifact:pmid-37834897"
  -
    type: "cites"
    target: "source_artifact:pmid-38092370"
  -
    type: "cites"
    target: "source_artifact:pmid-38330042"
  -
    type: "cites"
    target: "source_artifact:pmid-38356446"
  -
    type: "cites"
    target: "source_artifact:pmid-38386077"
  -
    type: "cites"
    target: "source_artifact:pmid-38615347"
  -
    type: "cites"
    target: "source_artifact:pmid-38691821"
  -
    type: "cites"
    target: "source_artifact:pmid-38961397"
  -
    type: "cites"
    target: "source_artifact:pmid-38974601"
  -
    type: "cites"
    target: "source_artifact:pmid-38985156"
  -
    type: "cites"
    target: "source_artifact:pmid-39139862"
  -
    type: "cites"
    target: "source_artifact:pmid-39200867"
  -
    type: "cites"
    target: "source_artifact:pmid-39597979"
  -
    type: "cites"
    target: "source_artifact:pmid-39733047"
  -
    type: "cites"
    target: "source_artifact:pmid-40228859"
  -
    type: "cites"
    target: "source_artifact:pmid-40405024"
  -
    type: "cites"
    target: "source_artifact:pmid-40747804"
  -
    type: "cites"
    target: "source_artifact:pmid-40969214"
  -
    type: "cites"
    target: "source_artifact:pmid-41364864"
  -
    type: "cites"
    target: "source_artifact:pmid-41364865"
  -
    type: "cites"
    target: "source_artifact:pmid-41429031"
  -
    type: "cites"
    target: "source_artifact:pmid-41434344"
  -
    type: "cites"
    target: "source_artifact:pmid-41624627"
  -
    type: "cites"
    target: "source_artifact:pmid-619839"
  -
    type: "cites"
    target: "source_artifact:pmid-6691953"
  -
    type: "cites"
    target: "source_artifact:pmid-7710151"
  -
    type: "cites"
    target: "source_artifact:pmid-8760546"
  -
    type: "cites"
    target: "source_artifact:pmid-9308138"
  -
    type: "cites"
    target: "source_artifact:pmid-9525511"
  -
    type: "cites"
    target: "source_artifact:pmid-9915420"
  -
    type: "cites"
    target: "source_artifact:uhms-clinical-hyperbaric-facility-accreditation-manual-2018-06-04"
  -
    type: "cites"
    target: "source_artifact:uhms-credentialing-privileging-supervision-2023-07-03"
  -
    type: "cites"
    target: "source_artifact:uhms-hbo-indications-2020-01-01"
  -
    type: "cites"
    target: "source_artifact:uhms-hbo-indications-2020-05-04"
  -
    type: "cites"
    target: "source_artifact:uhms-office-based-facility-credentialing-2021-03-26"
  -
    type: "cites"
    target: "source_artifact:uhms-ten-guidelines-patients-referring-physicians-2025-04-17"
lineage:
  relationship: "root"
  rationale: "Canonical Murph tracking page for supervised systemic chamber HBOT, kept separate from mild/soft chambers, topical oxygen, normobaric oxygen, exercise-with-oxygen, and named external wellness protocols."
attribution:
  ownerType: "murph"
  note: "Drafted from the 2026-04-23 Hyperbaric Oxygen Therapy research run; traceability is restricted to the canonical ledger, extraction drafts, and section synthesis artifacts in the uploaded snapshot."
protocol:
  doseSignature: "Clinician-prescribed systemic chamber HBOT · log ATA/oxygen/session/air breaks · 60-90 min common outpatient sessions · 5x/week and 20-session defaults are tracking placeholders · course is indication-specific"
  target: "Use the treating clinician’s prescription for pressure, oxygen fraction, chamber type, session length, air breaks, frequency, and course length; replace Murph defaults with the facility plan before starting."
  frequency:
    sessionsPerWeek: 5
  durationMinutes:
    min: 60
    max: 90
  sessionShape:
    label: "One session"
    segments:
      - label: "chamber session"
        kind: "stimulus"
        durationMinutes: 90
    ticks:
      - label: "0"
        offsetMinutes: 0
      - label: "60 min minimum"
        offsetMinutes: 60
      - label: "90 min"
        offsetMinutes: 90
  interventionSessionsMinimum: 1
  interventionSessionsTarget: 20
  steps:
    - "Start only with an active clinician-prescribed HBOT plan at a medically supervised facility."
    - "Confirm indication, chamber type, pressure units, oxygen method, session length, air breaks, course length, and supervising clinician."
    - "Complete facility safety screen; disclose lung, ear/sinus, seizure, diabetes, pregnancy, ocular gas, device, medication, and anxiety context."
    - "Follow facility rules for clothing, electronics, personal items, grounding, device compatibility, monitoring, equalization, and staff instructions."
    - "Tell staff immediately about ear/sinus pain, dizziness, pulmonary, chest, neurologic, visual, anxiety, glucose, BP, or device symptoms."
    - "After each session, log pressure, minutes, air breaks, symptoms, adverse events, glucose/BP checks, vision/ear changes, and modifications."
    - "Keep mild chambers, topical oxygen, normobaric oxygen, EWOT, athletic oxygen, and wellness programs in separate logs."
  tips:
    - "Bring the facility prescription: indication, ATA, oxygen method, duration, air breaks, frequency, total sessions."
    - "Arrive with empty pockets: no electronics, lighters, batteries, oils, synthetics, heat packs, or unapproved devices."
    - "Equalize early and often; tell staff before ear pressure becomes pain."
    - "After each session, log actual ATA, minutes, air breaks, shortened time, staff interventions, and symptoms."
    - "Skip hard training, sauna, flights, alcohol, and long travel around treatment days unless the care team approves."
    - "Do not compare wellness chambers, topical oxygen, or EWOT against a prescribed systemic HBOT course."
  keepInMind:
    - "HBOT evidence is indication-specific: diabetic-foot ulcers, late radiation injury, sudden sensorineural hearing loss, acute carbon monoxide poisoning, decompression illness, trauma, healthy aging, and neurocognitive claims do not share one certainty level."
    - "Accepted, covered, cleared, advertised, and evidence-supported are different labels; do not turn an indication list or device clearance into a broad benefit claim."
    - "Ear/sinus pressure problems, temporary vision changes, confinement intolerance, and treatment burden are common enough to log every session."
    - "Rare risks can be high-stakes, including oxygen-toxicity seizure, pneumothorax/pulmonary barotrauma, device incompatibility, cardiopulmonary decompensation, hypoglycemia, and chamber fire."
    - "A personal Murph trend can document tolerability and adherence, but it cannot prove disease treatment efficacy without clinician-defined outcomes and appropriate comparators."
  logFields:
    - "clinical indication or reason for prescribed course"
    - "facility and supervising clinician status"
    - "chamber type and oxygen delivery method"
    - "pressure value and pressure unit"
    - "oxygen fraction if provided"
    - "planned minutes and completed minutes"
    - "air-break schedule and completed air breaks"
    - "session number of planned course"
    - "ear or sinus symptoms and equalization difficulty"
    - "vision changes"
    - "anxiety or claustrophobia"
    - "pre- and post-session blood pressure checks if relevant"
    - "glucose checks or CGM lows if diabetes or hypoglycemia risk is present"
    - "other adverse events or staff interventions"
    - "session paused shortened or stopped"
    - "same-device VO2 max or cardio-fitness estimate if performance tracking is relevant"
    - "resting heart rate and HRV recovery context"
  sessionFieldIds:
  - clinical_indication
  - chamber_type
  - pressure_value_and_unit
  - oxygen_fraction
  - planned_minutes
  - completed_minutes
  - air_breaks
  - session_number
  - ear_sinus_symptoms
  - vision_changes
  - anxiety_claustrophobia
  - glucose_bp_checks_if_relevant
  - adverse_events
  - paused_shortened_or_stopped
  stopConditions:
    - "Do not start an unsupervised course without a current clinician prescription and medically supervised facility safety controls."
    - "Stop or defer immediately if the facility or clinician identifies untreated pneumothorax, unsafe device/implant compatibility, intraocular gas, prohibited materials, or another absolute safety issue."
    - "Tell staff immediately and stop or defer as directed for severe ear or sinus pain, inability to equalize, dizziness or faintness, cough or new pulmonary symptoms, chest pain, shortness of breath, neurologic symptoms, seizure-like symptoms, confusion, severe headache, vision changes, severe anxiety or panic, hypoglycemia symptoms, unsafe glucose or blood-pressure reading if relevant, device alarm, prohibited-material concern, or any staff safety concern."
    - "Pause the Murph experiment and seek clinician/facility guidance if symptoms persist after a session, adverse events recur, sessions are repeatedly shortened, BP/glucose readings are unsafe, or the care plan changes."
testPlans:

  -
    planId: "clinician-supervised-hbot-recovery-49d"
    durationDays: 49
    baselineDays: 7
    interventionDays: 42
    primaryBiomarkerKey: "biomarker:morning-blood-pressure"
    secondaryBiomarkerKeys:
      - "biomarker:estimated-vo2max"
      - "biomarker:resting-heart-rate"
      - "biomarker:hrv-rmssd"
    minimumAdherenceSessions: 1
    targetAdherenceSessions: 20
    notes:
      - "Use this only to track a clinician-prescribed HBOT course; Murph should not recommend or initiate HBOT as a self-experiment."
      - "Replace the default intervention window and target sessions with the actual care plan when the prescription is known."
      - "Blood pressure is the primary Murph signal because HBOT can acutely raise pressure; glucose checks belong in session logs for diabetes or hypoglycemia risk."
      - "VO2 max or wearable cardio-fitness is relevant when the course resembles the older-adult performance protocol or the user already tracks it; resting heart rate and HRV are recovery context."
      - "Disease-specific benefit should be judged by clinician-defined outcomes, not by wearable proxies."
expectedSignalDescriptions:
  -
    biomarkerKey: "biomarker:morning-blood-pressure"
    description: "Pressurized oxygen tightens blood vessels during and after treatment, raising vascular resistance and blood pressure in susceptible users."
    expected: "Watch for post-session rise"
    expectedDirection: up
    estimatedChange:
      kind: "absolute"
      low: 6
      high: 16
      unit: "mmHg"
      window: "pre/post session"
      confidence: "moderate"
      basis: "Direct HBOT safety cohort: average post-session blood-pressure rise was about +6 mmHg in normotensive sessions and +16.2 mmHg in hypertensive sessions."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:estimated-vo2max"
    description: "Repeated hyperoxia under pressure pushes extra oxygen into plasma and changes vascular and cardiac perfusion during the course."
    expected: "Could improve in 60-session courses"
    estimatedChange:
      kind: "absolute"
      low: 1
      high: 3
      unit: "mL/kg/min"
      window: "12 weeks / 60 sessions"
      confidence: "low"
      basis: "Single 63-person sedentary older-adult RCT reported a net VO2max/kg increase of 1.91 ± 3.29 mL/kg/min versus control; other indications and course designs may not match."
    protocolProminence: "focus"
  -
    biomarkerKey: "biomarker:resting-heart-rate"
    description: "Pressure equalization, confinement anxiety, pressure shifts, glucose swings, and fatigue add recovery load that carries into resting pulse."
    expected: "Watch for recovery load"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "overnight trend during course"
      confidence: "low"
      basis: "The extracted HBOT evidence supports BP, glucose, adverse-event, and VO2 monitoring more directly than RHR; use same-device RHR as tolerability context."
    protocolProminence: "context"
  -
    biomarkerKey: "biomarker:hrv-rmssd"
    description: "Pressure changes, anxiety, illness, and fatigue keep autonomic tone elevated, suppressing parasympathetic recovery after treatment."
    expected: "Watch for strain"
    estimatedChange:
      kind: "mixed_or_contextual"
      window: "overnight trend during course"
      confidence: "low"
      basis: "No extracted HBOT trial gives a reliable RMSSD effect size for this broad protocol; HRV is useful for recovery interpretation, not efficacy scoring."
    protocolProminence: "context"
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to track a clinician-prescribed hyperbaric oxygen therapy course."
    intentSummary: "Track clinician-supervised HBOT"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "unsupervised_start"
        prompt: "Are you considering HBOT without a current clinician prescription or without a medically supervised chamber facility?"
        ifPositive: "do_not_start_unsupervised"
      - id: "urgent_or_disease_treatment_request"
        prompt: "Is this for current carbon-monoxide exposure/poisoning, decompression illness, gas embolism, crush or traumatic ischemia, a non-healing wound, radiation injury, sudden hearing loss, or a neurologic symptom/diagnosis?"
        ifPositive: "do_not_start_unsupervised"
      - id: "absolute_or_major_chamber_safety_issue"
        prompt: "Any untreated pneumothorax, unresolved chamber/device compatibility concern, intraocular gas, prohibited-material concern, or facility instruction that says HBOT should not proceed?"
        ifPositive: "do_not_start_unsupervised"
      - id: "relative_contraindication_or_monitoring_issue"
        prompt: "Any lung disease, blebs/bullae, COPD/asthma, thoracic surgery history, ear/sinus equalization problem, recent respiratory infection, fever, seizure history or seizure-threshold modifier, CNS disease, hypercapnia/CO2-retention risk, opioid or sedative use, alcohol withdrawal/dependence, diabetes/hypoglycemia risk, pregnancy context, intraocular gas or recent eye surgery, selected chemotherapy/medication exposure, implanted or external device, uncontrolled blood pressure, heart-failure concern, severe claustrophobia/anxiety, or recent nicotine/high-caffeine/other vasoconstrictor exposure?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "active_or_recent_adverse_event"
        prompt: "Any severe ear/sinus pain, neurologic symptom, chest symptom, shortness of breath, vision change, severe anxiety, glucose symptom, unsafe blood-pressure reading if relevant, device alarm, or prior HBOT session stopped for safety?"
        ifPositive: "clinician_guidance_before_unsupervised_start"
  setupSlots:
    - id: "clinical_indication"
      label: "Clinical indication"
      question: "What indication or care-plan reason did the treating clinician give for HBOT?"
      target:
        object: "experimentRun"
        field: "clinicalIndication"
    - id: "prescribed_schedule"
      label: "Prescribed schedule"
      question: "What pressure, session length, frequency, air-break plan, and total number of sessions were prescribed?"
      target:
        object: "experimentRun"
        field: "prescribedSchedule"
    - id: "facility_supervision"
      label: "Facility supervision"
      question: "Will every session be delivered in a medically supervised chamber facility with staff monitoring?"
      target:
        object: "onboardingCapture"
        field: "answers.facilitySupervision"
    - id: "chamber_type"
      label: "Chamber type"
      question: "What chamber type will be used?"
      options:
        - "monoplace"
        - "multiplace"
        - "unknown"
      target:
        object: "experimentRun"
        field: "chamberType"
    - id: "session_log_reminder_policy"
      label: "Session log reminder policy"
      question: "Should Murph remind you to log each prescribed session and adverse-event check?"
      options:
        - "none"
        - "post_session_log"
        - "post_session_plus_same_day_missing_log_check"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "clinician-supervised-hbot-recovery-49d"
    firstSessionGuidance: "Do not begin unless the clinician/facility plan is active; replace the default HBOT schedule with the actual prescribed pressure, oxygen method, chamber type, session duration, air-break plan, frequency, and total planned sessions before logging the first session."
  trackingHints:
    confounderFields:
      - "acute_respiratory_infection"
      - "fever_or_illness"
      - "medication_change"
      - "glucose_instability"
      - "blood_pressure_instability"
      - "recent_nicotine_caffeine_or_vasoconstrictor_exposure"
      - "opioid_sedative_alcohol_withdrawal_or_other_seizure_threshold_modifier"
      - "sleep_disruption"
      - "other_major_intervention"
    notes:
      - "Log absence of adverse events as explicitly as presence of adverse events."
  supportHints:
    missedLogFollowupCopy: "Did you complete today's prescribed HBOT session, and were there any ear, sinus, vision, anxiety, glucose, blood-pressure, or other safety notes to log?"
whyItWorks:
  - "## Pressure dissolves oxygen\n\nHBOT raises pressure while oxygen fraction stays high. Hemoglobin is already near full; the extra dose comes from oxygen dissolving directly into plasma."
  - "## Gradient drives tissue delivery\n\nHigher plasma oxygen steepens the diffusion gradient into tissue. That matters most where ordinary delivery is limited, injured, or clinically targeted."
  - "## Course effect is indication-specific\n\nRepeated sessions create intermittent hyperoxia, vascular constriction, and perfusion shifts. Blood pressure, glucose, ear pressure, and symptoms track safety; disease outcomes need clinician-defined endpoints."
mechanismChain:
  -
    label: "Session"
    content: "Clinician-prescribed chamber · pressure + 100% oxygen"
  -
    label: "Acute effect"
    content: "Plasma oxygen rises; tissue oxygen gradient increases"
  -
    label: "Repeated signal"
    content: "Hyperoxia · air breaks · vasoconstriction · perfusion shifts"
  -
    label: "Adaptation"
    content: "Oxygen delivery changes · vascular signaling shifts · tolerance guides safety"
claims:

  -
    claimId: "clinical-systemic-hbot-definition"
    type: "design_guardrail"
    text: "For this protocol, direct HBOT evidence should be limited to systemic whole-body chamber-based clinical HBOT, not informal oxygen exposure, local/topical oxygen devices, or unrelated hyperoxia practices."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-38092370"
      - "source_artifact:uhms-hbo-indications-2020-01-01"
      - "source_artifact:cms-ncd-20-29-hyperbaric-oxygen-2017-11-17"
      - "source_artifact:pmid-15881548"
      - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
    caveats:
      - "These are boundary and guideline/regulatory sources, not indication-specific effect-size evidence."
      - "A study can be direct to the HBOT modality but still population- or indication-mismatched for a wellness user."
  -
    claimId: "clinical-supervision-is-part-of-dose"
    type: "safety"
    text: "Clinical HBOT should be framed as a medically supervised service with physician dose responsibility, trained staff, facility accreditation or equivalent safety systems, and device/fire controls; office-based delivery is not a lower-standard exception."
    strength: "high"
    sourceKeys:
      - "source_artifact:nbdhmt-physician-attendance-supervision-2013-07-01"
      - "source_artifact:uhms-credentialing-privileging-supervision-2023-07-03"
      - "source_artifact:pmid-25003636"
      - "source_artifact:uhms-office-based-facility-credentialing-2021-03-26"
      - "source_artifact:pmid-38985156"
      - "source_artifact:uhms-clinical-hyperbaric-facility-accreditation-manual-2018-06-04"
      - "source_artifact:fda-safe-use-hbot-devices-2025-08-25"
      - "source_artifact:uhms-ten-guidelines-patients-referring-physicians-2025-04-17"
    caveats:
      - "This claim defines the safe-delivery boundary; it does not establish efficacy for any indication."
      - "Different acuity levels may require different monitoring and staffing capability."
  -
    claimId: "indications-coverage-and-certainty-are-not-equivalent"
    type: "evidence_scope"
    text: "Accepted, non-accepted, covered, cleared, and unestablished HBOT uses should remain distinct because indication lists and coverage policies define scope but do not make every proposed use equally evidence-based."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-28357821"
      - "source_artifact:cms-ncd-20-29-hyperbaric-oxygen-2017-11-17"
      - "source_artifact:uhms-hbo-indications-2020-05-04"
      - "source_artifact:pmid-24189086"
      - "source_artifact:pmid-25596836"
      - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
    caveats:
      - "The section should not collapse all recognized HBOT indications into one evidence grade."
      - "FDA, CMS, UHMS, and European consensus sources answer partly different questions: device/claim safety, coverage, professional indication taxonomy, and clinical consensus."
  -
    claimId: "mild-soft-chambers-are-adjacent-variants"
    type: "evidence_scope"
    text: "Mild, low-pressure, and soft/fabric chamber hyperbaric exposures should stay in an adjacent-variant bucket and should not be substituted for standard clinical HBOT dosing or evidence."
    strength: "high"
    sourceKeys:
      - "source_artifact:eubs-mild-hyperbaric-therapies-2022-12-20"
      - "source_artifact:doi-10-22462-07-08-2018-15"
      - "source_artifact:ama-oppose-unsafe-mild-hyperbaric-therapy-2022-06-01"
      - "source_artifact:pmid-31084683"
      - "source_artifact:pmid-31062232"
      - "source_artifact:pmid-38615347"
    caveats:
      - "Some mild-hyperbaric sources discuss mechanisms or lower-pressure physiology; that does not make them direct evidence for standard HBOT."
      - "The 1.4 ATA versus 2 ATA chronic-ulcer comparison is a transcutaneous oxygenation study, not a clinical healing trial."
  -
    claimId: "topical-oxygen-is-not-systemic-hbot"
    type: "mixed_evidence"
    text: "Topical oxygen and topical hyperbaric oxygen for wounds are local/device modalities, not systemic HBOT; their wound-healing evidence can be discussed as adjacent evidence but should not inherit systemic HBOT mechanisms, indications, or outcomes."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:doi-10-22462-05-06-2018-15"
      - "source_artifact:cms-topical-oxygen-decision-memo-2017-04-03"
      - "source_artifact:fda-topical-oxygen-chamber-extremities-guidance-2018-06-28"
      - "source_artifact:pmid-32176450"
      - "source_artifact:pmid-3289861"
      - "source_artifact:pmid-31619393"
      - "source_artifact:pmid-33979229"
      - "source_artifact:pmid-35593010"
    caveats:
      - "Topical oxygen evidence is internally mixed: some newer trials and meta-analyses are positive, while a guideline and older position statement caution against use or substitution."
      - "A dedicated topical-oxygen page could make outcome claims; this HBOT page should use it mainly to prevent modality conflation."
  -
    claimId: "normobaric-and-ewot-are-not-hbot"
    type: "evidence_scope"
    text: "Normobaric oxygen, supplemental oxygen during exercise, and oxygen-with-training protocols are adjacent oxygen exposures rather than HBOT; any benefits or null findings should be interpreted by their own modality and population."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-26709672"
      - "source_artifact:pmid-20456243"
      - "source_artifact:pmid-29607850"
      - "source_artifact:pmid-17443585"
      - "source_artifact:pmid-32961816"
    caveats:
      - "Some normobaric or same-mechanism oxygen signals may be clinically relevant in their own settings, but they do not define or validate chamber HBOT."
      - "Exercise-with-oxygen findings were largely COPD rehabilitation contexts, not healthy-wellness performance programs."
  -
    claimId: "dose-metadata-pressure-oxygen-and-chamber-type"
    type: "design_guardrail"
    text: "The protocol should record source-reported pressure units and oxygen fraction rather than collapsing regimens: extracted sources include near-100% oxygen at minimum 2 ATA for approved-indication framing, >99% or 100% oxygen at 1.5 ATA for 60-minute neuro/PPCS protocols, and reported pressures of 1.75 ATA, 2 ATA, 2.2 atmospheres, 2.4 ATA/bar, or ≥2.5 ATA in other clinical or protocol contexts."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:doi-10-22462-07-08-2018-15"
      - "source_artifact:pmid-29734566"
      - "source_artifact:pmid-24260334"
      - "source_artifact:clinicaltrialsgov-nct07361861-hbot-vo2max-inflammation-2026-04-23"
      - "source_artifact:pmid-40969214"
      - "source_artifact:pmid-37834897"
      - "source_artifact:pmid-40228859"
      - "source_artifact:pmid-41624627"
    caveats:
      - "Some sources report pressure in bar, kPa, atmospheres, or ATA; this synthesis preserves reported units rather than converting them."
      - "Oxygen fraction is not extracted for every outcome source."
      - "Presence of a pressure in an outcome study is not proof that the dose is optimal."
  -
    claimId: "session-count-is-indication-specific"
    type: "mixed_evidence"
    text: "There is no single evidence-backed session count for all HBOT uses: extracted acute carbon-monoxide guidance and trials center on one versus three sessions within the first 24 hours, diabetic-foot trials emphasize at least 20 sessions and often up to 40 with stronger signals among high completers, while neuro/PPCS and post-COVID sources commonly use 40 daily or near-daily sessions and some pediatric or observational protocols use 60 or wider 40–82 session ranges; a 10-session 2.4 bar long-COVID trial was null on primary endpoints."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-34867135"
      - "source_artifact:pmid-37708067"
      - "source_artifact:pmid-28968346"
      - "source_artifact:pmid-20427683"
      - "source_artifact:pmid-29734566"
      - "source_artifact:pmid-35821512"
      - "source_artifact:pmid-36151105"
      - "source_artifact:pmid-30950414"
      - "source_artifact:pmid-40228859"
    caveats:
      - "These sources span different indications and populations and should not be pooled into one recommended schedule."
      - "Some included outcome sources are uncontrolled, pediatric, military, or disease-specific."
      - "The carbon-monoxide schedule is emergency-care context, not wellness or chronic-use guidance."
  -
    claimId: "air-breaks-should-be-logged"
    type: "design_guardrail"
    text: "Air breaks should be logged explicitly: extracted protocols include 90-minute 2 ATA HBOT with 5-minute air breaks every 20 minutes, multiplace 2.4 ATA mask oxygen delivered as three 30-minute oxygen periods separated by 5-minute air breaks in seizure cases, and source-page draft examples of long-COVID or TBI protocols with air breaks; absence of extracted air-break text should not be interpreted as absence of air breaks."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-31409407"
      - "source_artifact:pmid-29888378"
      - "source_artifact:pmid-34862223"
      - "source_artifact:pmid-40969214"
      - "source_artifact:clinicaltrialsgov-nct07361861-hbot-vo2max-inflammation-2026-04-23"
    caveats:
      - "Some air-break details come from normalized source-page drafts rather than atomic-finding intervention fields."
      - "Air-break schedules are not consistently extractable across efficacy studies."
      - "This claim is about dose logging and safety interpretation, not about superiority of one air-break schedule."
  -
    claimId: "dose-intensity-has-safety-tradeoffs"
    type: "safety"
    text: "Dose intensity has safety implications: pooled randomized safety evidence found more adverse effects with HBOT than controls and study-level subgroup signals associating pressure above 2.0 ATA or more than 10 sessions with more adverse effects; registry and cohort data show many treatments complete without major events, but otalgia, barotrauma, confinement anxiety, side-effect pauses or terminations, oxygen-toxicity seizure, pneumothorax, and fire risk remain implementation concerns."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-37275378"
      - "source_artifact:pmid-39597979"
      - "source_artifact:pmid-28198743"
      - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
    caveats:
      - "The dose-intensity safety signal is subgroup/observational within a heterogeneous meta-analysis, not a randomized pressure-threshold experiment."
      - "Registry data are per-treatment and setting-specific, not proof that unsupervised or non-medical exposure is safe."
      - "FDA adverse-event guidance does not provide incidence rates."
  -
    claimId: "selected-diabetic-foot-ulcer-scope"
    type: "evidence_scope"
    text: "The wound section should frame systemic chamber-based HBOT as a supervised adjunct for selected diabetic-foot subgroups, not as a generic wound-healing intervention. Extracted guidance narrows consideration to higher-grade or stalled ulcers, and to ischemic or neuro-ischemic diabetes-related foot ulcers failing best standard care where treatment infrastructure exists."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-26152105"
      - "source_artifact:pmid-37232034"
      - "source_artifact:pmid-32176450"
      - "source_artifact:pmid-32931678"
    caveats:
      - "Guideline support is conditional and limited by low-certainty or moderate-quality underlying evidence."
      - "This scope does not generalize to all chronic wounds, lower-grade diabetic foot ulcers, nonischemic ulcers, home use, or topical oxygen devices."
  -
    claimId: "dfu-syntheses-report-benefit-signals"
    type: "intervention_result"
    text: "Direct diabetic-foot-ulcer syntheses repeatedly report favorable signals for complete healing or healing rate and for major-amputation reduction when HBOT is added to standard diabetic-foot care."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-34376365"
      - "source_artifact:pmid-33500533"
      - "source_artifact:pmid-31002414"
      - "source_artifact:pmid-23374620"
    caveats:
      - "Trial protocols, wound severity, cointerventions, and follow-up windows varied."
      - "The controlled-trials meta-analysis also preserved adverse-event and endpoint-specific limitations."
      - "Do not phrase this as settled efficacy across all diabetic foot ulcers."
  -
    claimId: "dfu-counterevidence-keeps-conclusion-mixed"
    type: "mixed_evidence"
    text: "The diabetic-foot-ulcer evidence is not uniformly positive: a modern sham-controlled trial found no significant difference for major-amputation criteria or complete healing, the DAMO2CLES multicenter ischemic-ulcer trial found no significant overall improvement in complete healing or limb salvage at 12 months, and a routine-practice cohort did not observe improved healing or amputation prevention."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-26740639"
      - "source_artifact:pmid-29074815"
      - "source_artifact:pmid-32040434"
      - "source_artifact:pmid-23423696"
      - "source_artifact:pmid-33500533"
    caveats:
      - "DAMO2CLES had substantial noncompletion in the HBOT arm."
      - "The cohort cannot prove a causal null effect because treatment selection and residual confounding remain plausible."
      - "Endpoint-specific results differ: major amputation, complete healing, limb salvage, minor amputation, mortality, and ulcer-area change should not be collapsed into one claim."
  -
    claimId: "wound-course-completion-is-interpretation-metadata"
    type: "design_guardrail"
    text: "A wound protocol page should treat course completion and objective oxygenation selection as part of interpretation: one trial reported a stronger healing signal among participants completing more than 35 sessions, a small randomized trial reported that at least 20 sessions were needed for effectiveness, DAMO2CLES highlighted noncompletion as a major feasibility issue, and TcPO2 appeared more informative than ABI or toe pressure for predicting healing after HBOT."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-20427683"
      - "source_artifact:pmid-28968346"
      - "source_artifact:pmid-29074815"
      - "source_artifact:pmid-20957342"
    caveats:
      - "These are not clean randomized dose-finding results."
      - "Adherence or completion signals may reflect feasibility and patient selection, not just treatment effect."
      - "Exact TcPO2 strata and healing counts were not fully recovered in the extraction."
  -
    claimId: "radiation-cystitis-clearest-late-radiation-signal"
    type: "intervention_result"
    text: "Radiation-induced hemorrhagic cystitis has the clearest direct late-radiation signal in this extraction: a 2024 cystitis meta-analysis reported 55% pooled complete hematuria remission and 500/556 patients (89.9%) with symptom improvement after HBOT, while RICH-ART found greater EPIC urinary total score improvement with HBOT than standard care (17.8 vs 7.7 points; between-group difference 10.1; P=.013)."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-39200867"
      - "source_artifact:pmid-31537473"
      - "source_artifact:pmid-24035333"
      - "source_artifact:pmid-9915420"
    caveats:
      - "The cystitis meta-analysis mainly synthesized nonrandomized studies with variable schedules and follow-up."
      - "RICH-ART used an open-label standard-care comparator rather than sham control."
      - "The RICH-ART primary endpoint was patient-reported urinary symptoms, not complete bleeding remission alone."
  -
    claimId: "radiation-proctitis-and-bowel-evidence-is-mixed"
    type: "mixed_evidence"
    text: "For radiation proctitis and lower-bowel injury, the page should present mixed evidence: the refractory-proctitis crossover trial reported improved healing with HBOT over control (absolute risk reduction 32%; NNT 3) and better bowel-bother quality of life before crossover, ASCRS guidance supports HBOT for reducing chronic radiation-proctitis bleeding, and cohorts report symptom or bleeding improvement, but the HOT2 sham-controlled phase 3 trial did not show a clear advantage for chronic bowel dysfunction after pelvic radiotherapy."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-18342453"
      - "source_artifact:pmid-30192320"
      - "source_artifact:pmid-24035333"
      - "source_artifact:pmid-17393937"
      - "source_artifact:pmid-26703894"
    caveats:
      - "The positive proctitis trial was a crossover design, while HOT2 was a sham-controlled phase 3 bowel-dysfunction trial with a different population and outcome frame."
      - "The ASCRS source is a guideline context source, not a primary trial."
      - "Do not collapse rectal bleeding, bowel quality of life, urgency, and heterogeneous chronic bowel dysfunction into one outcome."
  -
    claimId: "jaw-orn-should-not-borrow-pelvic-radiation-claims"
    type: "design_guardrail"
    text: "Do not use pelvic, bladder, or bowel late-radiation evidence to claim routine benefit for jaw or mandibular osteoradionecrosis: ORN guidelines discourage routine HBOT, ORN96 did not show better recovery or pain-relief timing with HBOT versus placebo, combined mandibular ORN randomized data did not show a significant healing advantage after surgery, and HOPON found routine prophylactic HBOT unnecessary for dental procedures in the irradiated mandible."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-38691821"
      - "source_artifact:pmid-28209748"
      - "source_artifact:pmid-15520052"
      - "source_artifact:pmid-34843843"
      - "source_artifact:pmid-30851351"
    caveats:
      - "Jaw ORN is an adjacent head-and-neck phenotype, not the same as pelvic bladder or bowel injury."
      - "Negative ORN findings should not be overgeneralized to cystitis or proctitis."
      - "Older ORN prophylaxis sources should stay historical or context-only unless a jaw-specific section is written."
  -
    claimId: "ssnhl-hbot-is-early-adjunctive-care"
    type: "design_guardrail"
    text: "For sudden sensorineural hearing loss, HBOT should be framed as clinician-supervised adjunctive care in early initial or salvage windows—usually alongside steroid or standard medical therapy—not as routine stand-alone or open-ended hearing optimization."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-22383545"
      - "source_artifact:pmid-31369359"
      - "source_artifact:pmid-41364864"
      - "source_artifact:pmid-23076907"
    caveats:
      - "Guidelines are consensus/context sources rather than primary efficacy trials."
      - "Timing windows differ across sources: the 2012 guideline was broader, the 2019 update is narrower, and meta-analyses emphasize early treatment."
  -
    claimId: "ssnhl-meta-analyses-lean-positive-but-heterogeneous"
    type: "intervention_result"
    text: "Systematic reviews and meta-analyses generally lean toward better hearing recovery when HBOT is added to medical or steroid therapy for acute idiopathic SSNHL, but the pooled signal is tempered by heterogeneous protocols, older or small trials, and inconsistent outcome definitions."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-30267033"
      - "source_artifact:pmid-40405024"
      - "source_artifact:pmid-40747804"
      - "source_artifact:pmid-34709348"
      - "source_artifact:pmid-15674964"
      - "source_artifact:pmid-23076907"
      - "source_artifact:pmid-16259656"
    caveats:
      - "Do not collapse pooled evidence into one optimized pressure, session count, or duration."
      - "Some older reviews judged clinical significance and trial quality uncertain."
      - "This is SSNHL-specific and should not be generalized to tinnitus-only or wellness contexts."
  -
    claimId: "ssnhl-direct-studies-are-not-uniform"
    type: "mixed_evidence"
    text: "Direct studies are not uniformly positive: some cohorts or older studies report benefit or slight/significant improvement with HBOT, while several contemporary cohorts found no statistically significant average advantage over steroid-based care alone."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-31865663"
      - "source_artifact:pmid-37475734"
      - "source_artifact:pmid-35952529"
      - "source_artifact:pmid-37693762"
      - "source_artifact:pmid-38974601"
      - "source_artifact:pmid-30380530"
      - "source_artifact:pmid-14586625"
      - "source_artifact:pmid-15547420"
      - "source_artifact:pmid-25813083"
    caveats:
      - "Studies vary by severity, timing, steroid protocol, comparator, and outcome window."
      - "Several positive studies are observational or older treatment-era sources."
      - "Null average effects do not rule out early-window or subgroup benefit."
  -
    claimId: "tinnitus-claims-stay-separate"
    type: "evidence_scope"
    text: "Tinnitus-adjacent sources should not be merged into the SSNHL claim set: evidence mentioning tinnitus mainly supports acute ISSNHL boundaries, while tinnitus-focused HBOT literature is population-mismatched and does not support chronic tinnitus or late tinnitus-focused protocol claims."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-15674964"
      - "source_artifact:pmid-23076907"
      - "source_artifact:pmid-16259656"
      - "source_artifact:pmid-18225611"
    caveats:
      - "Tinnitus can occur alongside acute SSNHL, but that is not the same as treating chronic tinnitus as the protocol target."
      - "The tinnitus-specific source was extracted as adjacent/context-only, not direct protocol support."
  -
    claimId: "acute-emergent-hbot-is-hospital-only-evidence"
    type: "evidence_scope"
    text: "Evidence for decompression illness, gas embolism, acute carbon monoxide poisoning, and severe traumatic ischemia should be framed as hospital-only HBOT evidence: the extracted sources describe emergency diagnosis, oxygen or transport logistics, chamber referral, severe-feature triage, or surgical trauma pathways rather than self-directed HBOT."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-30028914"
      - "source_artifact:pmid-35353963"
      - "source_artifact:pmid-34867135"
      - "source_artifact:pmid-23087025"
      - "source_artifact:pmid-26068515"
      - "source_artifact:pmid-38386077"
    caveats:
      - "This is a scope and boundary claim, not a unified efficacy claim."
      - "Do not generalize these emergency indications to wellness, recovery, longevity, or mild elective HBOT use."
  -
    claimId: "acute-carbon-monoxide-evidence-is-mixed"
    type: "mixed_evidence"
    text: "Acute carbon monoxide poisoning evidence is genuinely mixed: some randomized trials reported fewer delayed or cognitive sequelae with HBOT, while other randomized trials were null or negative, the Cochrane synthesis found no statistically clear pooled neurologic advantage at 4–6 weeks, and the 2026 meta-analysis concluded that efficacy remains unproven."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-41624627"
      - "source_artifact:pmid-21491385"
      - "source_artifact:pmid-16180928"
      - "source_artifact:pmid-7710151"
      - "source_artifact:pmid-12362006"
      - "source_artifact:pmid-10092916"
      - "source_artifact:pmid-2569600"
      - "source_artifact:pmid-21125215"
      - "source_artifact:pmid-37708067"
      - "source_artifact:pmid-34143855"
    caveats:
      - "This does not mean HBOT never helps in acute CO poisoning."
      - "Trial protocols, pressures, session counts, exposure severity, blinding, follow-up, and outcome definitions vary."
      - "Guidelines may still recommend HBOT consideration for selected severe presentations despite uncertain pooled efficacy."
  -
    claimId: "traumatic-ischemia-evidence-has-supportive-but-mixed-signals"
    type: "mixed_evidence"
    text: "For severe lower-limb trauma, crush injury, and acute traumatic ischemia, direct supervised evidence has supportive signals for tissue necrosis, additional surgery, late complications, and delayed fracture union, but certainty remains moderate at best because the HOLLT primary composite endpoint was neutral, the classic crush-injury trial was very small, and reviews describe sparse or heterogeneous evidence."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-38386077"
      - "source_artifact:pmid-24343585"
      - "source_artifact:pmid-36100927"
      - "source_artifact:pmid-8760546"
    caveats:
      - "This is severe acute trauma and surgical limb-salvage evidence, not a recovery or wellness indication."
      - "The HOLLT primary endpoint was not statistically significant even though secondary outcomes favored HBOT."
      - "Small trial and review-level positive signals should not be overclaimed."
  -
    claimId: "healthy-aging-is-off-label-research-context"
    type: "design_guardrail"
    text: "Healthy-aging, longevity, cognition-enhancement, physical-performance, telomere, senescence, aesthetic, and dementia-adjacent HBOT uses should be kept in a distinct off-label or research-context lane rather than presented as established clinical HBOT indications."
    strength: "high"
    sourceKeys:
      - "source_artifact:uhms-hbo-indications-2020-01-01"
      - "source_artifact:pmid-28357821"
      - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
      - "source_artifact:pmid-38356446"
      - "source_artifact:pmid-39733047"
    caveats:
      - "Guideline and regulatory sources define boundaries and indication classes; they are not efficacy trials."
      - "Aesthetic and anti-aging reviews were classified as adjacent/context-only sources, not direct healthy-aging efficacy evidence."
      - "No extraction classification is being overruled: direct claims rely on direct_protocol sources; adjacent_variant, background, and same_mechanism sources stay fenced."
  -
    claimId: "healthy-older-adult-cognition-study-positive-signal"
    type: "intervention_result"
    text: "One small direct older-adult trial reported that 60 HBOT sessions over 3 months improved global cognition in 63 healthy adults older than 64 years, with the clearest domain gains in attention and information processing speed and increased regional cerebral blood flow in frontal and parietal regions."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-32589613"
    caveats:
      - "Small single-center sample."
      - "Comparator was a control arm rather than a fully convincing sham-chamber protocol in the accessible extraction."
      - "Healthy older adults do not automatically represent younger users, dementia patients, or broader wellness populations."
  -
    claimId: "cognition-benefit-should-not-be-promised-broadly"
    type: "mixed_evidence"
    text: "Cognition should not be promised broadly: the cognition systematic review found heterogeneous human evidence, a 155-participant double-blind sham-controlled trial in older adults with type 2 diabetes and MCI did not clearly favor HBOT over sham on primary cognitive or brain-imaging outcomes, and an older impaired-elderly oxygen trial found no superiority over air controls."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-33847854"
      - "source_artifact:pmid-41434344"
      - "source_artifact:pmid-619839"
    caveats:
      - "The 155-participant diabetic-MCI result was extracted from abstract-like accessible material rather than a fully detailed report."
      - "The diabetic-MCI cohort is high-risk and disease-adjacent, not a general healthy-aging population."
      - "The older impaired-elderly oxygen trial used older methods and diagnostic framing."
  -
    claimId: "older-adult-physical-performance-study-positive-signal"
    type: "intervention_result"
    text: "One small direct older-adult physical-performance trial reported that 60 daily HBOT sessions over 12 weeks improved aerobic fitness in 63 sedentary adults older than 64 years, including VO2max/kg increase of 1.91 ± 3.29 mL/kg/min versus control and VO2 at first ventilatory threshold increase of 160.03 ± 155.35 mL/min, with cardiac perfusion changes consistent with the performance signal."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-38961397"
    caveats:
      - "Small single-center study."
      - "Comparator details in the accessible extraction were less rigorous than a full sham-chamber mimic."
      - "Sedentary adults older than 64 years may not generalize to athletes, younger adults, or clinical populations."
  -
    claimId: "telomere-and-immunosenescence-are-biomarker-only"
    type: "mechanistic"
    text: "A 35-person uncontrolled prospective study in independently living older adults reported telomere-length increases greater than 20% in several immune-cell subsets, including B-cell telomere increase up to 37.63% after treatment, along with reduced immunosenescence markers after a 60-session HBOT course; this is a blood-cell biomarker signal, not proof of clinical anti-aging or longer healthspan."
    strength: "low"
    sourceKeys:
      - "source_artifact:pmid-33206062"
    caveats:
      - "No control group."
      - "Short follow-up after treatment."
      - "Biomarker endpoints are not clinical outcomes and do not establish rejuvenation, disease prevention, or longevity."
  -
    claimId: "pipeline-registries-are-not-current-benefit-proof"
    type: "evidence_scope"
    text: "Registry-only and ongoing studies in epigenetic aging, healthy-adult VO2max/inflammation, diabetic-MCI cognition, MCI, and prodromal Alzheimer’s disease are useful for horizon scanning and endpoint selection, but they should not support current benefit claims until results are published and extracted."
    strength: "high"
    sourceKeys:
      - "source_artifact:clinicaltrialsgov-nct05297019-hbot-epigenetic-aging-2026-04-23"
      - "source_artifact:clinicaltrialsgov-nct07361861-hbot-vo2max-inflammation-2026-04-23"
      - "source_artifact:clinicaltrialsgov-nct03036254-hbot-cognition-diabetic-elderly-2026-04-23"
      - "source_artifact:clinicaltrialsgov-nct02085330-hbot-mild-cognitive-impairment-2026-04-23"
      - "source_artifact:clinicaltrialsgov-nct05349318-hbot-prodromal-alzheimers-cvd-2026-04-23"
    caveats:
      - "Registry metadata is not a substitute for peer-reviewed outcomes."
      - "Some registry details were incomplete in the accessible extraction."
      - "Protocol pages can mention these as future evidence watchlist items, not as current proof."
  -
    claimId: "untreated-pneumothorax-and-relative-contraindications"
    type: "safety"
    text: "Untreated pneumothorax is the main absolute contraindication extracted. Relative contraindications or cautions requiring individualized clinician review include pulmonary blebs or bullae, COPD or asthma, thoracic surgery history, ear or sinus equalization problems, acute upper-respiratory infection, fever or epilepsy/seizure-threshold issues, acute hypoglycemia or diabetes risk, pregnancy context, intraocular gas, implanted devices requiring pressure testing, vasoconstrictor exposures such as nicotine or caffeine, and selected chemotherapy or related drugs including doxorubicin, bleomycin, cisplatin, disulfiram, and mafenide."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-32491593"
      - "source_artifact:pmid-32809708"
      - "source_artifact:pmid-36100931"
      - "source_artifact:pmid-29083713"
    caveats:
      - "The contraindication source is a narrative clinical review; not all relative contraindications have equally strong quantitative risk evidence."
      - "Routine pulmonary imaging was described as low value in low-risk asymptomatic patients; the extracted recommendation favors risk-based pulmonary screening rather than universal imaging."
  -
    claimId: "adverse-event-burden-varies-by-denominator-and-dose"
    type: "safety"
    text: "Adverse events are not rare in HBOT literature, but the apparent rate depends strongly on denominator, protocol, indication mix, and reporting method. A meta-analysis of 24 RCTs reported more adverse effects with HBOT than control, 30.11% versus 10.43%, and found higher adverse-effect frequency with more than 10 sessions or pressure above 2.0 ATA; cohort data ranged from 0.68% of treatments in a large outpatient registry to 17.4% of patients in a single-center cohort."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-37275378"
      - "source_artifact:pmid-28198743"
      - "source_artifact:pmid-27265988"
    caveats:
      - "The RCT meta-analysis combined mixed indications and protocols with heterogeneous adverse-event reporting."
      - "Registry treatment-level rates should not be compared directly with patient-level rates."
  -
    claimId: "ear-sinus-barotrauma-is-dominant-common-risk"
    type: "safety"
    text: "Ear and sinus pressure problems are the dominant common adverse-event category. Extracted sources report otalgia as the most common side effect in modern monoplace HBOT, otologic adverse events in roughly 15% across an otology systematic review, middle-ear barotrauma around 9.2% in large cohort/review data, and higher risk with poor equalization, respiratory congestion, ENT history, head and neck pathology, sensory neuropathy, older age, and female sex. Severe outcomes such as tympanic membrane rupture occur but most middle-ear barotrauma was described as mild."
    strength: "high"
    sourceKeys:
      - "source_artifact:pmid-39597979"
      - "source_artifact:pmid-41429031"
      - "source_artifact:pmid-31051054"
      - "source_artifact:pmid-10685584"
      - "source_artifact:pmid-29054767"
      - "source_artifact:pmid-1443845"
      - "source_artifact:pmid-9525511"
      - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
    caveats:
      - "Event ascertainment and grading varied across studies."
      - "One prophylactic oxymetazoline trial found no clear prevention benefit, so the protocol should not imply that decongestants reliably prevent barotrauma."
      - "Tympanostomy tubes may enable pressure management in selected patients but have their own complication burden."
  -
    claimId: "oxygen-toxicity-seizures-and-pulmonary-risk"
    type: "safety"
    text: "Oxygen-toxicity seizures are rare under monitored protocols but should remain a stop-rule and screening concern. Large cohorts/audits reported two seizures in 80,679 patient-treatments, seven seizures across 62,614 sessions with only one clearly oxygen-toxicity-attributed event, and 0.024% seizure incidence per treatment at 243 kPa; extracted risk-factor sources also flagged opiate use, CNS disease, hypercapnia, withdrawal, alcohol dependence, and interacting medications as possible seizure-threshold modifiers. Modern monitored spirometry cohorts found no significant pulmonary-function decline over prolonged courses, but this does not remove the need to screen for pneumothorax or pulmonary barotrauma risk."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-15559001"
      - "source_artifact:pmid-27000010"
      - "source_artifact:pmid-29888378"
      - "source_artifact:pmid-24377194"
      - "source_artifact:pmid-10685584"
      - "source_artifact:pmid-31409407"
      - "source_artifact:pmid-37256885"
      - "source_artifact:pmid-32491593"
    caveats:
      - "Incidence estimates differ by pressure, protocol, population, and whether rates are reported per session, per treatment, or per patient."
      - "Risk-factor evidence includes small case series and retrospective audits."
      - "Stable spirometry is not the same as absence of pneumothorax or barotrauma risk."
  -
    claimId: "vision-and-lens-effects-need-counseling"
    type: "safety"
    text: "Transient visual or refractive change is a plausible and sometimes common effect of longer HBOT courses. In a 40-treatment cohort, 77.6% of eyes developed at least a 0.5 D myopic shift by treatment end and most refractive change moved back toward baseline by 12 weeks; another cohort found at least a two-line visual-acuity decline in 28% of patients, with cataracts or prior head and neck radiation associated with higher risk. Very high cumulative exposure and a case report link HBOT to nuclear cataract or persistent lens changes, so the page should not promise that every vision change is transient."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-30690920"
      - "source_artifact:pmid-27416689"
      - "source_artifact:pmid-28613605"
      - "source_artifact:pmid-6691953"
      - "source_artifact:pmid-18251434"
      - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
    caveats:
      - "Ocular cohorts were small or retrospective, and very prolonged exposure data may exceed common modern course length."
      - "Long-term cataract incidence after standard courses remains uncertain."
      - "People with baseline cataracts or prior head and neck radiation may not match lower-risk patients."
  -
    claimId: "claustrophobia-and-treatment-intolerance-need-screening"
    type: "safety"
    text: "Claustrophobia, confinement anxiety, and treatment intolerance should be explicit screening and stop-rule items. Registry extraction ranked confinement anxiety among common outpatient events, a carbon-monoxide RCT reported anxiety in 7 of 76 HBOT patients and four sessions stopped for ear equalization difficulty, and a clinical complications review includes claustrophobia or anxiety among the main complication domains."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-28198743"
      - "source_artifact:pmid-12362006"
      - "source_artifact:pmid-29083713"
      - "source_artifact:pmid-27265988"
    caveats:
      - "Anxiety and claustrophobia were not uniformly defined across sources."
      - "The carbon-monoxide RCT was an acute/emergent indication, so its anxiety rate may not generalize to elective outpatient use."
  -
    claimId: "cardiovascular-and-metabolic-status-modify-risk"
    type: "safety"
    text: "Cardiovascular and metabolic status should be part of relative-risk screening. Extracted cohort data found acute post-session blood-pressure increases, averaging about +16.2 mmHg in hypertensive sessions versus +6.0 mmHg in normotensive sessions; diabetes-session data found hypoglycemia at or below 70 mg/dL in 1.5% of sessions, with type 1 diabetes and lower starting glucose increasing risk; and a small heart-failure cohort found that 21 of 23 optimized patients completed HBOT but 2 experienced HBOT-related exacerbation or pulmonary edema."
    strength: "moderate"
    sourceKeys:
      - "source_artifact:pmid-33086495"
      - "source_artifact:pmid-26152103"
      - "source_artifact:pmid-38330042"
    caveats:
      - "These are observational subgroup or session-level findings."
      - "Heart-failure evidence is small and should support clinician-guidance language rather than a blanket absolute exclusion."
      - "Blood-pressure change data do not establish long-term cardiovascular outcomes."
  -
    claimId: "fire-and-device-hazards-are-catastrophic-boundaries"
    type: "design_guardrail"
    text: "Fire and device hazards are rare but catastrophic safety boundaries. Chamber-fire sources link fatal events to oxygen-enriched atmospheres, combustible or prohibited items, ignition/electrical sources, equipment or power failures, inadequate training, and procedure violations. Device/procedure compatibility must be assessed before chamber entry; limited CIED data are reassuring only within tested conditions, and monoplace in-chamber defibrillation was extracted as strictly contraindicated."
    strength: "high"
    sourceKeys:
      - "source_artifact:fda-safe-use-hbot-devices-2025-08-25"
      - "source_artifact:uhms-clinical-hyperbaric-facility-accreditation-manual-2018-06-04"
      - "source_artifact:nfpa-hyperbaric-facilities-fire-protection-2021-08-22"
      - "source_artifact:doi-10-2478-phr-2023-0020"
      - "source_artifact:pmid-9308138"
      - "source_artifact:pmid-25596835"
      - "source_artifact:pmid-39139862"
      - "source_artifact:pmid-41364865"
    caveats:
      - "Fire sources are incident reviews and guidance documents, not denominator-based modern incidence studies."
      - "CIED evidence was very small and did not cover all device models or defibrillation scenarios."
      - "The protocol page should use mandatory safety-control language, not reassurance based on rarity alone."
researchLandscape:
  bottomLine: "HBOT is best represented as a high-caution, clinician-supervised medical therapy with indication-specific evidence, not as a general wellness or longevity protocol."
  confidenceLabel: "mixed"
  primaryClaim: "The most defensible Murph page is a tracking wrapper for prescribed systemic chamber HBOT: it can document dose fidelity, supervision, tolerability, and adverse events while keeping efficacy claims tied to specific clinical indications."
  mainCaveat: "Evidence strength varies sharply by indication and comparator; adjacent oxygen variants and commercial wellness claims should not inherit systemic clinical HBOT evidence."
  groups:

    -
      id: "clinical-hbot-definition-and-supervision"
      label: "Clinical HBOT definition and supervision boundary"
      stance: "safety_boundary"
      summary: "Whole-body chamber HBOT with explicit oxygen/pressure dosing and facility supervision is the canonical protocol boundary. Supervision, credentialing, device controls, and fire-safety systems are part of the intervention rather than optional extras."
      sourceKeys:
        - "source_artifact:cms-ncd-20-29-hyperbaric-oxygen-2017-11-17"
        - "source_artifact:fda-safe-use-hbot-devices-2025-08-25"
        - "source_artifact:nbdhmt-physician-attendance-supervision-2013-07-01"
        - "source_artifact:pmid-15881548"
        - "source_artifact:pmid-38092370"
        - "source_artifact:pmid-38985156"
        - "source_artifact:uhms-clinical-hyperbaric-facility-accreditation-manual-2018-06-04"
        - "source_artifact:uhms-credentialing-privileging-supervision-2023-07-03"
        - "source_artifact:uhms-hbo-indications-2020-01-01"
      defaultOpen: true
    -
      id: "dose-and-course-implementation"
      label: "Dose, chamber, air-break, and course metadata"
      stance: "safety_boundary"
      summary: "The research corpus does not support one universal wellness dose. Murph should log the prescribed pressure units, oxygen fraction, chamber type, session duration, air breaks, planned course, completed sessions, and supervision status."
      sourceKeys:
        - "source_artifact:clinicaltrialsgov-nct07361861-hbot-vo2max-inflammation-2026-04-23"
        - "source_artifact:doi-10-22462-07-08-2018-15"
        - "source_artifact:pmid-24260334"
        - "source_artifact:pmid-29734566"
        - "source_artifact:pmid-29888378"
        - "source_artifact:pmid-31409407"
        - "source_artifact:pmid-37834897"
        - "source_artifact:pmid-40228859"
        - "source_artifact:pmid-40969214"
        - "source_artifact:pmid-41624627"
      defaultOpen: true
    -
      id: "diabetic-foot-and-problem-wounds"
      label: "Selected diabetic-foot and problem-wound evidence"
      stance: "mixed"
      summary: "Selected diabetic-foot-ulcer evidence contains guideline-supported referral lanes and favorable synthesis signals, but sham-controlled, multicenter, and real-world counterevidence prevent a generic “HBOT heals wounds” claim."
      sourceKeys:
        - "source_artifact:pmid-20427683"
        - "source_artifact:pmid-26152105"
        - "source_artifact:pmid-26740639"
        - "source_artifact:pmid-28968346"
        - "source_artifact:pmid-29074815"
        - "source_artifact:pmid-32040434"
        - "source_artifact:pmid-32176450"
        - "source_artifact:pmid-33500533"
        - "source_artifact:pmid-34376365"
        - "source_artifact:pmid-37232034"
      defaultOpen: true
    -
      id: "late-radiation-injury"
      label: "Late radiation injury is phenotype-specific"
      stance: "mixed"
      summary: "Radiation cystitis is the clearest positive late-radiation lane, lower-bowel injury is mixed, soft-tissue radionecrosis remains lower-certainty, and jaw osteoradionecrosis should not borrow pelvic/bladder evidence."
      sourceKeys:
        - "source_artifact:pmid-15520052"
        - "source_artifact:pmid-18342453"
        - "source_artifact:pmid-24035333"
        - "source_artifact:pmid-28209748"
        - "source_artifact:pmid-30192320"
        - "source_artifact:pmid-31537473"
        - "source_artifact:pmid-34843843"
        - "source_artifact:pmid-38691821"
        - "source_artifact:pmid-39200867"
        - "source_artifact:pmid-9915420"
      defaultOpen: true
    -
      id: "acute-emergency-indications"
      label: "Acute and emergency indications"
      stance: "mixed"
      summary: "Decompression illness, gas embolism, carbon monoxide poisoning, crush injury, and traumatic ischemia belong in hospital/emergency pathways. The carbon-monoxide RCT base is internally conflicting, and traumatic-ischemia evidence is supportive but small and heterogeneous."
      sourceKeys:
        - "source_artifact:pmid-16180928"
        - "source_artifact:pmid-21491385"
        - "source_artifact:pmid-23087025"
        - "source_artifact:pmid-24343585"
        - "source_artifact:pmid-30028914"
        - "source_artifact:pmid-34867135"
        - "source_artifact:pmid-35353963"
        - "source_artifact:pmid-36100927"
        - "source_artifact:pmid-37708067"
        - "source_artifact:pmid-38386077"
        - "source_artifact:pmid-41624627"
    -
      id: "ent-and-ssnhl"
      label: "ENT and sudden sensorineural hearing loss"
      stance: "mixed"
      summary: "Sudden sensorineural hearing loss is an early adjunctive-care lane, not an open-ended hearing-optimization protocol. Meta-analyses lean positive, but primary studies and salvage comparisons are heterogeneous and otologic safety is central."
      sourceKeys:
        - "source_artifact:pmid-22383545"
        - "source_artifact:pmid-30267033"
        - "source_artifact:pmid-31051054"
        - "source_artifact:pmid-31369359"
        - "source_artifact:pmid-31865663"
        - "source_artifact:pmid-37475734"
        - "source_artifact:pmid-40405024"
        - "source_artifact:pmid-40747804"
        - "source_artifact:pmid-41429031"
    -
      id: "healthy-aging-neurocognitive-and-performance-claims"
      label: "Healthy-aging, neurocognitive, and performance claims"
      stance: "mixed"
      summary: "Small older-adult HBOT studies and biomarker studies are promising but endpoint-specific. They do not justify broad age-reversal, dementia-prevention, cognition-optimization, or performance-recovery claims; registry-only studies are horizon scanning only."
      sourceKeys:
        - "source_artifact:clinicaltrialsgov-nct05297019-hbot-epigenetic-aging-2026-04-23"
        - "source_artifact:clinicaltrialsgov-nct07361861-hbot-vo2max-inflammation-2026-04-23"
        - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
        - "source_artifact:pmid-32589613"
        - "source_artifact:pmid-33206062"
        - "source_artifact:pmid-33847854"
        - "source_artifact:pmid-38961397"
        - "source_artifact:pmid-41434344"
        - "source_artifact:uhms-hbo-indications-2020-01-01"
    -
      id: "adjacent-oxygen-variants"
      label: "Adjacent oxygen and hyperbaric variants"
      stance: "context_only"
      summary: "Mild/soft chambers, topical oxygen, normobaric oxygen, and exercise-with-oxygen protocols may have their own evidence, but they are separate modalities and should not be treated as clinical systemic HBOT evidence."
      sourceKeys:
        - "source_artifact:ama-oppose-unsafe-mild-hyperbaric-therapy-2022-06-01"
        - "source_artifact:cms-topical-oxygen-decision-memo-2017-04-03"
        - "source_artifact:doi-10-22462-05-06-2018-15"
        - "source_artifact:doi-10-22462-07-08-2018-15"
        - "source_artifact:eubs-mild-hyperbaric-therapies-2022-12-20"
        - "source_artifact:fda-topical-oxygen-chamber-extremities-guidance-2018-06-28"
        - "source_artifact:pmid-17443585"
        - "source_artifact:pmid-31062232"
        - "source_artifact:pmid-31084683"
        - "source_artifact:pmid-32961816"
    -
      id: "safety-contraindications-and-adverse-events"
      label: "Safety, contraindications, and adverse events"
      stance: "safety_boundary"
      summary: "Safety is stronger than efficacy for a runnable Murph page: untreated pneumothorax, pulmonary/ENT/seizure/glucose/pregnancy/device/medication risks, barotrauma, vision changes, confinement intolerance, oxygen-toxicity seizure, cardiometabolic changes, and fire/device hazards must remain explicit."
      sourceKeys:
        - "source_artifact:nfpa-hyperbaric-facilities-fire-protection-2021-08-22"
        - "source_artifact:pmid-26152103"
        - "source_artifact:pmid-28198743"
        - "source_artifact:pmid-29083713"
        - "source_artifact:pmid-30690920"
        - "source_artifact:pmid-32491593"
        - "source_artifact:pmid-32809708"
        - "source_artifact:pmid-36100931"
        - "source_artifact:pmid-37275378"
        - "source_artifact:pmid-39597979"
        - "source_artifact:pmid-41429031"
      defaultOpen: true
    -
      id: "acute_and_emergent_indications"
      label: "Acute And Emergent Indications"
      stance: "mixed"
      summary: "Key randomized trial frequently cited because it contributes mixed or negative evidence within the CO poisoning literature. Also surfaced in shard(s): adjacent-modalities-and-external-claims. Canonicalized on PMID 10092916 / DOI 10.5694/j.1326-5377.1999.tb140318.x. Shard directness guesses differed; shard claim-use guesses differed. Foundational clinical series linking early chamber treatment to outcomes after cerebral air embolism. The Acute And Emergent Indications group currently links 37 appraisal-backed sources with clinical supervised scope and no clear advantage, positive, not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-10092916"
        - "source_artifact:pmid-12029402"
        - "source_artifact:pmid-12362006"
        - "source_artifact:pmid-15615503"
        - "source_artifact:pmid-16022014"
        - "source_artifact:pmid-16180928"
        - "source_artifact:pmid-18679118"
        - "source_artifact:pmid-21125215"
        - "source_artifact:pmid-21215883"
        - "source_artifact:pmid-21491385"
        - "source_artifact:pmid-22908841"
        - "source_artifact:pmid-23087025"
        - "source_artifact:pmid-24343585"
        - "source_artifact:pmid-25167083"
        - "source_artifact:pmid-2569600"
        - "source_artifact:pmid-26068515"
        - "source_artifact:pmid-27044457"
        - "source_artifact:pmid-28427969"
        - "source_artifact:pmid-29629990"
        - "source_artifact:pmid-30028914"
        - "source_artifact:pmid-30203491"
        - "source_artifact:pmid-31683367"
        - "source_artifact:pmid-34074856"
        - "source_artifact:pmid-34143855"
        - "source_artifact:pmid-34867135"
        - "source_artifact:pmid-35353963"
        - "source_artifact:pmid-36100927"
        - "source_artifact:pmid-37434172"
        - "source_artifact:pmid-37708067"
        - "source_artifact:pmid-38386077"
        - "source_artifact:pmid-40249721"
        - "source_artifact:pmid-40249722"
        - "source_artifact:pmid-41624627"
        - "source_artifact:pmid-7069921"
        - "source_artifact:pmid-7710151"
        - "source_artifact:pmid-8329940"
        - "source_artifact:pmid-8760546"
    -
      id: "adjacent_modalities_and_external_claims"
      label: "Adjacent Modalities And External Claims"
      stance: "context_only"
      summary: "Representative clinic marketing page tying direct HBOT aging studies to premium anti-aging claims. Excluded from extraction; keep only for audit or why-excluded context. Professional society statement directly addressing the common misuse of the term 'topical hyperbaric oxygen'. The Adjacent Modalities And External Claims group currently links 20 appraisal-backed sources with direct protocol, adjacent variant, general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:avivclinics-reverse-biological-aging-2025-11-26"
        - "source_artifact:doi-10-22462-05-06-2018-15"
        - "source_artifact:eubs-mild-hyperbaric-therapies-2022-12-20"
        - "source_artifact:ewot-benefits-of-exercise-with-oxygen-therapy-2020-12-23"
        - "source_artifact:fda-hbot-get-the-facts-2021-07-26"
        - "source_artifact:oxyhealth-benefits-of-mild-hyperbaric-wellness-2020-10-02"
        - "source_artifact:pmid-17443585"
        - "source_artifact:pmid-19284641"
        - "source_artifact:pmid-20456243"
        - "source_artifact:pmid-26709672"
        - "source_artifact:pmid-29607850"
        - "source_artifact:pmid-31619393"
        - "source_artifact:pmid-32176450"
        - "source_artifact:pmid-3289861"
        - "source_artifact:pmid-32961816"
        - "source_artifact:pmid-33979229"
        - "source_artifact:pmid-38522472"
        - "source_artifact:pmid-41106558"
        - "source_artifact:restore-mild-hyperbaric-oxygen-therapy-2026-04-23"
        - "source_artifact:sol-exercise-with-oxygen-therapy-2026-04-23"
    -
      id: "ent_and_sudden_sensorineural_hearing_loss"
      label: "ENT And Sudden Sensorineural Hearing Loss"
      stance: "mixed"
      summary: "Direct randomized multicentre registry entry that may become a pivotal future source once results post. Registry record; link to later publications if matched, but do not merge blindly. Early direct clinical HBOT study frequently cited in later evidence syntheses. The ENT And Sudden Sensorineural Hearing Loss group currently links 38 appraisal-backed sources with clinical supervised, adjacent variant, general guideline scope and not efficacy evidence, positive, mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrialsregister-sudho-2021-06-25"
        - "source_artifact:pmid-11817844"
        - "source_artifact:pmid-11870340"
        - "source_artifact:pmid-14586625"
        - "source_artifact:pmid-15547420"
        - "source_artifact:pmid-15674964"
        - "source_artifact:pmid-16151333"
        - "source_artifact:pmid-16259656"
        - "source_artifact:pmid-18225611"
        - "source_artifact:pmid-21414179"
        - "source_artifact:pmid-22383545"
        - "source_artifact:pmid-23076907"
        - "source_artifact:pmid-23820795"
        - "source_artifact:pmid-25318685"
        - "source_artifact:pmid-25813083"
        - "source_artifact:pmid-26513946"
        - "source_artifact:pmid-30267033"
        - "source_artifact:pmid-30324404"
        - "source_artifact:pmid-30380530"
        - "source_artifact:pmid-30938564"
        - "source_artifact:pmid-31369359"
        - "source_artifact:pmid-31865663"
        - "source_artifact:pmid-32574438"
        - "source_artifact:pmid-34100745"
        - "source_artifact:pmid-34172651"
        - "source_artifact:pmid-34709348"
        - "source_artifact:pmid-35434316"
        - "source_artifact:pmid-35548932"
        - "source_artifact:pmid-35952529"
        - "source_artifact:pmid-36693145"
        - "source_artifact:pmid-37475734"
        - "source_artifact:pmid-37693762"
        - "source_artifact:pmid-38197374"
        - "source_artifact:pmid-38974601"
        - "source_artifact:pmid-40405024"
        - "source_artifact:pmid-40747804"
        - "source_artifact:pmid-41364864"
        - "source_artifact:pmid-8191053"
    -
      id: "healthy_aging_longevity_and_off_label_wellness"
      label: "Healthy Aging Longevity And Off Label Wellness"
      stance: "mixed"
      summary: "Older registry-only MCI study that may explain gaps between published and unpublished evidence. Registry record; link to later publications if matched, but do not merge blindly. Registry counterpart for the major diabetic-MCI cognition program, useful for design and completion tracking. Registry record; link to later publications if matched, but do not merge blindly. The Healthy Aging Longevity And Off Label Wellness group currently links 33 appraisal-backed sources with clinical supervised, adjacent variant, same mechanism scope and not efficacy evidence, positive, no clear advantage interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:clinicaltrialsgov-nct02085330-hbot-mild-cognitive-impairment-2026-04-23"
        - "source_artifact:clinicaltrialsgov-nct03036254-hbot-cognition-diabetic-elderly-2026-04-23"
        - "source_artifact:clinicaltrialsgov-nct05297019-hbot-epigenetic-aging-2026-04-23"
        - "source_artifact:clinicaltrialsgov-nct05349318-hbot-prodromal-alzheimers-cvd-2026-04-23"
        - "source_artifact:clinicaltrialsgov-nct07361861-hbot-vo2max-inflammation-2026-04-23"
        - "source_artifact:pmid-22786527"
        - "source_artifact:pmid-31057392"
        - "source_artifact:pmid-31134827"
        - "source_artifact:pmid-32296731"
        - "source_artifact:pmid-32548235"
        - "source_artifact:pmid-32589613"
        - "source_artifact:pmid-33206062"
        - "source_artifact:pmid-33847854"
        - "source_artifact:pmid-33935095"
        - "source_artifact:pmid-34499614"
        - "source_artifact:pmid-34680155"
        - "source_artifact:pmid-34784294"
        - "source_artifact:pmid-34818212"
        - "source_artifact:pmid-34887780"
        - "source_artifact:pmid-35133516"
        - "source_artifact:pmid-35649312"
        - "source_artifact:pmid-35821996"
        - "source_artifact:pmid-35822043"
        - "source_artifact:pmid-35968296"
        - "source_artifact:pmid-37409020"
        - "source_artifact:pmid-38356446"
        - "source_artifact:pmid-38577491"
        - "source_artifact:pmid-38961397"
        - "source_artifact:pmid-39733047"
        - "source_artifact:pmid-40784513"
        - "source_artifact:pmid-41434344"
        - "source_artifact:pmid-4897016"
        - "source_artifact:pmid-619839"
    -
      id: "identity_boundary_supervision_and_variant_separation"
      label: "Identity Boundary Supervision And Variant Separation"
      stance: "safety_boundary"
      summary: "Mechanistic wound-oxygen review that helps separate oxygen-biology context from direct HBOT protocol evidence. Foundational review on ICU-relevant HBOT use that can support context around higher-acuity program requirements. The Identity Boundary Supervision And Variant Separation group currently links 36 appraisal-backed sources with same mechanism, general guideline, direct protocol scope and not efficacy evidence, positive interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:ama-oppose-unsafe-mild-hyperbaric-therapy-2022-06-01"
        - "source_artifact:cms-hypoxic-diabetic-wounds-decision-memo-2002-08-30"
        - "source_artifact:cms-ncd-20-29-hyperbaric-oxygen-2017-11-17"
        - "source_artifact:cms-topical-oxygen-decision-memo-2017-04-03"
        - "source_artifact:doi-10-22462-07-08-2018-15"
        - "source_artifact:fda-topical-oxygen-chamber-extremities-guidance-2018-06-28"
        - "source_artifact:nbdhmt-physician-attendance-supervision-2013-07-01"
        - "source_artifact:pmid-15881548"
        - "source_artifact:pmid-20394633"
        - "source_artifact:pmid-21460713"
        - "source_artifact:pmid-23756299"
        - "source_artifact:pmid-24189086"
        - "source_artifact:pmid-25003636"
        - "source_artifact:pmid-25596836"
        - "source_artifact:pmid-25647433"
        - "source_artifact:pmid-25649892"
        - "source_artifact:pmid-25964038"
        - "source_artifact:pmid-25964039"
        - "source_artifact:pmid-28301358"
        - "source_artifact:pmid-28357821"
        - "source_artifact:pmid-31062232"
        - "source_artifact:pmid-31084683"
        - "source_artifact:pmid-33871095"
        - "source_artifact:pmid-34577787"
        - "source_artifact:pmid-34577840"
        - "source_artifact:pmid-35593010"
        - "source_artifact:pmid-38092370"
        - "source_artifact:pmid-38358163"
        - "source_artifact:pmid-38615347"
        - "source_artifact:pmid-38648247"
        - "source_artifact:pmid-38985156"
        - "source_artifact:pmid-39822713"
        - "source_artifact:uhms-credentialing-privileging-supervision-2023-07-03"
        - "source_artifact:uhms-hbo-indications-2020-01-01"
        - "source_artifact:uhms-hbo-indications-2020-05-04"
        - "source_artifact:uhms-office-based-facility-credentialing-2021-03-26"
    -
      id: "late_radiation_tissue_injury"
      label: "Late Radiation Tissue Injury"
      stance: "mixed"
      summary: "Direct cystitis cohort often used to contextualize later trial and review literature. Foundational pelvic late-radiation injury series often cited in later HBOT reviews and guidelines. The Late Radiation Tissue Injury group currently links 38 appraisal-backed sources with clinical supervised, same mechanism, adjacent variant scope and positive, not efficacy evidence, no clear advantage interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-12771749"
        - "source_artifact:pmid-1497044"
        - "source_artifact:pmid-15520052"
        - "source_artifact:pmid-15833500"
        - "source_artifact:pmid-16034961"
        - "source_artifact:pmid-16681739"
        - "source_artifact:pmid-17393937"
        - "source_artifact:pmid-18342453"
        - "source_artifact:pmid-21980249"
        - "source_artifact:pmid-22139864"
        - "source_artifact:pmid-24035333"
        - "source_artifact:pmid-25382755"
        - "source_artifact:pmid-26703894"
        - "source_artifact:pmid-28081957"
        - "source_artifact:pmid-28209748"
        - "source_artifact:pmid-29654564"
        - "source_artifact:pmid-30192320"
        - "source_artifact:pmid-30851351"
        - "source_artifact:pmid-31537473"
        - "source_artifact:pmid-32511259"
        - "source_artifact:pmid-32736899"
        - "source_artifact:pmid-32957127"
        - "source_artifact:pmid-33227834"
        - "source_artifact:pmid-34843843"
        - "source_artifact:pmid-35320424"
        - "source_artifact:pmid-36203216"
        - "source_artifact:pmid-37585677"
        - "source_artifact:pmid-37637048"
        - "source_artifact:pmid-38691821"
        - "source_artifact:pmid-3897335"
        - "source_artifact:pmid-38985151"
        - "source_artifact:pmid-39200867"
        - "source_artifact:pmid-40291346"
        - "source_artifact:pmid-41223393"
        - "source_artifact:pmid-8326555"
        - "source_artifact:pmid-8989850"
        - "source_artifact:pmid-9231688"
        - "source_artifact:pmid-9915420"
    -
      id: "neurocognitive_and_restorative_clinical_hbot"
      label: "Neurocognitive And Restorative Clinical HBOT"
      stance: "mixed"
      summary: "Foundational older systematic review that captures the pre-chronic-PCS HBOT evidence base. Foundational early phase I chronic blast-related PCS/PTSD HBOT study that shaped later low-pressure trial programs. The Neurocognitive And Restorative Clinical HBOT group currently links 40 appraisal-backed sources with adjacent variant, clinical supervised, general guideline scope and not efficacy evidence, positive, mixed interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:healthquality-va-dod-mtbi-guideline-2021-06-01"
        - "source_artifact:pmid-15241774"
        - "source_artifact:pmid-22026588"
        - "source_artifact:pmid-23031217"
        - "source_artifact:pmid-23235612"
        - "source_artifact:pmid-24255008"
        - "source_artifact:pmid-24260334"
        - "source_artifact:pmid-24370568"
        - "source_artifact:pmid-25401463"
        - "source_artifact:pmid-26403017"
        - "source_artifact:pmid-27337294"
        - "source_artifact:pmid-27603765"
        - "source_artifact:pmid-29097988"
        - "source_artifact:pmid-29152209"
        - "source_artifact:pmid-29734566"
        - "source_artifact:pmid-30099354"
        - "source_artifact:pmid-30269074"
        - "source_artifact:pmid-30950414"
        - "source_artifact:pmid-31394602"
        - "source_artifact:pmid-32189664"
        - "source_artifact:pmid-34862223"
        - "source_artifact:pmid-35213282"
        - "source_artifact:pmid-35370898"
        - "source_artifact:pmid-35821512"
        - "source_artifact:pmid-36151105"
        - "source_artifact:pmid-36208548"
        - "source_artifact:pmid-36323462"
        - "source_artifact:pmid-36615108"
        - "source_artifact:pmid-36670365"
        - "source_artifact:pmid-37834897"
        - "source_artifact:pmid-38360929"
        - "source_artifact:pmid-38672710"
        - "source_artifact:pmid-39545965"
        - "source_artifact:pmid-40011516"
        - "source_artifact:pmid-40228859"
        - "source_artifact:pmid-40544138"
        - "source_artifact:pmid-40759992"
        - "source_artifact:pmid-40969214"
        - "source_artifact:pmid-41180753"
        - "source_artifact:pmid-41223394"
    -
      id: "problem_wounds_and_diabetic_foot_ulcers"
      label: "Problem Wounds And Diabetic Foot Ulcers"
      stance: "mixed"
      summary: "Blinded randomized evidence directly relevant to ischemic diabetic foot ulcers. Randomized nonischemic diabetic foot ulcer trial focused on healing rate and wound evolution. The Problem Wounds And Diabetic Foot Ulcers group currently links 39 appraisal-backed sources with clinical supervised, same mechanism, adjacent variant scope and positive, not efficacy evidence, no clear advantage interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:pmid-12787692"
        - "source_artifact:pmid-12882865"
        - "source_artifact:pmid-1303408"
        - "source_artifact:pmid-15106239"
        - "source_artifact:pmid-16799386"
        - "source_artifact:pmid-19239860"
        - "source_artifact:pmid-20427683"
        - "source_artifact:pmid-20957342"
        - "source_artifact:pmid-23374620"
        - "source_artifact:pmid-23423696"
        - "source_artifact:pmid-23863187"
        - "source_artifact:pmid-24377192"
        - "source_artifact:pmid-24726143"
        - "source_artifact:pmid-26152105"
        - "source_artifact:pmid-26340818"
        - "source_artifact:pmid-26663430"
        - "source_artifact:pmid-26740639"
        - "source_artifact:pmid-26804368"
        - "source_artifact:pmid-28116225"
        - "source_artifact:pmid-28968346"
        - "source_artifact:pmid-29074815"
        - "source_artifact:pmid-30836807"
        - "source_artifact:pmid-31002414"
        - "source_artifact:pmid-31509902"
        - "source_artifact:pmid-31667898"
        - "source_artifact:pmid-32040434"
        - "source_artifact:pmid-32931678"
        - "source_artifact:pmid-33227840"
        - "source_artifact:pmid-33500533"
        - "source_artifact:pmid-34376365"
        - "source_artifact:pmid-36913565"
        - "source_artifact:pmid-37232034"
        - "source_artifact:pmid-37607744"
        - "source_artifact:pmid-37990756"
        - "source_artifact:pmid-38032324"
        - "source_artifact:pmid-38528847"
        - "source_artifact:pmid-38531355"
        - "source_artifact:pmid-38930063"
        - "source_artifact:pmid-8941460"
    -
      id: "safety_contraindications_adverse_events_and_facility_hazards"
      label: "Safety Contraindications Adverse Events And Facility Hazards"
      stance: "safety_boundary"
      summary: "Recent review that updates the chamber-fire literature and hazard framing. Early prevention study frequently cited in later otologic management discussions. The Safety Contraindications Adverse Events And Facility Hazards group currently links 40 appraisal-backed sources with general guideline scope and not efficacy evidence interpretation; use the linked appraisals for source-specific caveats."
      sourceKeys:
        - "source_artifact:doi-10-2478-phr-2023-0020"
        - "source_artifact:fda-safe-use-hbot-devices-2025-08-25"
        - "source_artifact:nfpa-hyperbaric-facilities-fire-protection-2021-08-22"
        - "source_artifact:pmid-10685584"
        - "source_artifact:pmid-1443845"
        - "source_artifact:pmid-15559001"
        - "source_artifact:pmid-18251434"
        - "source_artifact:pmid-24377194"
        - "source_artifact:pmid-25596835"
        - "source_artifact:pmid-26152103"
        - "source_artifact:pmid-27000010"
        - "source_artifact:pmid-27265988"
        - "source_artifact:pmid-27416689"
        - "source_artifact:pmid-28198743"
        - "source_artifact:pmid-28613605"
        - "source_artifact:pmid-28616361"
        - "source_artifact:pmid-29054767"
        - "source_artifact:pmid-29083713"
        - "source_artifact:pmid-29888378"
        - "source_artifact:pmid-30690920"
        - "source_artifact:pmid-31051054"
        - "source_artifact:pmid-31409407"
        - "source_artifact:pmid-32491593"
        - "source_artifact:pmid-32809708"
        - "source_artifact:pmid-33086495"
        - "source_artifact:pmid-36100931"
        - "source_artifact:pmid-37256885"
        - "source_artifact:pmid-37275378"
        - "source_artifact:pmid-38330042"
        - "source_artifact:pmid-39139862"
        - "source_artifact:pmid-39597979"
        - "source_artifact:pmid-41364865"
        - "source_artifact:pmid-41429031"
        - "source_artifact:pmid-6691953"
        - "source_artifact:pmid-7968168"
        - "source_artifact:pmid-9308138"
        - "source_artifact:pmid-9525511"
        - "source_artifact:uhms-clinical-hyperbaric-facility-accreditation-manual-2018-06-04"
        - "source_artifact:uhms-guidelines-clinical-multiplace-hyperbaric-facilities-1994-06-01"
        - "source_artifact:uhms-ten-guidelines-patients-referring-physicians-2025-04-17"
safety:
  cautionLevel: "high"
  avoidOrGetClinicianGuidance:
    - no_clinician_prescription
    - no_supervised_facility
    - untreated_pneumothorax
    - pulmonary_blebs_or_bullae
    - copd_or_asthma
    - thoracic_surgery_history
    - ear_or_sinus_equalization_problem
    - recent_upper_respiratory_infection
    - fever
    - seizure_threshold_concern
    - diabetes_or_hypoglycemia_risk
    - pregnancy
    - intraocular_gas_or_recent_eye_surgery
    - implanted_device_pressure_review
    - external_device_pressure_review
    - selected_chemotherapy_exposures
    - medication_pressure_interactions
    - uncontrolled_blood_pressure
    - heart_failure
    - severe_claustrophobia
    - recent_vasoconstrictor_exposure
    - cns_disease_or_hypercapnia
    - opioid_or_sedative_use
    - alcohol_withdrawal
    - seizure_threshold_modifier
  stopIf:
    - "facility_or_clinician_says_not_to_proceed"
    - "severe_ear_or_sinus_pain_or_inability_to_equalize"
    - "chest_pain_shortness_of_breath_or_pulmonary_symptoms"
    - "dizziness_faintness_cough_or_new_pulmonary_symptoms"
    - "neurologic_symptoms_seizure_confusion_or_severe_headache"
    - "vision_change_or_severe_eye_symptom"
    - "hypoglycemia_symptoms_or_unsafe_glucose_reading_if_relevant"
    - "unsafe_blood_pressure_reading_if_relevant"
    - "severe_anxiety_panic_or_confinement_intolerance"
    - "device_alarm_or_staff_safety_concern"
    - "session_paused_shortened_or_stopped_for_safety_without_clinician_followup"
  notes:
    - "Default action is to track prescribed care, not recommend starting HBOT — safety claims outweigh efficacy claims."
    - "Log ear/sinus pressure, vision changes, anxiety, glucose/BP issues, and adverse events even when mild."
    - "A clear safety screen does not prove HBOT is appropriate — it only supports tracking an already-prescribed course."
---

# Hyperbaric Oxygen Therapy

This page is the Murph canonical wrapper for **clinician-supervised systemic chamber HBOT**. It is designed to track a prescribed course, not to recommend self-directed treatment.

## Boundary

Use this page only when the intervention is whole-body chamber HBOT with a clinician-defined pressure, oxygen delivery method, session length, air-break plan, and course length. Keep mild or soft chambers, topical oxygen, topical hyperbaric oxygen, normobaric oxygen, exercise-with-oxygen, and named wellness programs in separate variant pages.

## Practical use in Murph

Murph should first confirm that the user already has a clinician-prescribed HBOT plan and that sessions will occur in a medically supervised chamber setting. The experiment record should then track dose fidelity and tolerability: pressure, oxygen fraction if known, chamber type, air breaks, minutes completed, session number, and adverse events.

The default test plan is intentionally safety-first. A clean Murph trend can show that the course was completed as prescribed and whether symptoms or recovery context changed. It cannot prove that HBOT treated the underlying condition unless the clinician supplied disease-specific endpoints and follow-up.

## What not to merge

Do not merge clinical systemic HBOT with low-pressure mild chambers, topical wound oxygen devices, normobaric oxygen, EWOT, athletic oxygen exposure, or commercial anti-aging protocols. Those may be adjacent oxygen interventions, but they are not the same protocol and should not inherit these claims.
