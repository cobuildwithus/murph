---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:pre-sleep-downshift-practices/pre-sleep-resonance-breathing-and-meditation
slug: protocols/pre-sleep-downshift-practices/pre-sleep-resonance-breathing-and-meditation
title: Resonance Breathing Before Bed
summary: "Slow steady breathing before bed, where each breath lines up more predictably with heart-rate rhythms and gives the nervous system a calmer pre-sleep cue."
status: draft
quality: usable
aliases:
  - pre-sleep resonance breathing and meditation
  - resonance breathing before bed and silent meditation before bed
  - bedtime slow breathing or meditation
  - pre-sleep downshift chooser
  - resonance breathing before sleep
  - silent meditation before sleep
  - bedtime breathing meditation stack
categories:
  - sleep
  - pre-sleep
  - breathwork
  - meditation
  - relaxation
  - nervous-system-downshift
  - wearable-measured
  - murph-research-umbrella
media:

  -
    kind: image
    relativePath: design-assets/hero-resonance-breathing-before-bed.jpeg
    mediaType: image/jpeg
    caption: Resonance Breathing Before Bed
relations:

  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
  -
    type: primary_biomarker
    target: biomarker:sleep-onset-latency
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: secondary_biomarker
    target: biomarker:pre-sleep-arousal
    note: Manual subjective endpoint for feeling wired, keyed-up, panicky, or cognitively activated before sleep.
lineage:
  relationship: root
  rationale: This page intentionally materializes the combined slug as a research umbrella and chooser. The extraction set did not find completed direct evidence for the exact stacked practice of resonance breathing before bed followed by silent meditation before bed, so runnable child variants should remain separate until stronger direct evidence exists.
attribution:
  ownerType: murph
  note: Murph canonical research umbrella assembled from the pre-sleep downshift-practices research run. External named protocols, apps, devices, CBT-I programs, HRV-biofeedback programs, and meditation programs remain separate variants.
protocol:
  doseSignature: "After a red-flag screen, choose one nightly child practice for 14 intervention nights: start with 5-10 min and increase only if well tolerated. Use 5-6 breaths/min only as an optional guide; combined use is exploratory."
  target: gentle pre-sleep downshift using either resonance-like slow breathing or silent meditation
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 5
    max: 20
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - "Screen first; route chronic, impairing, clinical, pregnancy, respiratory, panic, trauma, psychosis, mania, or prior adverse reactions to guidance."
    - "Choose 1 child practice before intervention: gentle slow breathing or silent meditation; do not stack by default."
    - "Practice in the final pre-bed window after screens and bright tasks are winding down."
    - "Breathing child: sit or lie comfortably; breathe gently at an easy pace, optionally ~5–6 breaths/min."
    - "Stop breathing practice for air hunger, overbreathing, dizziness, chest tightness, alarming tingling, or panic-like activation."
    - "Meditation child: start 5–10 min with timer, silent anchor, and eyes open if useful."
    - "Stop meditation for panic, trauma re-experiencing, dissociation, mood elevation, or psychosis-like experiences."
    - "Log practice type, start/end, completion, bedtime, sleep onset, awakenings, sleep quality, restfulness, symptoms, and distress."
  safetyNotes:
    - Use this only for mild, non-urgent pre-sleep arousal or sleep-onset friction. It is not a treatment pathway for chronic or impairing insomnia, suspected or diagnosed sleep apnea, PAP therapy, restless legs syndrome, periodic limb movement disorder, hypersomnolence, parasomnias, circadian rhythm sleep-wake disorders, pregnancy/postpartum/lactation sleep problems, medication decisions, panic disorder, asthma, trauma/PTSD, depression, psychosis, mania, or suicidality.
    - Get clinician guidance before starting if you are pregnant, postpartum, lactating, under 18, an older adult with medical complexity or polypharmacy, using sedatives or sleep medicines, using PAP/CPAP, changing medications, or experiencing severe daytime sleepiness, sleep attacks, drowsy driving, loud snoring, witnessed apneas, gasping, urge-to-move symptoms, disruptive limb movements, dream enactment, sleepwalking, or major sleep-timing instability.
    - Get clinician guidance before breathing-focused practice if you have respiratory disease, asthma, unexplained breathlessness, dysfunctional breathing/hyperventilation symptoms, fainting history, pacemaker-driven rhythm, heart-rate medication, medical acidosis, panic attacks triggered by breathing focus, or prior adverse reactions to breathwork.
    - Exclude forceful breathing, breath retention, deliberate CO2-lowering, high-ventilation methods, breath of fire, holotropic breathwork, Wim-Hof-style breathing, and any breathing pattern that increases air hunger, chest symptoms, dizziness, faintness, or panic.
    - Meditation should stay low-dose and grounding-oriented. Stop rather than push through escalating distress, dissociation, depersonalization/derealization, traumatic re-experiencing, hallucinations, delusions, unusual mood elevation, mania-like activation, psychosis-like experiences, worsening depression, or self-harm thoughts.
  tips:
    - New to this? Start with 5-10 consistent minutes — ambitious sessions that become stressful defeat the purpose.
    - Hold bedtime, wake time, caffeine, alcohol, exercise, screens, room light, and supplements stable during the test.
    - Same practice most nights. Switching between breathing, meditation, and combined weakens attribution.
    - Wearable sleep/HRV is trend context — pair with a subjective sleep-onset estimate and pre-sleep arousal rating.
    - Do not chase perfect calm. This is a low-intensity routine, not a performance target.
  keepInMind:
    - The exact combined stack is not established by the extraction corpus. This page routes users toward separate child practices unless they knowingly choose an exploratory combined run.
    - Direct breathing evidence is promising but mixed, especially for objective sleep metrics.
    - Silent bedtime meditation is plausible but lower-directness because much of the extracted meditation evidence is guided, app-based, clinical, or bundled.
    - Strong personal conclusions require enough nights, stable confounders, and a comparison with baseline rather than single-night improvements.
  logFields:
    - chosen child practice
    - practice start time
    - practice end time
    - completed session
    - intended bedtime
    - actual bedtime
    - estimated sleep-onset latency
    - pre-sleep arousal rating
    - awakenings or perceived sleep continuity
    - sleep quality
    - next-morning restfulness
    - caffeine timing
    - alcohol
    - late exercise
    - screens and room light
    - unusual symptoms or distress
    - wake time
    - out-of-bed time
    - lights-out time
    - time in bed
    - naps
    - daytime sleepiness
    - sleep attacks or drowsy-driving episodes
    - medication changes
    - sleep supplement changes
    - pain or illness
    - respiratory symptoms or asthma flares
    - snoring, witnessed apneas, or gasping
    - urge-to-move, leg discomfort, or limb movements
    - parasomnia or unusual night behaviors
    - shift work, travel, jet lag, or major schedule changes
    - mood, anxiety, panic, trauma triggers, or dissociation symptoms
    - wearable model/app changes
    - sleep-score checking or tracker-related anxiety
    - exact breathing pace if paced
    - whether breathing felt forced, easy, or air-hungry
    - meditation anchor used
    - eyes open or closed
  stopConditions:
    - Stop the session for air hunger, overbreathing, chest pain or tightness, palpitations, new or severe shortness of breath, faintness, dizziness, alarming tingling, or escalating panic-like sensations.
    - Stop the session for derealization, depersonalization, dissociation, traumatic re-experiencing, intense agitation, hallucinations, delusions, unusual mood elevation, mania-like activation, or psychosis-like experiences.
    - Stop and seek urgent support if the practice is associated with self-harm thoughts, suicidal thoughts, severe mood worsening, or feeling unsafe.
    - Stop or modify the posture if body position, body scan, or repositioning causes pain, shortness of breath, or neurologic symptoms.
    - Pause the experiment and seek evaluation for sleep attacks, unsafe daytime sleepiness, drowsy driving, loud snoring with witnessed apneas, gasping, disruptive limb movements, dream enactment, sleepwalking, or major sleep-timing instability.
    - End the experiment if sleep feels meaningfully worse for three consecutive nights without an obvious outside cause, or after one night if worsening is severe or causes marked next-day impairment.
    - End the experiment if the routine increases anxiety, performance pressure, rumination, orthosomnia-like fixation, clock-watching, or bedtime dread.
    - Pause the experiment and seek appropriate care if insomnia is chronic, impairing, associated with severe mood symptoms, tied to pregnancy/postpartum/lactation, or tied to medication changes.
testPlans:

  -
    planId: chooser-sol-proxy-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:sleep-onset-latency
    secondaryBiomarkerKeys:
      - biomarker:sleep-efficiency
      - biomarker:resting-heart-rate
      - biomarker:hrv-rmssd
      - biomarker:pre-sleep-arousal
    safetyOutcomeKeys:
      - biomarker:pre-sleep-arousal
    minimumAdherenceSessions: 10
    targetAdherenceSessions: 12
    notes:
      - The baseline is seven nights without adding either practice. The intervention is fourteen nights using the chosen child practice.
      - The primary personal question is whether sleep onset and pre-sleep arousal improve enough to justify keeping the routine.
      - Use a wearable sleep-onset estimate when available, but pair it with a brief subjective estimate because quiet wakefulness can be misclassified.
      - Treat HRV, resting heart rate, total sleep time, and sleep stages as exploratory context unless repeated changes align with logs and are not obviously confounded.
      - Combined breathing-plus-meditation runs should be analyzed separately from the breathing-only or meditation-only child practice.
expectedSignalDescriptions:

  -
    biomarkerKey: biomarker:sleep-onset-latency
    expected: May fall asleep sooner
    description: Slow breath pacing or a simple meditation anchor replaces problem-solving, scrolling, and clock-watching, lowering pre-bed arousal.
    displayValue: "3-10 min faster"
    estimatedChange:
      kind: absolute
      low: -10
      high: -3
      unit: minutes
      window: 14 nights vs 7-night baseline
      confidence: low
      basis: "Direct slow-breathing evidence includes a non-forced breathing-cycle study with sleep latency moving from 20.2 to 10.7 minutes and a small insomnia PSG study reporting lower sleep-onset latency; the healthy-adult PSG pilot was null, the 2026 review found objective sleep results inconclusive, and the meditation child evidence is mostly adjacent."
    protocolProminence: focus
  -
    biomarkerKey: biomarker:sleep-efficiency
    expected: Could improve
    description: Shorter sleep onset and fewer restless awake periods turn more time in bed into sleep.
    estimatedChange:
      kind: absolute
      low: 1
      high: 4
      unit: "%"
      window: 14 nights vs 7-night baseline
      confidence: low
      basis: "The paced-breathing insomnia study reported higher PSG sleep efficiency, and the non-forced breathing-cycle study lowered smartwatch/app awake time by 5.4 percentage points. Objective findings were inconclusive in the healthy-adult PSG pilot and 2026 systematic review, so the estimate is conservative."
    protocolProminence: focus
  -
    biomarkerKey: biomarker:resting-heart-rate
    expected: Could trend lower
    description: Unforced slow breathing increases vagal braking and lowers pre-bed pulse as arousal drops.
    displayValue: "1-4 bpm lower"
    estimatedChange:
      kind: absolute
      low: -4
      high: -1
      unit: bpm
      window: 14 nights vs 7-night baseline
      confidence: low
      basis: "The non-forced breathing-cycle study lowered pre-sleep heart rate by 5.6 bpm and several sleep-stage heart-rate measures by about 4-7 bpm. This protocol is gentler and user-run, so the expected same-device resting-heart-rate shift is smaller."
    protocolProminence: context
  -
    biomarkerKey: biomarker:hrv-rmssd
    expected: Could improve
    expectedDirection: up_or_stable
    description: Breathing near resonance amplifies beat-to-breath variability, supporting stronger parasympathetic recovery overnight.
    estimatedChange:
      kind: relative_percent
      low: 0
      high: 10
      unit: "%"
      window: 14 nights vs 7-night baseline
      confidence: low
      basis: "Direct sources show total HRV power or immediate HRV increases during pre-sleep slow breathing, while the extracted evidence does not give a clean overnight RMSSD effect. Treat this as a small same-device relative shift, not a cross-device HRV target."
    protocolProminence: context
  -
    biomarkerKey: biomarker:pre-sleep-arousal
    expected: Less wired
    expectedDirection: down_or_stable
    description: Breath pacing and grounding give attention a repeatable low-threat task, reducing threat checks and rumination before lights-out.
    estimatedChange:
      kind: mixed_or_contextual
      window: 14 nights vs 7-night baseline
      confidence: low
      basis: "The bedtime app-guided mindfulness pilot reported lower PSAS scores, and structured mindfulness insomnia trials report lower pre-sleep arousal. Mapping those scales to a simple nightly check-in is approximate, and breathing-only arousal-scale estimates were not extracted."
    protocolProminence: focus
whyItWorks:
  - "## Slow breathing couples heart and lungs\n\nBreathing near 5–6 breaths/min amplifies heart-rate oscillation with each breath. The vagal brake becomes easier to engage before bed."
  - "## Attention gets a low-threat rhythm\n\nThe breath gives the mind a simple task. Planning, threat scanning, and clock-watching lose repetition time."
  - "## Sleep comes from lower arousal\n\nThe practice does not force sleep. It reduces pre-sleep activation so the wake-to-sleep transition has less resistance."
mechanismChain:
  -
    label: "Session"
    content: "5–10 min slow breathing before bed"
  -
    label: "Acute physiology"
    content: "Breath rhythm slows; heart-rate oscillation strengthens; attention narrows"
  -
    label: "Repeated signal"
    content: "Same pre-bed cue lowers arousal before lights-out"
  -
    label: "Adaptation"
    content: "Vagal braking steadies · sleep onset shortens · RMSSD holds higher"
claims:

  -
    claimId: combined-slug-should-remain-research-umbrella
    type: evidence_scope
    text: "The combined provisional protocol should remain a research and chooser umbrella rather than a default runnable stacked protocol. The closest direct appraisals either test pre-sleep slow breathing without silent meditation, or mindfulness and meditation variants that are mobile, guided, structured, clinical, protocol-only, or heterogeneous rather than the exact named combination."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-25234581
      - source_artifact:pmid-32366866
      - source_artifact:pmid-41886931
      - source_artifact:clinicaltrials-nct03337061-2026-04-26
      - source_artifact:pmid-41027036
      - source_artifact:pmid-25142566
      - source_artifact:pmid-27663102
    caveats:
      - This is a directness and materialization decision, not evidence that the combined stack is ineffective.
      - A future completed trial of resonance breathing plus silent bedtime meditation could change this boundary.
      - Adjacent variants should not be promoted to direct evidence for the combined stack.
  -
    claimId: breathing-component-merits-sibling-variant-not-stack
    type: mixed_evidence
    text: "Pre-sleep slow or resonance-like breathing has enough direct but mixed sleep evidence to support a standalone runnable sibling variant, but not an efficacy claim for a combined breathing-plus-meditation stack."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-25234581
      - source_artifact:pmid-32366866
      - source_artifact:pmid-41886931
      - source_artifact:doi-10.17241-smr.2020.00668
      - source_artifact:doi-10.3389-frsle.2025.1603713
    caveats:
      - Not all breathing sources test individualized resonance frequency protocols.
      - Objective sleep outcomes are mixed or inconclusive, especially in PSG and actigraphy contexts.
      - Direct breathing sources do not include a silent meditation component.
  -
    claimId: silent-meditation-sibling-has-low-directness
    type: evidence_scope
    text: "Pre-sleep silent meditation should be separated as a low-directness sibling variant. Current extracted sources support mindfulness-insomnia plausibility and dose planning mostly through app-guided, clinical program, meta-analytic, or registry/protocol evidence, not a completed silent unguided bedtime RCT."
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-41027036
      - source_artifact:pmid-25142566
      - source_artifact:pmid-27663102
      - source_artifact:clinicaltrials-nct06972303-2026-02-23
      - source_artifact:clinicaltrials-nct04242771-2026-04-26
      - source_artifact:clinicaltrials-nct03337061-2026-04-26
      - source_artifact:doi-10.2196-72786
    caveats:
      - App-guided and clinical mindfulness sources should not be rewritten as silent unguided practice.
      - Duration-specific variants should remain tentative until direct sleep-focused dose evidence is stronger.
  -
    claimId: apps-devices-guided-bundles-stay-adjacent
    type: design_guardrail
    text: "Guided apps, body-scan or music bundles, huggable or robotic devices, VR, commercial sleep programs, and HRV-biofeedback or taVNS stacks should remain adjacent variants. Their findings should not be attributed to unguided resonance breathing, silent meditation, or the combined stack unless a separable matching arm exists."
    strength: high
    sourceKeys:
      - source_artifact:pmid-30736268
      - source_artifact:doi-10.2174-1874944502013010232
      - source_artifact:pmid-36285420
      - source_artifact:pmid-37428349
      - source_artifact:pmid-40267472
      - source_artifact:doi-10.5298-1081-5937-41.3.08
      - source_artifact:pmid-32385728
      - source_artifact:pmid-38042286
      - source_artifact:clinicaltrials-nct06614803-2024-09-26
    caveats:
      - Some adjacent variants report positive subjective sleep or arousal signals, while others are null or feasibility-only.
      - Bundled designs prevent attribution to breathing alone, meditation alone, or the exact combined protocol.
  -
    claimId: clinical-insomnia-care-boundary
    type: design_guardrail
    text: "This protocol should not be framed as treatment for chronic or impairing insomnia, suspected obstructive sleep apnea, or medication management. CBT-I and guideline-based sleep-disorder care remain separate clinical pathways with stronger and different evidence."
    strength: high
    sourceKeys:
      - source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22
      - source_artifact:pmid-33164742
      - source_artifact:pmid-33164741
      - source_artifact:pmid-26054060
      - source_artifact:pmid-27136449
      - source_artifact:pmid-38016484
      - source_artifact:pmid-27998379
    caveats:
      - Clinical guidelines do not test resonance breathing, silent meditation, or their combination.
      - Guideline relaxation-therapy language should not be upgraded to direct evidence for this exact protocol.
  -
    claimId: measurement-should-use-diaries-plus-context
    type: design_guardrail
    text: "Sleep diaries, actigraphy, and consumer sleep devices can support a personal test, but none should be treated as definitive proof of sleep improvement on a single night. Logs should preserve adherence, confounders, subjective sleep onset, and safety symptoms."
    strength: high
    sourceKeys:
      - source_artifact:pmid-31994153
      - source_artifact:pmid-17520797
      - source_artifact:pmid-18853708
      - source_artifact:pmid-21237680
      - source_artifact:pmid-29991437
      - source_artifact:pmid-29991438
      - source_artifact:pmid-29734997
      - source_artifact:pmid-34314344
      - source_artifact:pmid-40300398
      - source_artifact:pmid-41792005
    caveats:
      - Consumer sleep and HRV validity is device-specific and algorithm-specific.
      - Quiet wakefulness and meditation can confuse sleep-wake classification.
  -
    claimId: breathing-safety-excludes-forceful-or-retention-practices
    type: safety
    text: "The bedtime breathing child should exclude forceful, high-ventilation, breath-retention, and panic-provoking breathing practices. Stop rules should cover dyspnea, chest symptoms, dizziness, faintness, tingling that feels alarming, and escalating panic-like sensations."
    strength: high
    sourceKeys:
      - source_artifact:msdmanuals-hyperventilation-syndrome-2026-04-26
      - source_artifact:pmid-10683682
      - source_artifact:pmid-11485118
      - source_artifact:pmid-20685222
      - source_artifact:pmid-23728685
      - source_artifact:pmid-37923236
      - source_artifact:pmid-40223145
      - source_artifact:pmid-8680700
      - source_artifact:pmid-15136413
      - source_artifact:pmid-26116216
    caveats:
      - These sources mostly establish boundaries for unsafe or mismatched breathing practices, not precise risk estimates for gentle low-dose bedtime breathing.
  -
    claimId: meditation-safety-screen-before-silent-practice
    type: safety
    text: "Silent bedtime meditation should include compact screening and stop rules for prior adverse meditation experiences, psychosis or mania vulnerability, dissociation or depersonalization, trauma or PTSD symptoms, severe current distress, and escalating distress when attention turns inward."
    strength: high
    sourceKeys:
      - source_artifact:clinicaltrials-nct05862636-2026-04-26
      - source_artifact:wwnorton-trauma-sensitive-mindfulness-2026-04-26
      - source_artifact:pmid-28873417
      - source_artifact:pmid-41176868
      - source_artifact:pmid-39883728
      - source_artifact:pmid-20671334
      - source_artifact:pmid-34426774
      - source_artifact:pmid-380368
      - source_artifact:pmid-17848828
      - source_artifact:pmid-2191357
    caveats:
      - Most meditation-safety sources are broad mindfulness, intensive-practice, survey, framework, or case-report context rather than low-dose bedtime silent meditation.
researchLandscape:
  bottomLine: "The research base supports a cautious pre-sleep downshift chooser, not a proven combined breathing-plus-silent-meditation stack. Breathing has the closest direct but mixed evidence; silent bedtime meditation is plausible but mostly adjacent; safety and measurement boundaries should be stronger than efficacy language."
  confidenceLabel: limited
  primaryClaim: "Use the page to route users toward a single child practice and a conservative 21-night self-test, while preserving the evidence gap for the exact combined stack."
  mainCaveat: "No extracted completed trial directly tested resonance breathing before bed followed by silent meditation before bed. Several useful sources are adjacent, bundled, guided, clinical, protocol-only, or measurement/safety context."
  groups:

    -
      id: exact-combined-stack-gap
      label: Exact combined stack evidence gap
      stance: does_not_confirm
      summary: "The extraction corpus did not identify a completed direct trial of the exact combined protocol. The most relevant sources support a research-umbrella materialization and sibling child variants rather than a default stacked run."
      sourceKeys:
        - source_artifact:pmid-25234581
        - source_artifact:pmid-32366866
        - source_artifact:pmid-41886931
        - source_artifact:clinicaltrials-nct03337061-2026-04-26
        - source_artifact:pmid-41027036
        - source_artifact:pmid-25142566
        - source_artifact:pmid-27663102
      defaultOpen: true
    -
      id: direct-presleep-slow-breathing-evidence
      label: Direct pre-sleep slow breathing evidence
      stance: mixed
      summary: "Pre-sleep slow or resonance-like breathing has the closest direct evidence for this family. One small insomnia source reported PSG sleep-continuity improvements after paced breathing, while a healthy-young-adult PSG pilot did not show robust basic sleep-parameter improvement and review-level extraction separated positive self-report from inconclusive objective outcomes."
      sourceKeys:
        - source_artifact:clinicaltrials-nct05581355-2026-04-26
        - source_artifact:doi-10.17241-smr.2020.00668
        - source_artifact:doi-10.3389-frsle.2025.1603713
        - source_artifact:pmid-25234581
        - source_artifact:pmid-32366866
        - source_artifact:pmid-41886931
      defaultOpen: true
    -
      id: silent-meditation-bedtime-adjacent
      label: Silent bedtime meditation directness
      stance: mixed
      summary: "Meditation and mindfulness sources support plausibility and implementation context, but most extracted evidence is app-guided, structured clinical, protocol-only, meta-analytic, or otherwise heterogeneous. That evidence should not be rewritten as proof for unguided silent meditation immediately before bed."
      sourceKeys:
        - source_artifact:pmid-41027036
        - source_artifact:pmid-25142566
        - source_artifact:pmid-27663102
        - source_artifact:clinicaltrials-nct06972303-2026-02-23
        - source_artifact:clinicaltrials-nct04242771-2026-04-26
        - source_artifact:clinicaltrials-nct03337061-2026-04-26
        - source_artifact:doi-10.2196-72786
      defaultOpen: true
    -
      id: adjacent-guided-device-bundled-variants
      label: Adjacent guided, device, and bundled variants
      stance: context_only
      summary: "Guided apps, body-scan/music bundles, breathing devices, HRV-biofeedback programs, VR, taVNS, and commercial routines are useful context but materially different interventions. Their findings should remain adjacent unless a matching separable arm exists."
      sourceKeys:
        - source_artifact:pmid-30736268
        - source_artifact:doi-10.2174-1874944502013010232
        - source_artifact:pmid-36285420
        - source_artifact:pmid-37428349
        - source_artifact:pmid-40267472
        - source_artifact:doi-10.5298-1081-5937-41.3.08
        - source_artifact:pmid-32385728
        - source_artifact:pmid-38042286
        - source_artifact:clinicaltrials-nct06614803-2024-09-26
      defaultOpen: false
    -
      id: duration-dose-and-implementation
      label: Duration and dose uncertainty
      stance: context_only
      summary: "The 5-20 minute bedtime dose is a low-burden Murph starter-test choice informed by direct breathing, app-guided meditation, registry, and feasibility context. It should not be framed as a source-proven optimum."
      sourceKeys:
        - source_artifact:pmid-25234581
        - source_artifact:pmid-32366866
        - source_artifact:pmid-41027036
        - source_artifact:clinicaltrials-nct06972303-2026-02-23
        - source_artifact:clinicaltrials-nct04242771-2026-04-26
        - source_artifact:doi-10.2196-72786
      defaultOpen: false
    -
      id: pre-sleep-arousal-and-sleep-measurement
      label: Outcome measurement boundaries
      stance: context_only
      summary: "Sleep diaries, actigraphy, PSG context, consumer sleep trackers, nocturnal HRV, and orthosomnia sources support using logs and trend context while warning against single-night, stage-based, or device-diagnostic claims."
      sourceKeys:
        - source_artifact:pmid-31994153
        - source_artifact:pmid-17520797
        - source_artifact:pmid-18853708
        - source_artifact:pmid-21237680
        - source_artifact:pmid-29991437
        - source_artifact:pmid-29991438
        - source_artifact:pmid-29734997
        - source_artifact:pmid-34314344
        - source_artifact:pmid-40300398
        - source_artifact:pmid-41792005
        - source_artifact:pmid-30789439
        - source_artifact:pmid-31621129
        - source_artifact:pmid-32234707
        - source_artifact:pmid-26156958
        - source_artifact:pmid-31641776
        - source_artifact:pmid-38499793
      defaultOpen: false
    -
      id: breathing-safety-respiratory-boundaries
      label: Breathing safety and respiratory boundaries
      stance: safety_boundary
      summary: "Breathing safety records support excluding forceful, high-ventilation, breath-retention, and panic-provoking breathing from this bedtime protocol, and support stop rules for dyspnea, chest symptoms, dizziness, faintness, and escalating panic-like sensations."
      sourceKeys:
        - source_artifact:msdmanuals-hyperventilation-syndrome-2026-04-26
        - source_artifact:nice-panic-disorder-management-2011-01-26
        - source_artifact:pmid-10546483
        - source_artifact:pmid-10683682
        - source_artifact:pmid-11485118
        - source_artifact:pmid-14531164
        - source_artifact:pmid-15136413
        - source_artifact:pmid-15792851
        - source_artifact:pmid-20685222
        - source_artifact:pmid-21373936
        - source_artifact:pmid-23728685
        - source_artifact:pmid-24146758
        - source_artifact:pmid-24347088
        - source_artifact:pmid-26116216
        - source_artifact:pmid-27581828
        - source_artifact:pmid-29573981
        - source_artifact:pmid-30758427
        - source_artifact:pmid-32212422
        - source_artifact:pmid-36831799
        - source_artifact:pmid-37923236
        - source_artifact:pmid-40163930
        - source_artifact:pmid-40223145
        - source_artifact:pmid-8620731
        - source_artifact:pmid-8680700
        - source_artifact:statpearls-hypocarbia-2023-08-14
        - source_artifact:wimhofmethod-breathing-water-fainting-2026-04-26
      defaultOpen: true
    -
      id: meditation-safety-adverse-event-boundaries
      label: Meditation safety and adverse-experience boundaries
      stance: safety_boundary
      summary: "Meditation safety sources support compact screening for prior adverse meditation experiences, psychosis or mania vulnerability, dissociation, trauma/PTSD, and escalating distress. They justify screening and stop rules rather than precise risk estimates for low-dose bedtime practice."
      sourceKeys:
        - source_artifact:clinicaltrials-nct05862636-2026-04-26
        - source_artifact:wwnorton-trauma-sensitive-mindfulness-2026-04-26
        - source_artifact:pmid-28873417
        - source_artifact:pmid-41176868
        - source_artifact:pmid-39883728
        - source_artifact:pmid-20671334
        - source_artifact:pmid-34426774
        - source_artifact:pmid-380368
        - source_artifact:pmid-17848828
        - source_artifact:pmid-2191357
      defaultOpen: true
    -
      id: sleep-disorder-and-higher-risk-population-boundaries
      label: Sleep-disorder and higher-risk population boundaries
      stance: safety_boundary
      summary: "Guidelines and clinical reviews support routing suspected or diagnosed OSA, PAP questions, hypersomnolence or drowsy-driving risk, RLS/PLMD, parasomnias, circadian rhythm disorders, pregnancy/postpartum/lactation sleep concerns, older-adult medical complexity, and pediatric sleep concerns away from this ordinary wellness self-test and toward diagnosis-specific care or separate clinical variants."
      sourceKeys:
        - source_artifact:pmid-19960649
        - source_artifact:pmid-28162150
        - source_artifact:pmid-30736887
        - source_artifact:pmid-34743789
        - source_artifact:pmid-39324694
        - source_artifact:pmid-31271339
        - source_artifact:pmid-26414986
        - source_artifact:pmid-19738366
        - source_artifact:pmid-33312842
        - source_artifact:pmid-35659076
        - source_artifact:pmid-35419652
        - source_artifact:pmid-37411038
        - source_artifact:pmid-27064321
        - source_artifact:pmid-31622589
        - source_artifact:pmid-24347088
      defaultOpen: true
    -
      id: clinical-guideline-treatment-boundary
      label: Clinical insomnia treatment boundary
      stance: safety_boundary
      summary: "Clinical guidelines keep chronic insomnia, suspected obstructive sleep apnea, medication decisions, and treatment-resistant or complex sleep problems in evidence-based clinical care pathways. This page should remain a wellness self-experiment boundary, not a replacement for CBT-I, diagnostic testing, PAP therapy, or medication management."
      sourceKeys:
        - source_artifact:healthquality-va-gov-insomnia-osa-cpg-2025-04-22
        - source_artifact:pmid-27136449
        - source_artifact:pmid-27998379
        - source_artifact:pmid-28875581
        - source_artifact:pmid-32066145
        - source_artifact:pmid-33164742
        - source_artifact:pmid-37454606
        - source_artifact:pmid-38016484
        - source_artifact:pmid-38370879
        - source_artifact:pmid-39481275
      defaultOpen: true
    -
      id: adjacent-guided-app-vr-body-scan-meditation-variants
      label: "Adjacent Guided App Vr Body Scan Meditation Variants"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:doi-10.1007-s12671-019-01290-9
        - source_artifact:doi-10.1007-s12671-020-01512-5
        - source_artifact:doi-10.1016-j.sleh.2022.02.003
        - source_artifact:doi-10.1371-journal.pone.0322931
        - source_artifact:doi-10.3390-healthcare12161581
        - source_artifact:pmid-18502250
        - source_artifact:pmid-19114261
        - source_artifact:pmid-24395850
        - source_artifact:pmid-31296508
        - source_artifact:pmid-32241625
        - source_artifact:pmid-32939342
        - source_artifact:pmid-33411779
        - source_artifact:pmid-34193328
        - source_artifact:pmid-34297230
        - source_artifact:pmid-34377217
        - source_artifact:pmid-35503653
        - source_artifact:pmid-35896519
        - source_artifact:pmid-37271575
        - source_artifact:pmid-37304656
        - source_artifact:pmid-37434109
        - source_artifact:pmid-37467038
        - source_artifact:pmid-38001316
        - source_artifact:pmid-39071123
        - source_artifact:pmid-40194914
        - source_artifact:pmid-40267472
        - source_artifact:pmid-40324172
        - source_artifact:pmid-41339476
        - source_artifact:pmid-41426462
        - source_artifact:pmid-41637757
      defaultOpen: false
    -
      id: adjacent-guided-device-bundled-breathing-variants
      label: "Adjacent Guided Device Bundled Breathing Variants"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:clinicaltrials-nct06475378-2026-04-26
        - source_artifact:clinicaltrials-nct06914167-2026-04-26
        - source_artifact:doi-10.2174-1874944502013010232
        - source_artifact:pmid-29441644
        - source_artifact:pmid-30736268
        - source_artifact:pmid-34734052
        - source_artifact:pmid-35404223
        - source_artifact:pmid-36274653
        - source_artifact:pmid-36285420
        - source_artifact:pmid-37428349
        - source_artifact:pmid-38865177
        - source_artifact:pmid-40529836
      defaultOpen: false
    -
      id: breathing-implementation-context
      label: "Breathing Implementation Context"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-38137060
      defaultOpen: false
    -
      id: breathing-relaxation-adjacent-variants
      label: "Breathing Relaxation Adjacent Variants"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-30761030
        - source_artifact:pmid-33383396
        - source_artifact:pmid-40085337
      defaultOpen: false
    -
      id: cbti-clinical-standard-context
      label: "Cbti Clinical Standard Context"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-26054060
        - source_artifact:pmid-33164741
      defaultOpen: false
    -
      id: clinical-boundary-guidelines
      label: "Clinical Boundary Guidelines"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-19738366
        - source_artifact:pmid-19960649
        - source_artifact:pmid-25553600
        - source_artifact:pmid-25686304
        - source_artifact:pmid-26094920
        - source_artifact:pmid-26414986
        - source_artifact:pmid-27064321
        - source_artifact:pmid-27751669
        - source_artifact:pmid-28162150
        - source_artifact:pmid-30736887
        - source_artifact:pmid-31271339
        - source_artifact:pmid-31622589
        - source_artifact:pmid-33312842
        - source_artifact:pmid-34743789
        - source_artifact:pmid-35419652
        - source_artifact:pmid-35659076
        - source_artifact:pmid-36378202
        - source_artifact:pmid-36378203
        - source_artifact:pmid-36529887
        - source_artifact:pmid-37411038
        - source_artifact:pmid-39324694
      defaultOpen: false
    -
      id: clinical-supervised-hrv-biofeedback-rf-training
      label: "Clinical Supervised Hrv Biofeedback Rf Training"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:clinicaltrials-nct06614803-2024-09-26
        - source_artifact:doi-10.1161-01.hyp.0000179581.68566.7d
        - source_artifact:doi-10.29052-ijehsr.v11.i3.2023.154-162
        - source_artifact:doi-10.5298-1081-5937-41.3.08
        - source_artifact:pmid-10999236
        - source_artifact:pmid-11790690
        - source_artifact:pmid-12001882
        - source_artifact:pmid-12737093
        - source_artifact:pmid-14508023
        - source_artifact:pmid-16838124
        - source_artifact:pmid-19418214
        - source_artifact:pmid-23959190
        - source_artifact:pmid-25101026
        - source_artifact:pmid-25156003
        - source_artifact:pmid-29718876
        - source_artifact:pmid-30183463
        - source_artifact:pmid-30790211
        - source_artifact:pmid-30905122
        - source_artifact:pmid-32158764
        - source_artifact:pmid-32285231
        - source_artifact:pmid-32385728
        - source_artifact:pmid-32958502
        - source_artifact:pmid-33117119
        - source_artifact:pmid-35250623
        - source_artifact:pmid-35733879
        - source_artifact:pmid-35931415
        - source_artifact:pmid-36917418
        - source_artifact:pmid-37103669
        - source_artifact:pmid-37804409
        - source_artifact:pmid-38042286
        - source_artifact:pmid-38063977
        - source_artifact:pmid-39864026
        - source_artifact:pmid-40873182
        - source_artifact:pmid-41324027
      defaultOpen: false
    -
      id: general-adjacent-context-low-priority-recall
      label: "General Adjacent Context Low Priority Recall"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:doi-10.1007-s12671-017-0717-y
        - source_artifact:pmid-29016274
        - source_artifact:pmid-29787483
        - source_artifact:pmid-30708288
        - source_artifact:pmid-35168972
        - source_artifact:pmid-39636885
        - source_artifact:pmid-41482169
      defaultOpen: false
    -
      id: hrv-measurement-context
      label: "Hrv Measurement Context"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-28265249
        - source_artifact:pmid-8598068
      defaultOpen: false
    -
      id: measurement-actigraphy-guidelines
      label: "Measurement Actigraphy Guidelines"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-17520797
        - source_artifact:pmid-18853708
        - source_artifact:pmid-21237680
        - source_artifact:pmid-29991437
        - source_artifact:pmid-29991438
        - source_artifact:pmid-7618028
      defaultOpen: false
    -
      id: measurement-actigraphy-psg-validation
      label: "Measurement Actigraphy Psg Validation"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-16494091
        - source_artifact:pmid-24179309
        - source_artifact:pmid-31154154
      defaultOpen: false
    -
      id: measurement-consumer-sleep-technology-guidance
      label: "Measurement Consumer Sleep Technology Guidance"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-26156958
        - source_artifact:pmid-29734997
        - source_artifact:pmid-30789439
        - source_artifact:pmid-31621129
        - source_artifact:pmid-31641776
        - source_artifact:pmid-32234707
        - source_artifact:pmid-34314344
        - source_artifact:pmid-38499793
        - source_artifact:pmid-40300398
        - source_artifact:pmid-41792005
      defaultOpen: false
    -
      id: measurement-consumer-tracker-validation
      label: "Measurement Consumer Tracker Validation"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-28606497
        - source_artifact:pmid-31626361
        - source_artifact:pmid-31680327
        - source_artifact:pmid-31778122
        - source_artifact:pmid-33378539
        - source_artifact:pmid-36016077
        - source_artifact:pmid-36256631
        - source_artifact:pmid-37917155
      defaultOpen: false
    -
      id: measurement-nocturnal-hrv-validation
      label: "Measurement Nocturnal Hrv Validation"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-30706234
        - source_artifact:pmid-30906922
        - source_artifact:pmid-35040799
        - source_artifact:pmid-39686012
        - source_artifact:pmid-40834291
        - source_artifact:pmid-41268189
      defaultOpen: false
    -
      id: measurement-orthosomnia-safety
      label: "Measurement Orthosomnia Safety"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-27855740
      defaultOpen: false
    -
      id: measurement-sleep-diary
      label: "Measurement Sleep Diary"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-22294820
        - source_artifact:pmid-25905662
        - source_artifact:pmid-27231885
        - source_artifact:pmid-28199718
        - source_artifact:pmid-33666165
      defaultOpen: false
    -
      id: meditation-bedtime-dose-evidence
      label: "Meditation Bedtime Dose Evidence"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:clinicaltrials-nct03337061-2026-04-26
        - source_artifact:clinicaltrials-nct04242771-2026-04-26
        - source_artifact:clinicaltrials-nct06972303-2026-02-23
        - source_artifact:doi-10.2196-72786
        - source_artifact:pmid-25142566
        - source_artifact:pmid-27663102
        - source_artifact:pmid-41027036
      defaultOpen: false
    -
      id: meditation_safety_adverse_event_boundaries
      label: "Meditation Safety Adverse Event Boundaries"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:clinicaltrials-nct05862636-2026-04-26
        - source_artifact:doi-10.1007-s12144-021-01503-2
        - source_artifact:doi-10.1007-s12671-014-0329-8
        - source_artifact:doi-10.1007-s12671-017-0878-8
        - source_artifact:doi-10.1007-s12671-018-0897-0
        - source_artifact:doi-10.1007-s12671-022-01915-6
        - source_artifact:doi-10.1007-s12671-024-02384-9
        - source_artifact:doi-10.1093-oxfordhb-9780198808640.013.51
        - source_artifact:doi-10.1177-21677026241298269
        - source_artifact:doi-10.1192-bjo.2021.1066
        - source_artifact:pmid-17848828
        - source_artifact:pmid-20671334
        - source_artifact:pmid-2191357
        - source_artifact:pmid-28542181
        - source_artifact:pmid-28873417
        - source_artifact:pmid-29475163
        - source_artifact:pmid-30638824
        - source_artifact:pmid-31071152
        - source_artifact:pmid-31668156
        - source_artifact:pmid-32807249
        - source_artifact:pmid-32820538
        - source_artifact:pmid-34074221
        - source_artifact:pmid-34385088
        - source_artifact:pmid-34426774
        - source_artifact:pmid-34735517
        - source_artifact:pmid-35174010
        - source_artifact:pmid-35464906
        - source_artifact:pmid-380368
        - source_artifact:pmid-38851179
        - source_artifact:pmid-39514882
        - source_artifact:pmid-39883728
        - source_artifact:pmid-41176868
        - source_artifact:wwnorton-trauma-sensitive-mindfulness-2026-04-26
      defaultOpen: false
    -
      id: mindfulness-dose-and-practice-burden
      label: "Mindfulness Dose And Practice Burden"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:doi-10.1007-s12671-020-01319-4
        - source_artifact:pmid-28527330
      defaultOpen: false
    -
      id: mindfulness-insomnia-mechanism-and-context
      label: "Mindfulness Insomnia Mechanism And Context"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:clinicaltrials-nct00768781-2026-04-26
        - source_artifact:doi-10.1002-smi.1370
        - source_artifact:doi-10.1007-s11920-022-01370-z
        - source_artifact:doi-10.1007-s12671-018-0911-6
        - source_artifact:pmid-18005910
        - source_artifact:pmid-20853441
        - source_artifact:pmid-22975073
        - source_artifact:pmid-24512477
        - source_artifact:pmid-28191449
        - source_artifact:pmid-30294523
        - source_artifact:pmid-32247571
        - source_artifact:pmid-38597262
      defaultOpen: false
    -
      id: mindfulness-relaxation-program-variants
      label: "Mindfulness Relaxation Program Variants"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:doi-10.1016-j.aimed.2024.08.005
        - source_artifact:pmid-21397868
        - source_artifact:pmid-25843539
        - source_artifact:pmid-28647747
        - source_artifact:pmid-29706914
        - source_artifact:pmid-30380915
        - source_artifact:pmid-30575050
        - source_artifact:pmid-31029188
        - source_artifact:pmid-32590218
        - source_artifact:pmid-35582336
        - source_artifact:pmid-36150798
        - source_artifact:pmid-36332952
        - source_artifact:pmid-37361010
        - source_artifact:pmid-38179560
        - source_artifact:pmid-38312915
        - source_artifact:pmid-39306634
      defaultOpen: false
    -
      id: mindfulness-safety-and-reporting-boundaries
      label: "Mindfulness Safety And Reporting Boundaries"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-33428616
      defaultOpen: false
    -
      id: mood-disorder-complementary-treatment-boundary
      label: "Mood Disorder Complementary Treatment Boundary"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-27486153
      defaultOpen: false
    -
      id: older-adult-sleep-disorder-screening-context
      label: "Older Adult Sleep Disorder Screening Context"
      stance: safety_boundary
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-17452665
      defaultOpen: false
    -
      id: pre-sleep-arousal-cognitive-downshift-mechanisms
      label: "Pre Sleep Arousal Cognitive Downshift Mechanisms"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:doi-10.1007-s12671-019-01217-4
        - source_artifact:pmid-11863237
        - source_artifact:pmid-12186352
        - source_artifact:pmid-12651993
        - source_artifact:pmid-14565893
        - source_artifact:pmid-14998240
        - source_artifact:pmid-15310517
        - source_artifact:pmid-19481481
        - source_artifact:pmid-20673289
        - source_artifact:pmid-22281450
        - source_artifact:pmid-24503474
        - source_artifact:pmid-29599851
        - source_artifact:pmid-31030873
        - source_artifact:pmid-32009886
        - source_artifact:pmid-36624160
        - source_artifact:pmid-37183177
        - source_artifact:pmid-39137665
        - source_artifact:pmid-4004706
        - source_artifact:pmid-9773766
      defaultOpen: false
    -
      id: pre-sleep-arousal-measurement-context
      label: "Pre Sleep Arousal Measurement Context"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-20467003
        - source_artifact:pmid-30929703
        - source_artifact:pmid-31545084
      defaultOpen: false
    -
      id: sleep-measurement-context
      label: "Sleep Measurement Context"
      stance: context_only
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:pmid-17040003
      defaultOpen: false
    -
      id: slow-breathing-autonomic-and-resonance-mechanisms
      label: "Slow Breathing Autonomic And Resonance Mechanisms"
      stance: mixed
      summary: "Evidence-appraisal group retained from source extraction so protocol-specific claims remain traceable without reclassifying adjacent or safety-only evidence as direct proof."
      sourceKeys:
        - source_artifact:doi-10.1007-s12671-023-02294-2
        - source_artifact:doi-10.3390-su13147775
        - source_artifact:pmid-11380537
        - source_artifact:pmid-11725167
        - source_artifact:pmid-24380741
        - source_artifact:pmid-28187954
        - source_artifact:pmid-28890890
        - source_artifact:pmid-29034226
        - source_artifact:pmid-29059210
        - source_artifact:pmid-29209423
        - source_artifact:pmid-30245619
        - source_artifact:pmid-35167847
        - source_artifact:pmid-35308668
        - source_artifact:pmid-35623448
        - source_artifact:pmid-36219384
        - source_artifact:pmid-38092805
        - source_artifact:pmid-41569822
        - source_artifact:pmid-8307890
        - source_artifact:pmid-9401419
      defaultOpen: false
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - chronic_or_treatment_resistant_insomnia
    - obstructive_sleep_apnea_or_cpap_questions
    - restless_legs_or_periodic_limb_movements
    - parasomnia_or_circadian_rhythm_disorder
    - pregnancy_postpartum_or_lactation
    - sedative_or_sleep_medication_changes
    - older_adult_with_polypharmacy_or_fall_risk
    - pediatric_or_adolescent
    - respiratory_disease_asthma_or_breathlessness
    - dysfunctional_breathing_or_hyperventilation
    - fainting_history_or_breathwork_adverse_reaction
    - pacemaker_arrhythmia_or_unstable_cardiac_disease
    - panic_disorder_or_diagnosed_anxiety_disorder
    - ptsd_trauma_dissociation_or_depersonalization
    - prior_adverse_meditation_experience
    - bipolar_mania_or_psychosis_vulnerability
    - severe_depression_or_suicidality
  stopIf:
    - Air hunger, overbreathing, chest pain or tightness, palpitations, severe or new shortness of breath, faintness, dizziness, alarming tingling, or escalating panic-like sensations.
    - Derealization, depersonalization, dissociation, traumatic re-experiencing, hallucinations, delusions, intense agitation, unusual mood elevation, mania-like activation, or psychosis-like experiences.
    - New or worsening depression, self-harm thoughts, suicidal thoughts, or feeling unsafe.
    - Pain or shortness of breath caused by posture, body scanning, or repositioning.
    - Sleep attacks, unsafe daytime sleepiness, drowsy driving, loud snoring with witnessed apneas, gasping, disruptive limb movements, dream enactment, sleepwalking, or major sleep-timing instability.
    - Sleep worsens meaningfully for three consecutive nights without an obvious outside cause, or worsens severely after one night with marked next-day impairment.
    - The routine increases bedtime anxiety, rumination, clock-watching, orthosomnia-like fixation, or fear of not sleeping.
  notes:
    - Safety stronger than efficacy — this is a chooser, not a treatment page.
    - No breath holds, high-ventilation, forceful pranayama, breath of fire, holotropic, or Wim-Hof breathing.
    - Mindfulness, CBT-I, apps, VR, body-scan/music, and HRV-biofeedback are separate protocols.
---

## How to use this page

This page is intentionally a chooser and research umbrella. For a clean Murph experiment, choose **one** child practice for the intervention window: gentle resonance-like breathing before bed, or silent meditation before bed. The exact combined stack of resonance breathing followed by silent meditation has not been directly established in the extracted research corpus, so a combined run should be labeled exploratory and analyzed separately.

## Default self-test

Only run this default self-test if the sleep issue is mild, non-urgent, and not explained by red flags. Do not use the 21-night self-test to delay care for chronic or impairing insomnia, suspected or diagnosed sleep apnea, PAP/CPAP questions, severe daytime sleepiness, sleep attacks, drowsy driving, restless legs or limb movements, parasomnia behaviors, circadian rhythm problems, pregnancy/postpartum/lactation sleep disruption, medication changes, severe mood symptoms, panic/respiratory symptoms, trauma/dissociation, psychosis, mania, or pediatric/adolescent sleep concerns.

Use seven baseline nights, then fourteen intervention nights. During intervention, keep the chosen practice short, gentle, and repeatable. The minimum useful adherence target is ten completed practice nights, with twelve or more as the preferred target.

The primary practical outcome is whether you fall asleep more easily or feel less keyed-up before sleep. Use wearable sleep onset, sleep efficiency, HRV, and resting heart rate as context rather than proof. Consumer sleep devices and actigraphy can misclassify quiet wakefulness, so pair device trends with a brief log.

## Boundary from clinical care

This protocol is not a substitute for CBT-I, sleep-disorder evaluation, PAP therapy, or medication guidance. Persistent or impairing insomnia, suspected obstructive sleep apnea, restless legs, circadian rhythm disorder, severe mood symptoms, pregnancy or peripartum sleep problems, and medication decisions belong in clinical care pathways.
