---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:morning-light-exposure/morning-outdoor-light-exposure
slug: protocols/morning-light-exposure/morning-outdoor-light-exposure
title: Morning Outdoor Light Exposure
summary: Outdoor daylight soon after waking, where bright morning light resets the body clock early in the day so sleep pressure and melatonin timing line up better by evening.
status: field-testing
quality: usable
aliases:
  - morning outdoor daylight exposure
  - morning daylight exposure
  - morning sunlight exposure
  - post-wake outdoor light
  - early-day outdoor natural light exposure
  - morning natural light
  - morning outdoor light
categories:
  - sleep
  - circadian
  - light-exposure
  - outdoor-light
  - morning-routine
  - murph-canonical
media:

  -
    kind: image
    relativePath: design-assets/hero-morning-outdoor-light-exposure.jpeg
    mediaType: image/jpeg
    caption: Morning Outdoor Light Exposure
relations:

  -
    type: parent_family
    target: experiment_family:morning-light-exposure
  -
    type: primary_biomarker
    target: biomarker:sleep-quality
  -
    type: secondary_biomarker
    target: biomarker:sleep-onset-latency
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: cites
    target: source_artifact:aao-eye-damage-from-uv-light-2024-07-11
  -
    type: cites
    target: source_artifact:cdc-protect-yourself-from-extreme-heat-2024-06-25
  -
    type: cites
    target: source_artifact:clinicaltrials-gov-nct04712968-2021-09-01
  -
    type: cites
    target: source_artifact:doi-10.1016-j.buildenv.2025.112771
  -
    type: cites
    target: source_artifact:doi-10.15627-jd.2018.2
  -
    type: cites
    target: source_artifact:doi-10.25039-ps.b2twa77g
  -
    type: cites
    target: source_artifact:doi-10.25039-s026.2018
  -
    type: cites
    target: source_artifact:doi-10.31086-tjgeri.2020.147
  -
    type: cites
    target: source_artifact:morning-light-exposure-bibliography
  -
    type: cites
    target: source_artifact:pmid-10584776
  -
    type: cites
    target: source_artifact:pmid-11744403
  -
    type: cites
    target: source_artifact:pmid-12537644
  -
    type: cites
    target: source_artifact:pmid-14577838
  -
    type: cites
    target: source_artifact:pmid-18815716
  -
    type: cites
    target: source_artifact:pmid-19187411
  -
    type: cites
    target: source_artifact:pmid-19560724
  -
    type: cites
    target: source_artifact:pmid-21617534
  -
    type: cites
    target: source_artifact:pmid-21797835
  -
    type: cites
    target: source_artifact:pmid-22390242
  -
    type: cites
    target: source_artifact:pmid-22424890
  -
    type: cites
    target: source_artifact:pmid-23910656
  -
    type: cites
    target: source_artifact:pmid-26414986
  -
    type: cites
    target: source_artifact:pmid-26825618
  -
    type: cites
    target: source_artifact:pmid-27964860
  -
    type: cites
    target: source_artifact:pmid-28162893
  -
    type: cites
    target: source_artifact:pmid-28291967
  -
    type: cites
    target: source_artifact:pmid-28786887
  -
    type: cites
    target: source_artifact:pmid-28891192
  -
    type: cites
    target: source_artifact:pmid-28969438
  -
    type: cites
    target: source_artifact:pmid-29056090
  -
    type: cites
    target: source_artifact:pmid-29348073
  -
    type: cites
    target: source_artifact:pmid-29940781
  -
    type: cites
    target: source_artifact:pmid-30058044
  -
    type: cites
    target: source_artifact:pmid-30423177
  -
    type: cites
    target: source_artifact:pmid-30670164
  -
    type: cites
    target: source_artifact:pmid-30762717
  -
    type: cites
    target: source_artifact:pmid-30888626
  -
    type: cites
    target: source_artifact:pmid-31108433
  -
    type: cites
    target: source_artifact:pmid-31826657
  -
    type: cites
    target: source_artifact:pmid-31917880
  -
    type: cites
    target: source_artifact:pmid-32248548
  -
    type: cites
    target: source_artifact:pmid-32303523
  -
    type: cites
    target: source_artifact:pmid-33034127
  -
    type: cites
    target: source_artifact:pmid-34419205
  -
    type: cites
    target: source_artifact:pmid-34420891
  -
    type: cites
    target: source_artifact:pmid-34451820
  -
    type: cites
    target: source_artifact:pmid-34488088
  -
    type: cites
    target: source_artifact:pmid-34639284
  -
    type: cites
    target: source_artifact:pmid-35298459
  -
    type: cites
    target: source_artifact:pmid-37002704
  -
    type: cites
    target: source_artifact:pmid-37374270
  -
    type: cites
    target: source_artifact:pmid-37812713
  -
    type: cites
    target: source_artifact:pmid-38166501
  -
    type: cites
    target: source_artifact:pmid-38389933
  -
    type: cites
    target: source_artifact:pmid-39077837
  -
    type: cites
    target: source_artifact:pmid-39219616
  -
    type: cites
    target: source_artifact:pmid-39959124
  -
    type: cites
    target: source_artifact:pmid-40705857
  -
    type: cites
    target: source_artifact:pmid-41053799
  -
    type: cites
    target: source_artifact:pmid-41065723
  -
    type: cites
    target: source_artifact:pmid-41426466
  -
    type: cites
    target: source_artifact:pmid-8639941
  -
    type: cites
    target: source_artifact:pmid-9378689
  -
    type: cites
    target: source_artifact:pmid-9464216
  -
    type: cites
    target: source_artifact:who-global-solar-uv-index-2002-06-13
  -
    type: cites
    target: source_artifact:who-ultraviolet-radiation-2022-06-21
lineage:
  relationship: root
  rationale: Default Murph morning-light experiment for ambient outdoor natural light soon after waking, kept separate from indoor bright-light devices, dawn simulators, SAD/depression light therapy, clinician-guided circadian treatment, morning walks, exercise bundles, and outdoor-work exposures.
attribution:
  ownerType: murph
protocol:
  doseSignature: daily · outdoor ambient natural light soon after waking · 10-30 min target · 7-day baseline + 21-day intervention
  target: Ambient outdoor daylight within about 30-60 minutes after waking when feasible, preferably before 10 AM, without staring at the sun.
  frequency:
    sessionsPerWeek: 7
    sessionsPerDay: 1
  durationMinutes:
    min: 5
    max: 40
  sessionShape:
    label: One session
    segments:
      - label: outdoor light
        kind: stimulus
        durationMinutes: 30
    ticks:
      - label: "0"
        offsetMinutes: 0
      - label: "10 min minimum"
        offsetMinutes: 10
      - label: "30 min"
        offsetMinutes: 30
  interventionSessionsMinimum: 14
  interventionSessionsTarget: 21
  steps:
    - "Choose a safe repeatable outdoor spot: porch, balcony, courtyard, park path, or shaded open-sky area."
    - "Go outside soon after waking; target first 30–60 min, with before 10 AM as backup."
    - "Face open sky or ambient daylight, not the sun; no sun-gazing or forced glare."
    - "Stay 10–30 min; start with 5–10 min if light-sensitive, migraine-prone, heat-sensitive, or unsure."
    - "Sit, stand, or walk gently; log walking separately if it becomes exercise."
    - "Use shade, hat, sunscreen, sunglasses, cooler timing, or skip when UV, glare, heat, medication, or symptoms require it."
    - "Log wake time, start time, minutes, weather, protection, activity, symptoms, and next-night sleep quality."
  tips:
    - Pick tomorrow’s spot before bed: porch, balcony, courtyard, park path, or shaded open-sky area.
    - Go out in the first 30–60 minutes after waking; before 10 AM is the backup.
    - Face open sky, not the sun; sit, stand, or walk gently without turning it into exercise.
    - Cloudy mornings count; use open shade, hat, sunscreen, or sunglasses when glare or UV would otherwise shorten sessions.
    - Do not add blue blockers, melatonin, sleep supplements, or a new wake-time target during the run.
    - Log start time, minutes, weather, shade/sunglasses, activity, and next-night sleep; treat window light as backup.
  keepInMind:
    - The direct outdoor evidence is limited and mostly older-adult/institutional; this is a self-experiment, not a sleep, mood, or circadian-disorder treatment.
    - The 10-30 minute target is a practical Murph dose band, not a proven universal duration or lux threshold.
    - Outdoor ambient light is not the same as a light box, dawn simulator, window seat, classroom/workplace lighting system, or morning exercise bundle.
    - Season, latitude, cloud cover, snow, heat, UV index, indoor workday patterns, evening light, and chronotype can all change the actual dose and interpretation.
    - Mood activation, eye symptoms, migraine/photophobia, photosensitivity reactions, sunburn, and heat symptoms matter more than completing a session.
  logFields:
    - date
    - wake time
    - exposure start time
    - minutes outdoors
    - before 10 AM
    - outdoor versus window backup
    - weather or brightness context
    - sunglasses, hat, sunscreen, or shade use
    - activity during exposure
    - bedtime and final wake time
    - subjective sleep quality
    - morning alertness
    - headache, nausea, eye discomfort, skin reaction, heat symptoms, or mood activation
    - evening light or screen changes
    - caffeine, alcohol, illness, travel, major stress, or new sleep changes
  sessionFieldIds:
  - wake_time
  - exposure_start_time
  - minutes_outdoors
  - before_10am
  - outdoor_or_window_backup
  - weather_brightness_context
  - uv_heat_protection_used
  - activity_during_exposure
  - subjective_sleep_quality_next_morning
  - bedtime
  - final_wake_time
  - morning_alertness
  - headache_eye_skin_heat_or_mood_symptoms
  stopConditions:
    - Stop or shorten exposure if it triggers headache, nausea, migraine, photophobia, eye pain, visual symptoms, or unusual light sensitivity.
    - Stop and seek appropriate help if you notice unusual mood elevation, agitation, racing thoughts, reduced need for sleep, severe insomnia worsening, or suicidal thoughts.
    - Stop if you develop sunburn, rash, phototoxic or photoallergic symptoms, or any medication-related photosensitivity concern.
    - Stop if heat, dehydration, dizziness, faintness, confusion, or unsafe weather or route conditions occur.
    - Do not continue the experiment as unsupervised self-care if you are using clinician-guided light therapy, have bipolar disorder or recent mania/hypomania, or have new or concerning eye, skin, or mood symptoms.
testPlans:

  -
    planId: sleep-quality-timing-28d
    durationDays: 28
    baselineDays: 7
    interventionDays: 21
    primaryBiomarkerKey: biomarker:sleep-quality
    secondaryBiomarkerKeys:
      - biomarker:sleep-onset-latency
      - biomarker:sleep-efficiency
    minimumAdherenceSessions: 14
    targetAdherenceSessions: 21
    notes:
      - Use a 7-day baseline with no deliberate morning-light change, then compare against the 21-day intervention window.
      - Primary interpretation should focus on same-scale sleep quality and sleep-onset latency, with sleep efficiency, bedtime/final wake time, and morning alertness as supporting context; use exposure adherence to explain whether the protocol was actually tested.
      - Use a wearable or sleep diary for sleep-onset latency and sleep efficiency, but do not treat consumer sleep stages as promised endpoints.
      - Record evening light changes, travel, illness, alcohol, caffeine, exercise, stress, heat, UV, and weather as confounders.
expectedSignalDescriptions:

  -
    biomarkerKey: biomarker:sleep-quality
    description: "Morning outdoor light strengthens day-night contrast and anchors the circadian clock earlier, helping nighttime sleep feel more restorative."
    expected: Could feel more restorative
    expectedDirection: up
    estimatedChange:
      kind: absolute
      low: 0.5
      high: 1.5
      unit: points out of 10
      window: 1-3 weeks
      confidence: low
      basis: Direct older-adult outdoor and natural-light studies reported better sleep-quality questionnaire scores, and an adult daily-diary study linked morning sunlight with better next-night sleep quality. The estimate is a practical same-scale daily-rating range, not a pooled effect size.
    protocolProminence: focus
  -
    biomarkerKey: biomarker:sleep-onset-latency
    description: "Early daylight signals daytime to the circadian clock, aligning evening sleepiness with bedtime and shortening time spent trying to fall asleep."
    expected: May fall asleep sooner
    estimatedChange:
      kind: absolute
      low: -10
      high: 0
      unit: minutes
      window: 1-3 weeks
      confidence: low
      basis: Mechanism and measured-light studies support sleep-timing plausibility, while the direct 2025 morning-sunlight survey did not find a significant sleep-latency association and direct outdoor trials did not provide a usable latency effect size.
    protocolProminence: focus
  -
    biomarkerKey: biomarker:sleep-efficiency
    description: "A stronger early-day light cue consolidates the sleep-wake rhythm, reducing quiet wakefulness after lights-out and early awakenings."
    expected: Could edge higher
    estimatedChange:
      kind: absolute
      low: 0
      high: 3
      unit: "%"
      window: 1-3 weeks
      confidence: low
      basis: Sleep-efficiency evidence is indirect and mixed. A direct morning-sunlight survey found no significant association, while outdoor/daytime bright-light studies support tracking sleep-wake consolidation as a secondary signal.
    protocolProminence: context
experimentOnboarding:
  schemaVersion: "murph.commons.experiment-onboarding.v2"
  startIntent:
    displayPrompt: "Hey Murph, I want to try morning outdoor light exposure."
    intentSummary: "Explore Morning Outdoor Light Exposure"
  safetyScreen:
    dispositionIfAnyPositive: "clinician_guidance_before_unsupervised_start"
    mustAsk:
      - id: "mood_activation_or_bipolar"
        prompt: "bipolar disorder, past mania or hypomania, rapid cycling, mixed symptoms, recent severe mood instability, suicidal thoughts, or unusual activation with bright light"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "eye_migraine_or_light_sensitivity"
        prompt: "known eye disease, new visual symptoms, migraine or photophobia triggered by light, unusual eye pain, or strong light sensitivity"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "photosensitivity_or_sun_allergy"
        prompt: "photosensitizing medication, known photosensitivity, sun allergy, prior phototoxic or photoallergic reaction, or a skin condition where sunlight is unsafe"
        ifPositive: "clinician_guidance_before_unsupervised_start"
      - id: "unsafe_uv_heat_or_route"
        prompt: "no safe outdoor place, unsafe heat, high UV without protection, air-quality/weather hazards, or a route where traffic or footing risk would make the session unsafe"
        ifPositive: "do_not_start_unsupervised"
      - id: "current_clinical_light_or_circadian_treatment"
        prompt: "current clinician-guided light therapy, treatment for seasonal affective disorder, severe insomnia, depression, bipolar disorder, or a diagnosed circadian rhythm sleep-wake disorder"
        ifPositive: "clinician_guidance_before_unsupervised_start"
  setupSlots:
    - id: "usual_wake_time"
      label: "Usual wake time"
      question: "What time do you usually wake up on days you would do the morning-light session?"
      constraints:
        askWhen: "if_unknown_or_stale"
      target:
        object: "experimentRun"
        field: "usualWakeTime"
    - id: "target_morning_window"
      label: "Target morning window"
      question: "Which outdoor window is realistic most days?"
      options:
        - "first_30_minutes"
        - "first_60_minutes"
        - "before_10am"
        - "later_morning_backup"
      target:
        object: "experimentRun"
        field: "targetMorningWindow"
    - id: "target_minutes"
      label: "Target minutes"
      question: "How many minutes outdoors should Murph set as your daily target: 10, 15, 20, or 30?"
      constraints:
        min: 5
        max: 40
        recommendedOptions:
          - 10
          - 15
          - 20
          - 30
      target:
        object: "experimentRun"
        field: "targetMinutes"
    - id: "outdoor_location"
      label: "Outdoor location"
      question: "Where would you usually do it safely: porch, balcony, courtyard, park path, commute stop, or somewhere else?"
      target:
        object: "experimentRun"
        field: "outdoorLocation"
    - id: "backup_policy"
      label: "Backup policy"
      question: "When outdoor exposure is unsafe or impractical, what should count as the default backup?"
      options:
        - "skip_and_log"
        - "open_shade_short_session"
        - "window_light_logged_as_backup"
        - "reschedule_later_morning"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "experimentRun"
        field: "backupPolicy"
    - id: "reminder_policy"
      label: "Reminder policy"
      question: "Do you want a morning reminder and, if you miss the log, one same-day check-in?"
      options:
        - "none"
        - "morning_reminder"
        - "morning_reminder_plus_same_day_missing_log_check"
      constraints:
        askWhen: "at_confirmation"
      target:
        object: "assistantSupport"
        field: "reminderPolicy"
  planDefaults:
    testPlanId: "sleep-quality-timing-28d"
    firstSessionGuidance: "Start with a conservative 5-10 minutes in comfortable ambient outdoor light, avoid direct sun-gazing, and log any light, eye, skin, heat, or mood symptoms."
  trackingHints:
    confounderFields:
      - "evening_light_or_screen_change"
      - "bedtime_or_wake_time_change"
      - "caffeine_after_noon"
      - "alcohol_last_24h"
      - "illness_or_pain"
      - "travel_or_timezone_shift"
      - "major_stress"
      - "new_exercise_sleep_or_mood_intervention"
      - "new_medication_or_supplement"
      - "unusual_weather_uv_or_heat"
    notes:
      - "A missed or skipped day should be logged honestly; it is better evidence than forcing unsafe exposure."
  supportHints:
    missedLogFollowupCopy: "Did you get outside for your morning-light session today? Totally fine if not — I just want the experiment record to be accurate."
whyItWorks:
  - "## Morning light resets clock timing\n\nBright outdoor light hits retinal clock pathways soon after waking. That signal anchors the circadian day more strongly than dim indoor light."
  - "## Early cue shapes evening biology\n\nMorning phase signals help melatonin and alertness shift earlier. Sleep pressure still builds through the day; light tells the clock when the day started."
  - "## Consistency beats intensity spikes\n\nRepeated morning exposure gives the clock a stable daily cue. The payoff is steadier sleep onset, less evening drift, and clearer day-night contrast."
mechanismChain:
  -
    label: "Session"
    content: "Outdoor light soon after waking · 10–30 min"
  -
    label: "Retinal signal"
    content: "Bright light hits the circadian clock; morning melatonin shuts down"
  -
    label: "Repeated signal"
    content: "Morning phase cue repeats before daily timing drifts"
  -
    label: "Adaptation"
    content: "Clock anchors earlier · evening melatonin stabilizes · sleep onset aligns"
claims:

  -
    claimId: direct-older-adult-natural-light-sleep-quality
    type: intervention_result
    text: The closest prescribed outdoor or natural-light intervention evidence found better subjective sleep-quality signals after brief morning exposure in older nursing-home or long-term-care residents, including 5 days of 8 AM to 10 AM direct sunlight and 40-minute morning outdoor natural-light periods.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-28786887
      - source_artifact:doi-10.31086-tjgeri.2020.147
      - source_artifact:pmid-19560724
    caveats:
      - The direct intervention evidence is short, small, and concentrated in older institutional settings.
      - The outcomes are mainly subjective sleep-quality or sleep-problem measures.
      - This does not prove durable benefit in generally healthy working-age adults.
  -
    claimId: morning-light-timing-is-plausible-not-causal-proof
    type: association_not_causation
    text: Adult free-living evidence supports prioritizing early daylight as a plausible implementation target, but most general-adult support is observational: morning sunlight before 10 AM, daily diary sunlight exposure, and measured outdoor bright-light timing were associated with sleep timing, next-night sleep quality, or sleep-wake consolidation signals without proving causation.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-41053799
      - source_artifact:pmid-39077837
      - source_artifact:pmid-41426466
      - source_artifact:pmid-34488088
      - source_artifact:pmid-37812713
    caveats:
      - Exposure was often self-reported or measured naturalistically.
      - The same sources do not support a universal promise for total sleep time, sleep latency, or sleep efficiency.
      - Timing, prior light exposure, evening light, season, and weather can change interpretation.
  -
    claimId: duration-and-lux-are-tracking-bands-not-thresholds
    type: design_guardrail
    text: The 10- to 30-minute default and optional 40-minute upper anchor should be treated as practical tracking bands, not validated dose-response thresholds; direct sources include 5-day 8 AM to 10 AM sunlight and 40-minute outdoor natural-light exposure, while broader lighting guidance and measurement literature show that actual dose depends heavily on illuminance, spectrum, timing, device placement, setting, season, and weather.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-28786887
      - source_artifact:doi-10.31086-tjgeri.2020.147
      - source_artifact:pmid-35298459
      - source_artifact:doi-10.25039-ps.b2twa77g
      - source_artifact:doi-10.25039-s026.2018
      - source_artifact:doi-10.1016-j.buildenv.2025.112771
      - source_artifact:pmid-32248548
      - source_artifact:pmid-8639941
      - source_artifact:pmid-29056090
    caveats:
      - A cloudy outdoor morning can still be much brighter than many indoor settings, but exact lux values are not reliable without calibrated measurement.
      - The protocol should log duration and context rather than overinterpreting exact light dose.
  -
    claimId: outdoor-exposure-not-window-equivalent
    type: evidence_scope
    text: Indoor room light, window daylight, dynamic electric lighting, and light boxes are same-mechanism or adjacent variants rather than full adherence to the outdoor morning-light protocol.
    strength: high
    sourceKeys:
      - source_artifact:pmid-35298459
      - source_artifact:pmid-34639284
      - source_artifact:pmid-18815716
      - source_artifact:pmid-19187411
      - source_artifact:pmid-14577838
      - source_artifact:pmid-21797835
    caveats:
      - Indoor or device-based light can be useful in separate protocols, especially when outdoor exposure is unsafe or impractical.
      - Do not pool device-light clinical evidence into unsupervised outdoor-light efficacy claims.
  -
    claimId: self-report-sleep-quality-and-timing-primary-endpoints
    type: evidence_scope
    text: For a Morning Outdoor Light Exposure self-experiment, the most protocol-relevant outcomes are a brief self-report sleep-quality and sleep-timing log plus exposure adherence, because direct outdoor/natural-light studies most often measured subjective sleep quality, sleep problems, sleep timing, daytime function, or sleep midpoint rather than consumer sleep stages.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-28786887
      - source_artifact:doi-10.31086-tjgeri.2020.147
      - source_artifact:pmid-19560724
      - source_artifact:pmid-39077837
      - source_artifact:pmid-41053799
      - source_artifact:pmid-34488088
    caveats:
      - Wearable sleep-stage estimates can be used as context, not as a promised endpoint.
      - A one-night change is less informative than a baseline-versus-intervention trend.
  -
    claimId: wearable-sleep-metrics-are-secondary-and-mixed
    type: mixed_evidence
    text: Wearable or actigraphy-style endpoints such as sleep timing, sleep regularity, total sleep time, sleep efficiency, wake after sleep onset, and daytime sleepiness are useful secondary trend proxies, but the extracted evidence is mixed, indirect, and often not specific to outdoor morning light.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-34420891
      - source_artifact:pmid-37812713
      - source_artifact:pmid-37374270
      - source_artifact:pmid-19187411
      - source_artifact:doi-10.1016-j.buildenv.2025.112771
    caveats:
      - Consumer wearables and actigraphy can misclassify quiet wakefulness and sleep stages.
      - Evening light, sleep debt, illness, travel, alcohol, caffeine, exercise, and stress can confound sleep metrics.
  -
    claimId: safety-direct-harms-underreported
    type: evidence_scope
    text: Direct outdoor or outdoor-daylight protocol evidence does not provide a strong adverse-event base, so absence of reported harm in those sources should not be treated as proof that the protocol is risk-free.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-28786887
      - source_artifact:pmid-19560724
      - source_artifact:clinicaltrials-gov-nct04712968-2021-09-01
    caveats:
      - Accessible safety extraction was sparse.
      - Institutional or clinical eligibility criteria may not match unsupervised community use.
  -
    claimId: mood-activation-and-bipolar-boundary
    type: safety
    text: Bipolar disorder, prior mania or hypomania, rapid cycling, mixed symptoms, recent severe mood instability, or unusual activation with bright light should be clinician-guidance boundaries for unsupervised morning-light experiments.
    strength: high
    sourceKeys:
      - source_artifact:pmid-40705857
      - source_artifact:pmid-29348073
      - source_artifact:pmid-31917880
      - source_artifact:pmid-33034127
      - source_artifact:pmid-31826657
      - source_artifact:pmid-28969438
      - source_artifact:pmid-22424890
      - source_artifact:pmid-9378689
    caveats:
      - This boundary comes mostly from adjacent bright-light therapy literature, not direct outdoor wellness trials.
      - Mood activation, reduced need for sleep, racing thoughts, agitation, or suicidal thoughts are stop-and-seek-help signals.
  -
    claimId: light-sensitivity-eye-and-migraine-boundary
    type: safety
    text: Migraine, photophobia, unusual light-triggered head or eye pain, known eye disease, ocular abnormalities, new visual symptoms, or ocular vulnerability should trigger conservative use or clinician guidance, and the protocol must prohibit sun-gazing or direct solar viewing.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-28891192
      - source_artifact:pmid-30058044
      - source_artifact:pmid-29940781
      - source_artifact:pmid-30762717
      - source_artifact:aao-eye-damage-from-uv-light-2024-07-11
      - source_artifact:pmid-11744403
      - source_artifact:pmid-21617534
      - source_artifact:pmid-12537644
      - source_artifact:who-ultraviolet-radiation-2022-06-21
    caveats:
      - This is ambient outdoor light exposure, not direct solar viewing.
      - Sunglasses, shade, hat use, or skipping a session are appropriate when glare, UV, or symptoms make exposure unsafe.
  -
    claimId: photosensitivity-uv-and-heat-safety-priority
    type: safety
    text: Photosensitizing medications, known photosensitivity, sun allergy, prior phototoxic or photoallergic reactions, high UV exposure, and unsafe heat should override dose goals; UV and heat protection take priority over maximizing brightness.
    strength: high
    sourceKeys:
      - source_artifact:pmid-30888626
      - source_artifact:pmid-34451820
      - source_artifact:pmid-38389933
      - source_artifact:pmid-28291967
      - source_artifact:who-ultraviolet-radiation-2022-06-21
      - source_artifact:who-global-solar-uv-index-2002-06-13
      - source_artifact:cdc-protect-yourself-from-extreme-heat-2024-06-25
      - source_artifact:pmid-34419205
      - source_artifact:pmid-38166501
    caveats:
      - Use shade, clothing, sunscreen, sunglasses, cooler timing, or skipping a day when safety requires it.
      - The protocol should not require sunburn, tanning, overheating, or intentional UV overexposure.
  -
    claimId: population-extrapolation-is-explicit
    type: evidence_scope
    text: The closest prescribed outdoor morning-sunlight evidence is concentrated in older nursing-home or long-term-care adults, while adolescent, athlete, shift-work, delayed-sleep-phase, high-latitude, and clinical circadian evidence is mostly observational, mechanistic, clinical, or bundled.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-28786887
      - source_artifact:doi-10.31086-tjgeri.2020.147
      - source_artifact:pmid-19560724
      - source_artifact:pmid-22390242
      - source_artifact:pmid-26825618
      - source_artifact:pmid-27964860
      - source_artifact:pmid-30423177
      - source_artifact:pmid-39219616
      - source_artifact:pmid-39959124
    caveats:
      - Shift work, recent major time-zone travel, active clinical circadian treatment, and severe insomnia or mood episodes should be routed separately.
      - Age, chronotype, schedule, work setting, season, latitude, weather, and indoor/outdoor access should be logged as modifiers.
  -
    claimId: adjacent-variants-stay-separate
    type: design_guardrail
    text: Indoor ambient bright-light systems, light boxes, dawn simulators, SAD or depression light therapy, clinical circadian-treatment protocols, and multicomponent light-plus-activity routines should stay adjacent rather than being treated as direct evidence for the default outdoor morning-light protocol.
    strength: high
    sourceKeys:
      - source_artifact:pmid-34639284
      - source_artifact:pmid-18815716
      - source_artifact:pmid-19187411
      - source_artifact:pmid-14577838
      - source_artifact:pmid-21797835
      - source_artifact:pmid-32303523
      - source_artifact:pmid-41065723
      - source_artifact:pmid-37002704
      - source_artifact:pmid-26414986
    caveats:
      - Adjacent variants can be useful fallback or clinician-guided options.
      - Bundled routines cannot isolate light from exercise, social activity, travel countermeasures, sleep hygiene, or coaching.
  -
    claimId: self-experiment-not-sleep-or-mood-treatment
    type: design_guardrail
    text: Morning Outdoor Light Exposure should be framed as a bounded self-experiment for sleep timing, subjective sleep quality, morning alertness, adherence, and tolerability, not as a treatment for insomnia, depression, bipolar disorder, seasonal affective disorder, or a diagnosed circadian rhythm sleep-wake disorder.
    strength: high
    sourceKeys:
      - source_artifact:pmid-37002704
      - source_artifact:pmid-31108433
      - source_artifact:pmid-26414986
      - source_artifact:pmid-40705857
      - source_artifact:pmid-29348073
      - source_artifact:pmid-28786887
      - source_artifact:doi-10.31086-tjgeri.2020.147
    caveats:
      - Clinical light therapy can involve different timing, intensity, devices, monitoring, populations, and risk controls.
      - People already using a clinician-guided light plan should not replace it with this page.
researchLandscape:
  bottomLine: "The landing evidence is useful but bounded: the closest direct evidence is small and older-adult/institutional, broader adult evidence is mostly observational, and safety boundaries come largely from adjacent bright-light, UV, eye, mood, and heat literature."
  confidenceLabel: "limited"
  primaryClaim: "A repeatable outdoor morning-light habit is a plausible low-burden self-experiment for subjective sleep quality, sleep timing, morning alertness, and tolerability, not a proven treatment or a guaranteed wearable-sleep-stage intervention."
  mainCaveat: "Direct outdoor morning-light trials are sparse; indoor light, light boxes, dawn simulators, clinical light therapy, and bundled walking/exercise routines should not be pooled into the default outdoor protocol claim."
  groups:

    -
      id: "direct-outdoor-natural-light"
      label: "Direct outdoor or natural-light protocols"
      stance: "supports"
      summary: "Closest direct sources prescribe or measure morning sunlight or outdoor natural light and report subjective sleep-quality improvements, but they are short, small, and mostly older-adult or institutional."
      sourceKeys:
        - "source_artifact:doi-10.15627-jd.2018.2"
        - "source_artifact:doi-10.31086-tjgeri.2020.147"
        - "source_artifact:pmid-19560724"
        - "source_artifact:pmid-28786887"
      defaultOpen: true
    -
      id: "free-living-adult-context"
      label: "Free-living adult timing and outdoor-light context"
      stance: "mixed"
      summary: "Adult survey, diary, UK Biobank, and measured outdoor-light studies make the habit plausible and help with timing, but they are mostly observational and endpoint-specific."
      sourceKeys:
        - "source_artifact:pmid-34488088"
        - "source_artifact:pmid-37812713"
        - "source_artifact:pmid-39077837"
        - "source_artifact:pmid-41053799"
        - "source_artifact:pmid-41426466"
      defaultOpen: true
    -
      id: "dose-measurement-implementation"
      label: "Dose, timing, and measurement implementation"
      stance: "context_only"
      summary: "These sources support logging timing, duration, season, weather, setting, indoor/outdoor status, and evening light instead of pretending there is a universal lux or minute threshold."
      sourceKeys:
        - "source_artifact:doi-10.1016-j.buildenv.2025.112771"
        - "source_artifact:doi-10.25039-ps.b2twa77g"
        - "source_artifact:doi-10.25039-s026.2018"
        - "source_artifact:pmid-29056090"
        - "source_artifact:pmid-30670164"
        - "source_artifact:pmid-32248548"
        - "source_artifact:pmid-35298459"
        - "source_artifact:pmid-8639941"
    -
      id: "outcomes-and-wearable-interpretation"
      label: "Outcomes and wearable interpretation"
      stance: "mixed"
      summary: "Self-reported sleep quality and timing are the cleanest endpoints. Actigraphy, wearable sleep, alertness, and lab circadian markers are useful but secondary, indirect, or research-only."
      sourceKeys:
        - "source_artifact:doi-10.31086-tjgeri.2020.147"
        - "source_artifact:pmid-19187411"
        - "source_artifact:pmid-19560724"
        - "source_artifact:pmid-28786887"
        - "source_artifact:pmid-34420891"
        - "source_artifact:pmid-37374270"
        - "source_artifact:pmid-39077837"
        - "source_artifact:pmid-41053799"
    -
      id: "adjacent-light-variants"
      label: "Adjacent light variants"
      stance: "context_only"
      summary: "Indoor daylight, workplace/classroom lighting, light boxes, dawn simulators, SAD/depression protocols, and bundled light-plus-activity routines belong in separate variants or context buckets."
      sourceKeys:
        - "source_artifact:pmid-14577838"
        - "source_artifact:pmid-18815716"
        - "source_artifact:pmid-19187411"
        - "source_artifact:pmid-21797835"
        - "source_artifact:pmid-26414986"
        - "source_artifact:pmid-31108433"
        - "source_artifact:pmid-31826657"
        - "source_artifact:pmid-32303523"
        - "source_artifact:pmid-33034127"
        - "source_artifact:pmid-34639284"
        - "source_artifact:pmid-37002704"
        - "source_artifact:pmid-41065723"
    -
      id: "population-modifiers"
      label: "Population and setting modifiers"
      stance: "context_only"
      summary: "Older-adult, adolescent, athlete, delayed-sleep-phase, shift-work, high-latitude, and travel/jet-lag evidence changes boundaries and logging; it does not define one universal morning-light rule."
      sourceKeys:
        - "source_artifact:doi-10.31086-tjgeri.2020.147"
        - "source_artifact:pmid-19560724"
        - "source_artifact:pmid-22390242"
        - "source_artifact:pmid-23910656"
        - "source_artifact:pmid-26825618"
        - "source_artifact:pmid-27964860"
        - "source_artifact:pmid-28162893"
        - "source_artifact:pmid-28786887"
        - "source_artifact:pmid-30423177"
        - "source_artifact:pmid-34488088"
        - "source_artifact:pmid-39077837"
        - "source_artifact:pmid-39219616"
        - "source_artifact:pmid-39959124"
        - "source_artifact:pmid-41053799"
    -
      id: "safety-boundaries"
      label: "Safety boundaries"
      stance: "safety_boundary"
      summary: "Direct outdoor harms reporting is sparse, so safety copy leans on adjacent bright-light therapy, bipolar/mood activation, migraine/photophobia, ocular/UV, photosensitivity-medication, and heat guidance."
      sourceKeys:
        - "source_artifact:aao-eye-damage-from-uv-light-2024-07-11"
        - "source_artifact:cdc-protect-yourself-from-extreme-heat-2024-06-25"
        - "source_artifact:clinicaltrials-gov-nct04712968-2021-09-01"
        - "source_artifact:pmid-10584776"
        - "source_artifact:pmid-11744403"
        - "source_artifact:pmid-12537644"
        - "source_artifact:pmid-21617534"
        - "source_artifact:pmid-22424890"
        - "source_artifact:pmid-28291967"
        - "source_artifact:pmid-28786887"
        - "source_artifact:pmid-28891192"
        - "source_artifact:pmid-28969438"
        - "source_artifact:pmid-29348073"
        - "source_artifact:pmid-29940781"
        - "source_artifact:pmid-30058044"
        - "source_artifact:pmid-30762717"
        - "source_artifact:pmid-30888626"
        - "source_artifact:pmid-31917880"
        - "source_artifact:pmid-34419205"
        - "source_artifact:pmid-34451820"
        - "source_artifact:pmid-38166501"
        - "source_artifact:pmid-38389933"
        - "source_artifact:pmid-40705857"
        - "source_artifact:pmid-9464216"
        - "source_artifact:pmid-9378689"
        - "source_artifact:who-global-solar-uv-index-2002-06-13"
        - "source_artifact:who-ultraviolet-radiation-2022-06-21"
      defaultOpen: true
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - bipolar_disorder_or_mania_history
    - rapid_cycling_or_severe_mood_instability
    - suicidal_thoughts
    - clinician_guided_light_therapy
    - known_eye_disease_or_new_visual_symptoms
    - migraine_or_light_triggered_pain
    - photosensitizing_medication
    - known_photosensitivity_or_sun_allergy
    - prior_phototoxic_reaction
    - sun_sensitive_skin_condition
    - unsafe_heat_uv_or_air_quality
    - shift_work_or_active_jet_lag_adaptation
  stopIf:
    - eye_pain_visual_symptoms_or_unusual_photophobia
    - migraine_headache_nausea_or_light_triggered_pain
    - sunburn_skin_rash_or_photosensitivity_reaction
    - heat_illness_dizziness_faintness_confusion_or_dehydration_symptoms
    - unusual_mood_elevation_agitation_racing_thoughts_or_reduced_need_for_sleep
    - worsening_insomnia_across_multiple_sessions
    - suicidal_thoughts_or_severe_mood_symptoms
    - unsafe_weather_uv_heat_air_quality_route_or_traffic_conditions
  notes:
    - Ambient outdoor light exposure, not sun-gazing.
    - UV, heat, eye, skin, migraine, and mood safety override adherence targets.
    - Light boxes, dawn simulators, and window light are adjacent variants, not this protocol.
    - Not a treatment plan for insomnia, depression, bipolar, SAD, or circadian disorders.
researchCoverage:
  bibliographyKey: source_artifact:morning-light-exposure-bibliography
  corpusStats:
    canonicalSourceRecords: 270
    sourcePageDrafts: 270
    sourceExtractionBatches: 10
    supportsProtocolRecords: 5
    contextOnlyRecords: 229
    safetyOnlyRecords: 40
    backboneRecords: 31
    directProtocolRecords: 10
    directOutdoorDaylightProtocolRecords: 19
    timingDoseCircadianMetricRecords: 34
    freeLivingObservationalMeasurementRecords: 22
    indoorWorkplaceClassroomHomeDaylightRecords: 20
    clinicalLightTherapyDeviceBoundaryRecords: 37
    safetyBoundaryRecords: 40
    auditCutoff: 2026-04-24
sessionLoggingFields:
  - session_date
  - wake_time
  - exposure_start_time
  - minutes_outdoors
  - before_10am
  - outdoor_or_window_backup
  - weather_brightness_context
  - uv_heat_protection_used
  - activity_during_exposure
  - subjective_sleep_quality_next_morning
  - morning_alertness
  - bedtime
  - final_wake_time
  - headache_eye_skin_heat_or_mood_symptoms
  - evening_light_or_screen_change
  - caffeine_alcohol_illness_travel_stress_or_new_intervention
confoundersToTrack:
  - evening_light_or_screen_change
  - major_bedtime_or_wake_time_change
  - caffeine_timing_change
  - alcohol_last_24h
  - illness_or_pain
  - new_exercise_protocol
  - new_sleep_hygiene_or_evening_light_protocol
  - new_medication_or_supplement
  - travel_or_timezone_shift
  - unusual_heat_uv_weather_air_quality_or_route
  - major_work_or_life_stress
expectedSignal:
  primary:
    biomarkerKey: biomarker:sleep-quality
    direction: improve_or_no_clear_change
    latency: 1-3 weeks, interpreted against a 7-day baseline
    confidence: low_to_moderate
    sourceKeys:
      - source_artifact:pmid-28786887
      - source_artifact:doi-10.31086-tjgeri.2020.147
      - source_artifact:pmid-19560724
      - source_artifact:pmid-41053799
      - source_artifact:pmid-39077837
  secondary:

    -
      biomarkerKey: biomarker:sleep-onset-latency
      direction: mixed_or_no_clear_change
      latency: 1-3 weeks
      confidence: low
    -
      biomarkerKey: biomarker:sleep-efficiency
      direction: mixed_or_no_clear_change
      latency: 1-3 weeks
      confidence: low
---

## Question this experiment answers

After a stable baseline, does a deliberate outdoor morning-light session improve your subjective sleep quality, sleep timing, or morning alertness enough to be worth keeping?

The closest direct evidence is short and population-bounded: older nursing-home or long-term-care residents had better subjective sleep-quality signals after prescribed morning natural-light exposure, while broader adult evidence mostly links daytime or morning outdoor light to sleep and circadian outcomes without proving the exact self-experiment dose.

## Simple version

For 7 days, keep your routine stable and only measure. Then, for 21 days, go outside soon after waking and spend about 10-30 minutes in ambient daylight. Do not stare at the sun. Log wake time, session timing, duration, weather, perceived brightness, sleep quality, sleep timing, morning alertness, evening light, caffeine, alcohol, travel, illness, and any symptoms.

## What counts

This Murph protocol is **outdoor ambient natural light after waking**. It is not a light box, dawn simulator, SAD treatment, insomnia treatment, window-light routine, office-daylight protocol, morning walk/exercise prescription, travel/jet-lag plan, or clinician-guided circadian treatment. Those may share mechanisms, but they have different doses, safety boundaries, populations, and evidence bases.

## Main readout

The primary readout is subjective sleep quality, because that is the closest outcome in the direct outdoor/natural-light intervention studies. Sleep-onset latency, sleep efficiency, sleep timing regularity, wearable sleep score, morning alertness, and mood are secondary or context signals.

## Evidence posture

The landing claim is deliberately narrow: morning outdoor light is a plausible, low-complexity circadian habit to test, not a guaranteed treatment. The evidence base is strongest for mechanism and timing plausibility, weaker for the exact default dose in healthy adults, and safety-sensitive for people with bipolar-spectrum risk, mood activation, eye disease, migraine or photophobia, photosensitizing medications or conditions, high UV exposure, heat risk, or unsafe outdoor routes.

## Safety posture

Safety overrides adherence. Stop or pause for mood activation, visual symptoms, migraine worsening, sunburn, phototoxic reaction, heat illness symptoms, unsafe weather, or unsafe route conditions. Get clinician guidance before starting if you are using light to treat a mood, sleep, circadian, or neurologic condition, or if you have bipolar-spectrum history, significant eye disease, marked light sensitivity, relevant photosensitizing medications or conditions, or high UV/heat vulnerability.
