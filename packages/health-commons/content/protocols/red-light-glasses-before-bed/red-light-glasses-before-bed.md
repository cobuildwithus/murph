---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:red-light-glasses-before-bed/red-light-glasses-before-bed
slug: protocols/red-light-glasses-before-bed/red-light-glasses-before-bed
title: Red-Light Glasses Before Bed
summary: "A low-burden evening experiment: wear high-filtering amber/red/brown glasses before bed for two weeks and see whether the last hour of the night feels calmer and sleep comes more easily."
status: draft
quality: usable
aliases:
  - red light glasses before bed
  - amber glasses before bed
  - blue-blocking glasses before bed
  - blue light blocking glasses for sleep
  - evening red glasses sleep experiment
categories:
  - sleep
  - circadian
  - evening-light
  - wearable-measured
  - murph-canonical
relations:
  -
    type: parent_family
    target: experiment_family:evening-light-reduction
  -
    type: primary_biomarker
    target: biomarker:sleep-onset-latency
  -
    type: secondary_biomarker
    target: biomarker:sleep-efficiency
  -
    type: secondary_biomarker
    target: biomarker:deep-sleep-minutes
  -
    type: secondary_biomarker
    target: biomarker:hrv-rmssd
  -
    type: secondary_biomarker
    target: biomarker:resting-heart-rate
  -
    type: cites
    target: source_artifact:red-light-glasses-before-bed-bibliography
  -
    type: cites
    target: source_artifact:pmid-41341515
  -
    type: cites
    target: source_artifact:pmid-40728371
  -
    type: cites
    target: source_artifact:pmid-37192881
  -
    type: cites
    target: source_artifact:pmid-37593770
  -
    type: cites
    target: source_artifact:pmid-35298459
  -
    type: cites
    target: source_artifact:doi-10.17617-1.4a6s-ec74
  -
    type: cites
    target: source_artifact:pmid-29101797
  -
    type: cites
    target: source_artifact:pmid-20030543
  -
    type: cites
    target: source_artifact:pmid-33707105
  -
    type: cites
    target: source_artifact:pmid-30427265
  -
    type: cites
    target: source_artifact:pmid-35089982
  -
    type: cites
    target: source_artifact:pmid-35024497
  -
    type: cites
    target: source_artifact:pmid-29991437
  -
    type: cites
    target: source_artifact:pmid-33587901
  -
    type: cites
    target: source_artifact:pmid-36051910
  -
    type: cites
    target: source_artifact:pmid-41166315
  -
    type: cites
    target: source_artifact:pmid-41565717
  -
    type: cites
    target: source_artifact:pmid-27322730
  -
    type: cites
    target: source_artifact:pmid-15713707
  -
    type: cites
    target: source_artifact:pmid-27226262
  -
    type: cites
    target: source_artifact:pmid-26414986
  -
    type: cites
    target: source_artifact:pmid-41421618
lineage:
  relationship: root
  rationale: Default evening-eyewear experiment designed to be easy to try and easy to stop if it does not help.
attribution:
  ownerType: murph
protocol:
  doseSignature: Nightly · 90–120 min before intended bedtime · high-filtering amber/red/brown glasses · 14-night intervention after 7-day baseline
  target: high-filtering amber, red, or brown evening glasses
  frequency:
    sessionsPerWeek: 7
  durationMinutes:
    min: 90
    max: 120
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 12
  steps:
    - For 14 intervention nights, put the glasses on 90–120 minutes before intended bedtime.
    - Wear them indoors only during the pre-bed window, then remove them before sleep.
    - Remove the glasses before driving, cycling, cooking with visual hazards, navigating stairs or unfamiliar low-light spaces, or doing color-critical work.
    - Log wear time, bedtime target, actual bedtime, screens, room light, caffeine or alcohol, stress, and any symptoms.
  tips:
    - Use high-filtering amber, red, or brown lenses with good fit; lens color alone is not proof of useful filtering.
    - Keep room lighting, screen brightness, bedtime target, caffeine, alcohol, exercise timing, sleep supplements, and melatonin as stable as practical.
    - Do not add a new screen curfew, sleep supplement, bedtime, light-therapy device, or major room-light redesign during this test.
    - Do not wear strong filtering lenses during the day; daytime light is a different signal.
  keepInMind:
    - Direct human evidence for evening blue-blocking glasses is small and mixed, especially for objective actigraphy or wearable sleep outcomes.
    - The clearest personal signal may be feeling less wired or falling asleep more easily, not a dramatic sleep-stage change.
    - Mood-disorder, delayed-sleep-phase, pregnancy, pediatric, shift-work, and clinical lighting protocols are separate clinician-guided variants.
  logFields:
    - glasses on time
    - intended bedtime
    - actual bedtime
    - screen use
    - room-light brightness
    - caffeine timing
    - alcohol
    - mood or symptoms
  stopConditions:
    - Stop the night’s session if the glasses cause headache, dizziness, nausea, eye discomfort, unsafe low-light navigation, or clumsiness.
    - End the experiment if mood becomes unusually elevated, unusually low, agitated, or unstable.
    - End the experiment if sleep feels meaningfully worse for three consecutive nights and no obvious outside cause explains it.
    - End the experiment if the protocol creates anxiety, fixation, or friction that outweighs any benefit.
testPlans:
  -
    planId: sol-proxy-21d
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
    primaryBiomarkerKey: biomarker:sleep-onset-latency
    secondaryBiomarkerKeys:
      - biomarker:sleep-efficiency
      - biomarker:deep-sleep-minutes
      - biomarker:hrv-rmssd
      - biomarker:resting-heart-rate
    minimumAdherenceSessions: 10
    targetAdherenceSessions: 12
    notes:
      - Use a wearable sleep-onset estimate when available, but pair it with a one-tap subjective estimate because consumer wearables and actigraphy can misclassify quiet wakefulness.
      - Compare intervention-window averages against the user’s own 7-day baseline rather than highlighting single-night changes.
      - Treat HRV, resting heart rate, sleep stages, and total sleep time as exploratory unless the personal signal is repeated and not obviously confounded.
      - The primary practical question is whether evenings feel less wired and sleep onset appears earlier, not whether every sleep metric improves.
whyItWorks:
  - Evening melanopic and short-wavelength light can tell the circadian system that it is still daytime, increasing alerting and potentially delaying the body’s night signal. High-filtering glasses are one low-friction way to reduce that input during the pre-bed window.
  - The intervention is useful as a self-test because it changes light exposure without requiring a full evening routine overhaul. If it helps, the earliest signal is likely less pre-bed wiredness or shorter perceived sleep onset.
  - The research is mixed for objective sleep metrics, so wearable sleep stages, HRV, and resting heart rate should stay exploratory. A quiet subjective improvement can still be worth noticing, but this protocol should not claim eye protection, insomnia treatment, or guaranteed sleep-score gains.
claims:
  -
    claimId: evening-melanopic-light-reduction-is-plausible
    type: mechanistic
    text: Reducing evening melanopic or short-wavelength light is a plausible way to reduce pre-bed alerting and protect circadian timing, but glasses are only one implementation of that broader light-management idea.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-35298459
      - source_artifact:doi-10.17617-1.4a6s-ec74
    caveats:
      - Plausible mechanism is not the same as reliable wearable improvement.
      - Ambient room light and screen brightness may matter as much as the glasses.
  -
    claimId: direct-glasses-evidence-is-small-and-mixed
    type: mixed_evidence
    text: Human intervention evidence for evening blue-blocking glasses is small and mixed; recent adult actigraphy synthesis did not find statistically significant pooled improvements in sleep onset latency, total sleep time, sleep efficiency, or wake after sleep onset.
    strength: high
    sourceKeys:
      - source_artifact:pmid-41341515
      - source_artifact:pmid-37192881
      - source_artifact:pmid-34030534
      - source_artifact:pmid-37593770
    caveats:
      - Some individual studies report subjective sleep benefits.
      - Lack of statistically significant pooled actigraphy effects does not rule out personal benefit in a specific user.
  -
    claimId: two-hour-evening-window-is-a-practical-first-test
    type: design_guardrail
    text: A 90–120 minute pre-bed window is a practical first test because it matches the most directly relevant small trials better than all-evening or overnight protocols.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29101797
      - source_artifact:pmid-20030543
      - source_artifact:pmid-33707105
      - source_artifact:pmid-40728371
      - source_artifact:pmid-35298459
    caveats:
      - The evidence does not establish one exact best timing window.
      - Longer evening use may increase burden without clearly improving objective signal.
  -
    claimId: subjective-sleep-onset-may-move-before-wearables
    type: intervention_result
    text: If the protocol works for a user, the clearest early signal is likely shorter perceived sleep onset or less pre-bed wiredness; wearable sleep-stage and HRV changes are exploratory.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-29101797
      - source_artifact:pmid-20030543
      - source_artifact:pmid-33707105
      - source_artifact:pmid-41341515
    caveats:
      - Subjective benefit can reflect expectation, routine stability, or reduced screen use.
      - Actigraphy and consumer wearables may miss quiet wakefulness.
  -
    claimId: product-spectral-quality-matters
    type: design_guardrail
    text: Lens color and marketing language are not enough; product spectral filtering, fit, leakage, ambient light, and screen brightness can change whether the intervention actually reduces melanopic input.
    strength: high
    sourceKeys:
      - source_artifact:pmid-40728371
      - source_artifact:pmid-35298459
    caveats:
      - Focus on lens quality and fit rather than recommending a specific brand.
      - Weak clear blue-light lenses should not be treated as equivalent to high-filtering evening lenses.
  -
    claimId: adjacent-clinical-variants-should-not-be-merged
    type: design_guardrail
    text: Delayed sleep phase disorder, pregnancy, pediatric use, shift work, bipolar or mania virtual-darkness protocols, and psychiatric ward lighting are adjacent variants, not evidence that a general adult bedtime-glasses experiment will work.
    strength: high
    sourceKeys:
      - source_artifact:pmid-35089982
      - source_artifact:pmid-35024497
      - source_artifact:pmid-41421618
    caveats:
      - Those populations may need different timing, supervision, signals, and safety framing.
      - Mood-disorder and circadian-disorder protocols should be clinician-guided.
  -
    claimId: eye-strain-and-eye-protection-claims-are-not-this-protocol
    type: design_guardrail
    text: This protocol should not claim eye-strain relief, retinal protection, or macular-health benefit from blue-light glasses.
    strength: high
    sourceKeys:
      - source_artifact:pmid-37593770
    caveats:
      - Users with persistent eye symptoms should consider an eye exam rather than using this protocol as eye care.
  -
    claimId: daytime-light-is-not-the-enemy
    type: design_guardrail
    text: This experiment should not encourage all-day blue-light avoidance; the intervention is specifically about lowering evening melanopic exposure while preserving healthy daytime light exposure.
    strength: high
    sourceKeys:
      - source_artifact:pmid-35298459
      - source_artifact:doi-10.17617-1.4a6s-ec74
    caveats:
      - Morning and daytime light can be beneficial for circadian stability.
      - Daytime use of strong filtering lenses is a different intervention.
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - bipolar_disorder_or_history_of_mania_or_hypomania
    - active_severe_depression_or_recent_mood_instability
    - delayed_sleep_phase_disorder_or_other_circadian_rhythm_sleep_wake_disorder
    - pregnancy
    - children_or_adolescents
    - shift_work_or_planned_overnight_wakefulness
    - current_timed_light_therapy
    - current_melatonin_timing_protocol
    - significant_fall_risk_or_low_light_navigation_risk
    - color_critical_work_or_safety_critical_evening_tasks
    - eye_disease_or_new_visual_symptoms
  stopIf:
    - headache
    - dizziness
    - nausea
    - eye_pain_or_visual_discomfort
    - unsafe_clumsiness_or_trip_risk
    - unusually_elevated_mood_or_agitation
    - unusually_low_mood
    - sleep_worsens_for_three_consecutive_nights
    - experiment_creates_tracking_anxiety_or_rumination
  notes:
    - This is a bounded wellness self-experiment, not treatment for insomnia, circadian rhythm disorder, depression, mania, or eye disease.
    - Do not combine with new melatonin, sleep supplements, light therapy, or a new screen curfew during the same test window.
    - Do not wear the glasses during driving, cycling, cooking with visual hazards, stair navigation if visibility is reduced, color-critical tasks, or unfamiliar low-light environments.
    - If evening light is already dim and screen use is already low, the expected signal may be small or absent.
lensSpec:
  preferred: Published spectral transmittance or melanopic daylight filtering density data; if available, prefer lenses that substantially reduce melanopic or short-wavelength input rather than weak clear office lenses.
  practicalFallback: Wraparound amber/red/brown glasses marketed for evening blue-light blocking, used only during the pre-bed window.
  avoidAsPrimaryIntervention: Clear office/computer lenses with weak blue-light filtering and no spectral data.
researchCoverage:
  bibliographyKey: source_artifact:red-light-glasses-before-bed-bibliography
  corpusStats:
    refinedRecords: 42
    directAdultCrossoverRCTsInActigraphyMetaAnalysis: 3
    participantsInActigraphyMetaAnalysis: 49
    highestPriorityProtocolRecords: 18
    auditCutoff: 2026-04-20
  shortlistBucketCounts:
    evidence-backbone: 8
    protocol-dose-and-design: 7
    wearable-or-testable-endpoints: 5
    safety-and-contraindications: 10
    adjacent-variants-to-split: 9
    context-only-rationale: 7
  backboneSourceKeys:
    - source_artifact:pmid-40728371
    - source_artifact:pmid-41341515
    - source_artifact:pmid-37192881
    - source_artifact:pmid-34030534
    - source_artifact:pmid-37593770
    - source_artifact:pmid-35298459
    - source_artifact:doi-10.17617-1.4a6s-ec74
    - source_artifact:pmid-29991437
  causalInterventionSourceKeys:
    - source_artifact:pmid-29101797
    - source_artifact:pmid-20030543
    - source_artifact:pmid-33707105
    - source_artifact:pmid-35089982
    - source_artifact:pmid-35024497
  safetySourceKeys:
    - source_artifact:pmid-37593770
    - source_artifact:pmid-41421618
nightlyLoggingFields:
  - glasses_worn
  - glasses_on_time
  - glasses_off_time
  - intended_bedtime
  - actual_bedtime
  - estimated_time_to_fall_asleep_minutes
  - felt_less_wired_before_bed
  - screen_use_last_2h
  - room_light_brightness_last_2h
  - caffeine_after_noon
  - alcohol_last_24h
  - hard_training_last_24h
  - late_exercise
  - travel_or_timezone_shift
  - illness_or_fever
  - unusual_stress
  - new_supplement_or_medication_change
  - headache_or_visual_discomfort
  - mood_change
confoundersToTrack:
  - major_bedtime_change
  - major_wake_time_change
  - alcohol_last_24h
  - caffeine_after_noon
  - hard_training_last_24h
  - late_exercise
  - illness_or_fever
  - travel_or_timezone_shift
  - unusual_stress
  - new_supplement_or_medication_change
  - melatonin_or_light_therapy_change
  - new_screen_curfew_or_room_lighting_change
  - partner_child_pet_sleep_disruption
---

## Question this experiment answers

After a stable baseline, does wearing high-filtering amber/red/brown glasses for the last **90–120 minutes before bed** make the evening feel less wired or sleep come more easily?

## Simple version

Run a 21-day experiment:

- **7 baseline days**
- **14 intervention nights**
- glasses on **90–120 minutes before intended bedtime**
- **12 target nights**, with **10 nights** as the minimum for a useful first read
- no daytime use
- no new melatonin, sleep supplements, screen curfew, bedtime target, or room-light redesign during the same test

Use the simplest version first. This is not “avoid blue light forever.” It is a short test of whether lowering evening melanopic light helps you wind down.

## Why this version

The evidence points in two directions at once. Lowering evening melanopic light is biologically plausible, but direct glasses trials are small, mixed, and often stronger on subjective sleep than objective actigraphy.

That makes this a good low-burden experiment, not a promise. The practical question is whether your evenings feel calmer and whether sleep onset looks easier often enough to repeat.

## What counts as a signal

Primary signal:

- shorter subjective or wearable-estimated sleep-onset latency compared with your own 7-day baseline

Useful subjective check:

- “Did I feel less wired in the last hour before bed?”

Exploratory signals:

- sleep efficiency
- total sleep time
- deep-sleep minutes
- HRV RMSSD
- resting heart rate

A result is interesting only when it repeats across multiple adherent nights and is not obviously explained by bedtime shifts, alcohol, caffeine, travel, illness, stress, hard training, or another routine change.

## Product and safety notes

Lens quality matters. A clear office lens with weak filtering is not the same intervention as high-filtering amber/red/brown evening eyewear. When spectral transmittance or melanopic daylight filtering density is available, prefer that over marketing labels.

Keep this separate from delayed sleep phase disorder, shift work, pregnancy, pediatric use, depression, bipolar/mania, inpatient psychiatric ward lighting, and screen-software variants. Those may use similar mechanisms but need different supervision, signals, and safety language.

## Off-ramp

At the end of 21 days, choose the plainest conclusion:

1. **Worth repeating** if sleep onset or pre-bed wiredness clearly improved with low burden.
2. **Probably noise** if only one or two nights moved or the signal was confounded.
3. **Not worth it** if the tint was annoying, unsafe, mood-disrupting, or made sleep worse.
