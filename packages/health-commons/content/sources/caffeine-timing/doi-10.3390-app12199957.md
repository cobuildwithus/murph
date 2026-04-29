---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3390-app12199957
slug: sources/caffeine-timing/doi-10.3390-app12199957
title: Does Acute Caffeine Intake before Evening Training Sessions Impact Sleep Quality and Recovery-Stress State? Preliminary Results from a Study on Highly Trained Judo Athletes
summary: In nine highly trained judo athletes, 3 mg/kg caffeine 60 minutes before evening randori did not change actigraphy sleep or next-morning recovery-stress scores, but it worsened Karolinska Sleep Diary sleep quality.
status: draft
quality: usable
aliases:
- Does Acute Caffeine Intake before Evening Training Sessions Impact Sleep Quality and Recovery-Stress State? Preliminary Results from a Study on Highly Trained Judo Athletes
- source_artifact:doi-10.3390-app12199957
categories:
- caffeine-timing
relations:
- type: related_protocol
  target: protocol_variant:caffeine-timing/caffeine-curfew-dose-reset
- type: parent_family
  target: experiment_family:caffeine-timing
source:
  kind: journal_article
  title: Does Acute Caffeine Intake before Evening Training Sessions Impact Sleep Quality and Recovery-Stress State? Preliminary Results from a Study on Highly Trained Judo Athletes
  authors: Filip-Stachnik A
  year: 2022
  journal: Applied Sciences
  citation: Filip-Stachnik A. Does Acute Caffeine Intake before Evening Training Sessions Impact Sleep Quality and Recovery-Stress State? Preliminary Results from a Study on Highly Trained Judo Athletes. Applied Sciences. 2022. doi:10.3390/app12199957.
  doi: 10.3390/app12199957
  url: https://www.mdpi.com/2076-3417/12/19/9957
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.3390/app12199957
    titleHash: f6eeff62648e9597d5810a5ad50216c0cc5023e05bb165c590c876a47dcbc4fc
    url: https://doi.org/10.3390/app12199957
  canonicalUrl: https://www.mdpi.com/2076-3417/12/19/9957
researchEvidence:
  designKind: crossover_trial
  designLabel: Randomized double-blind placebo-controlled crossover in highly trained judo athletes
  participantCount: 9
  participantCountKind: reported
  populationLabel: Highly trained judo athletes in an evening training setting.
  durationLabel: Two evening randori-training trials with next-morning sleep diary, actigraphy, and recovery-stress assessment.
  aggregateRole: primary
  cohortKey: doi-10.3390-app12199957
  notes:
  - 'Intervention or exposure: 3 mg/kg caffeine administered 60 minutes before an evening randori training session.'
  - 'Comparator or control: Placebo in an otherwise identical evening training session.'
  - 'Endpoints: Actigraphy-derived sleep measures; Karolinska Sleep Diary sleep quality; next-morning short recovery and stress scale.'
  - 'Effect or direction: No significant differences in actigraphy sleep measures or recovery-stress state; KSD sleep quality was worse after caffeine (3.0 ± 1.0 vs 3.9 ± 0.6; p=0.03; ES=1.09).'
  - 'Adverse events or safety notes: No adverse-event table extracted; subjective sleep-quality worsening is the main tolerability signal.'
  - 'Population mismatch: Highly trained judo athletes in evening training, not general adults attempting morning-only caffeine.'
  - 'Limitations: Preliminary small sample; athlete-only setting; one-night acute exposure; not a caffeine curfew or 14-day dose reset.'
evidenceBucket: daytime_function_performance
whyItMatters: Shows that a lower sport dose before evening training can create a subjective sleep-quality tradeoff without obvious actigraphy or recovery-score change.
potentialMurphEndpoints:
- sleep quality
- sleep efficiency
- total sleep time
- wake after sleep onset
- recovery-stress state
protocolTakeaway: 'Context-only: useful for discussing subjective sleep-quality tradeoffs from evening caffeine, but not direct no-caffeine-after-10/11am or 8-hour-curfew evidence.'
murphTakeaway: For evening-training users, pair wearable sleep trend checks with subjective next-morning recovery questions.
studyDesign: crossover
modality: caffeine supplementation before evening exercise
claimUse: context-only
sourceFindings:
- findingId: finding:doi-10.3390-app12199957-actigraphy-recovery-null
  sourceKey: source_artifact:doi-10.3390-app12199957
  extractedFromArtifactId: art_doi_10_3390_app12199957_html
  findingKind: intervention_result
  population: Nine highly trained judo athletes.
  exposure: 3 mg/kg caffeine 60 minutes before an evening randori training session versus placebo.
  outcome: Actigraphy sleep measures and next-morning recovery-stress state.
  summary: The study reported no significant caffeine-placebo differences in actigraphy-derived sleep measures or recovery-stress state.
  evidenceUse:
  - adjacent_variant
  - context
- findingId: finding:doi-10.3390-app12199957-subjective-sleep-quality-worse
  sourceKey: source_artifact:doi-10.3390-app12199957
  extractedFromArtifactId: art_doi_10_3390_app12199957_html
  findingKind: intervention_result
  population: Nine highly trained judo athletes.
  exposure: 3 mg/kg caffeine before evening training versus placebo.
  outcome: Karolinska Sleep Diary sleep quality.
  summary: Self-reported sleep quality was lower after caffeine than placebo (3.0 ± 1.0 vs 3.9 ± 0.6; p=0.03; ES=1.09).
  evidenceUse:
  - adjacent_variant
  - safety
murphV1Priority: High
pdfRightsStatus: open_access
---

This source is included for **daytime_function_performance**.

**Findings:** The study reported no significant caffeine-placebo differences in actigraphy-derived sleep measures or recovery-stress state. Self-reported sleep quality was lower after caffeine than placebo (3.0 ± 1.0 vs 3.9 ± 0.6; p=0.03; ES=1.09).

**Why it matters:** Shows that a lower sport dose before evening training can create a subjective sleep-quality tradeoff without obvious actigraphy or recovery-score change.

**Potential experiment signals:** sleep quality, sleep efficiency, total sleep time, wake after sleep onset, recovery-stress state.

**Protocol takeaway:** Context-only: useful for discussing subjective sleep-quality tradeoffs from evening caffeine, but not direct no-caffeine-after-10/11am or 8-hour-curfew evidence.

**Claim use:** `context-only`.
