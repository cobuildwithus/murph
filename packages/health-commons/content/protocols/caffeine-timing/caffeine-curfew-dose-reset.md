---
schemaVersion: murph.commons.page.v1
entityType: protocol_variant
key: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
slug: protocols/caffeine-timing/caffeine-curfew-dose-reset
title: Caffeine Curfew + Dose Reset
summary: For 14 days, move ordinary caffeine before the earlier of 10-11am or 8 hours before intended bedtime, while logging dose, source, sleep, withdrawal symptoms, and safety boundaries.
status: draft
quality: usable
aliases:
  - caffeine curfew dose reset
  - no caffeine after 10am
  - no caffeine after 11am
  - 8-hour caffeine cutoff
  - morning-only caffeine reset
categories:
  - sleep
  - caffeine
  - circadian
  - behavior-change
  - murph-canonical
relations:
  -
    type: parent_family
    target: experiment_family:caffeine-timing
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
    type: cites
    target: source_artifact:pmid-24235903
  -
    type: cites
    target: source_artifact:pmid-39377163
  -
    type: cites
    target: source_artifact:pmid-16704567
  -
    type: cites
    target: source_artifact:pmid-26378246
  -
    type: cites
    target: source_artifact:pmid-15448977
  -
    type: cites
    target: source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
  -
    type: cites
    target: source_artifact:ncbi-bookshelf-caffeine-withdrawal-2026-04-26
lineage:
  relationship: root
  rationale: Default Murph caffeine-timing self-experiment for moving ordinary caffeine earlier while preserving dose transparency and safety boundaries.
attribution:
  ownerType: murph
protocol:
  doseSignature: 14 days of ordinary caffeine before 10-11am or at least 8 hours before bedtime
  target: ordinary caffeine sources with all-source dose logging
  frequency:
    sessionsPerWeek: 7
  interventionSessionsMinimum: 10
  interventionSessionsTarget: 14
  steps:
    - Run a 7-day baseline if possible, logging usual caffeine timing, source, estimated milligrams, and sleep.
    - Choose an intended bedtime and set the daily cutoff as the earlier of 10-11am or 8 hours before that bedtime.
    - For 14 days, keep ordinary caffeine before the cutoff and log every source, including coffee, tea, cola, chocolate/cocoa, decaf, energy products, supplements, and caffeine-containing medicines.
    - Keep total daily caffeine and the largest single serving stable or lower than baseline; do not front-load, stack, or increase the largest serving to compensate.
    - Review adherent days against baseline while checking alcohol, illness, travel, stress, late exercise, medication or supplement changes, and schedule changes.
  tips:
    - Use label or trusted table estimates for milligrams; cup counts alone are too crude.
    - The 8-hour buffer is a cautious testing rule, not a guarantee that caffeine has cleared for everyone.
    - A small accidental ordinary-caffeine exposure should be logged as a curfew miss rather than treated as a failed experiment.
  keepInMind:
    - The exact 14-day 10-11am-or-8-hour rule has not been directly tested as a complete protocol.
    - Controlled studies support dose- and timing-sensitive sleep effects, especially for 200-400 mg near the sleep window, while lower-dose findings can be null.
    - Withdrawal can obscure the first few days.
  logFields:
    - intended bedtime
    - caffeine cutoff time
    - first caffeine time
    - last caffeine time
    - caffeine source
    - caffeine source subtype
    - total caffeine mg per day
    - largest single caffeine serving mg
    - curfew miss yes/no
    - sleep onset latency
    - sleep efficiency
    - total sleep time
    - sleep quality
    - withdrawal symptoms and severity
    - anxiety or palpitations
    - excess-caffeine symptoms
  stopConditions:
    - chest pain, fainting, rapid or erratic heartbeat, severe palpitations, seizure, severe vomiting or diarrhea, confusion, disorientation, stupor, thunderclap headache, neurologic symptoms, suspected caffeine overdose, or suspected pure/highly concentrated caffeine exposure
    - new or worsening panic symptoms, severe anxiety, mania or hypomania symptoms, blood-pressure symptoms, or medication-interaction concern
    - withdrawal, sleepiness, anxiety, or poor sleep that impairs driving, machinery, caregiving, clinical work, or other safety-critical activity
testPlans:
  -
    planId: caffeine-curfew-sleep-readout
    primaryBiomarkerKey: biomarker:sleep-onset-latency
    secondaryBiomarkerKeys:
      - biomarker:sleep-efficiency
      - biomarker:deep-sleep-minutes
      - biomarker:hrv-rmssd
    durationDays: 21
    baselineDays: 7
    interventionDays: 14
safety:
  cautionLevel: moderate
  avoidOrGetClinicianGuidance:
    - pregnancy, trying to conceive, lactation, child or adolescent use, persistent insomnia, suspected sleep apnea, shift work, safety-critical alertness roles, or heavy/problematic caffeine use
    - uncontrolled hypertension, arrhythmia, severe anxiety or panic, bipolar disorder or recent mania/hypomania, lithium treatment, medication interactions, or caffeine-containing medicines
    - energy shots, pre-workout products, stimulant blends, caffeine pills, or pure/highly concentrated caffeine powder/liquid
  stopIf:
    - toxicity, overdose, cardiac, neurologic, severe anxiety/panic, mania/hypomania, medication-interaction, unsafe sleepiness, or persistent insomnia-worsening symptoms occur
claims:
  -
    claimId: controlled-dose-timing-supports-curfew-rationale
    type: mixed_evidence
    text: Controlled caffeine timing evidence supports testing a late-morning or bedtime-buffer curfew, but the effect is dose-sensitive and not every small exposure is equivalent to a 200-400 mg challenge.
    strength: moderate
    sourceKeys:
      - source_artifact:pmid-24235903
      - source_artifact:pmid-39377163
      - source_artifact:pmid-16704567
  -
    claimId: safety-and-withdrawal-boundaries-matter
    type: safety
    text: Withdrawal, interaction, cardiovascular/anxiety, concentrated-caffeine, and safety-critical alertness boundaries are central to running this as a wellness experiment.
    strength: high
    sourceKeys:
      - source_artifact:ncbi-bookshelf-caffeine-withdrawal-2026-04-26
      - source_artifact:pmid-15448977
      - source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
researchLandscape:
  bottomLine: Caffeine timing is biologically plausible and supported by controlled dose/timing studies, but this exact 14-day curfew and dose-reset protocol remains a bounded self-experiment rather than a proven treatment.
  confidenceLabel: limited
  primaryClaim: Moving ordinary caffeine earlier may improve personal sleep-readout signals for some users, especially when baseline exposure is late or high enough to matter.
  mainCaveat: Dose, metabolism, withdrawal, baseline insomnia, medications, and safety-critical alertness needs can dominate the result.
  groups:
    -
      id: direct-dose-timing-evidence
      label: Controlled dose and timing evidence
      stance: mixed
      summary: Acute and short repeated-dose studies support a dose- and timing-sensitive rationale for moving caffeine away from the sleep window, with lower-dose caveats.
      sourceKeys:
        - source_artifact:pmid-24235903
        - source_artifact:pmid-39377163
        - source_artifact:pmid-16704567
    -
      id: pharmacology-and-individual-differences
      label: Pharmacology and individual differences
      stance: context_only
      summary: Mechanistic and pharmacology evidence supports individual variability in caffeine response and clearance without proving the exact protocol.
      sourceKeys:
        - source_artifact:pmid-26378246
    -
      id: safety-withdrawal-and-product-boundaries
      label: Safety, withdrawal, and product boundaries
      stance: safety_boundary
      summary: Withdrawal, cardiovascular/anxiety cautions, and concentrated-caffeine warnings define who should avoid, taper, or seek guidance.
      sourceKeys:
        - source_artifact:ncbi-bookshelf-caffeine-withdrawal-2026-04-26
        - source_artifact:pmid-15448977
        - source_artifact:fda-pure-highly-concentrated-caffeine-2018-04-13
---

## Before starting

Use this ordinary version only as an adult wellness experiment. Do not start it unsupervised if you are pregnant, trying to conceive, lactating, a child or adolescent, managing persistent insomnia or suspected sleep apnea, working shifts or safety-critical duties, relying on caffeine for professional driving, aviation, heavy machinery, overnight clinical work, caregiving, or dealing with heavy/problematic caffeine use.

Do not use caffeine pills, pure caffeine powder, liquid caffeine concentrate, energy shots, pre-workout products, or stimulant blends to move the dose earlier. Pure or highly concentrated caffeine powder or liquid is a hard exclusion. The goal is not to cram the same or a larger dose into the morning.

## What counts as a signal

The primary signal is whether sleep-onset latency improves compared with baseline on adherent days. Useful secondary signals include sleep efficiency, total sleep time, subjective sleep quality, next-morning energy, and recovery notes. HRV and resting heart rate are exploratory context, not proof that the curfew worked.
