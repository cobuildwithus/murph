---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:kul-tabata-cycling-calisthenics-2022-07-15
slug: sources/tabata-interval-training/kul-tabata-cycling-calisthenics-2022-07-15
title: High-Intensity Interval Training with Cycling and Calisthenics: Effects on Aerobic Endurance, Critical Power, Sprint and Maximal Strength Performance in Sedentary Males
summary: An 8-week randomized practical Tabata-type trial in sedentary men comparing cycling and calisthenics arms. Both arms improved peak power output, estimated VO2max, and critical power, while body composition, 1RM strength, and sprint outcomes did not clearly change.
status: draft
quality: usable
aliases:
  - Kul et al. 2022 Retos Tabata cycling calisthenics
  - Entrenamiento Interválico de Alta Intensidad con Ciclismo y Calistenia
  - source_artifact:kul-tabata-cycling-calisthenics-2022-07-15
  - doi:10.47197/retos.v46.94255
categories:
  - tabata-interval-training
relations:
  -
    type: related_protocol
    target: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
  -
    type: parent_family
    target: experiment_family:tabata-interval-training
source:
  kind: journal_article
  title: High-Intensity Interval Training with Cycling and Calisthenics: Effects on Aerobic Endurance, Critical Power, Sprint and Maximal Strength Performance in Sedentary Males
  authors: Murat Kul, Mutlu Turkmen, Umit Yildirim, Ramazan Ceylan, Onur Sipal, Refik Cabuk, Abdullah Akova, Omer Faruk Aksoy, Eda Adatepe
  year: 2022
  journal: Retos
  doi: 10.47197/retos.v46.94255
  url: https://dialnet.unirioja.es/descarga/articulo/8555093.pdf
  citation: Kul M, Turkmen M, Yildirim U, Ceylan R, Sipal O, Cabuk R, Akova A, Aksoy OF, Adatepe E. High-Intensity Interval Training with Cycling and Calisthenics: Effects on Aerobic Endurance, Critical Power, Sprint and Maximal Strength Performance in Sedentary Males. Retos. 2022;46:538-544. doi:10.47197/retos.v46.94255.
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized controlled training study with cycling HIIT and calisthenics HIIT arms
  participantCount: 17
  participantCountKind: reported
  populationLabel: Sedentary adult males; 23 enrolled and 17 completed after pandemic-related attrition
  durationLabel: 8 weeks; 3 sessions/week on non-consecutive days; 2 Tabata sets/session during weeks 1-4 and 3 sets/session during weeks 5-8
  cohortKey: tabata-batch-002-kul-sedentary-males
  aggregateRole: primary
protocolEvidence:
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: practical-20-10-variants
    stance: mixed
    scope: direct_protocol
    result: mixed
    endpointKeys:
      - biomarker:estimated-vo2max
    headline: Sedentary men improved estimated VO2max, peak power output, and critical power after 8 weeks of practical 20/10 cycling or calisthenics HIIT, but body composition, 1RM strength, and sprint outcomes did not clearly improve.
    implication: Supports the plausibility that practical 20/10 Tabata-style work can improve aerobic-power markers in sedentary men, and that calisthenics can be a viable mode when cycling equipment is unavailable.
    caveat: This was not the original 170% VO2max protocol; cycling used approximately 120% peak power output, the program used 2-3 Tabata sets per session, there was no non-exercise control arm, and the sample was small and male-only.
    displayPriority: 50
  -
    protocolKey: protocol_variant:tabata-interval-training/tabata-20-10-interval-training
    groupId: cardiometabolic-body-composition-boundary
    stance: mixed
    scope: direct_protocol
    result: mixed
    endpointKeys:
      - biomarker:estimated-vo2max
    headline: Sedentary men improved estimated VO2max, peak power output, and critical power after 8 weeks of practical 20/10 cycling or calisthenics HIIT, but body composition, 1RM strength, and sprint outcomes did not clearly improve.
    implication: Supports the plausibility that practical 20/10 Tabata-style work can improve aerobic-power markers in sedentary men, and that calisthenics can be a viable mode when cycling equipment is unavailable.
    caveat: This was not the original 170% VO2max protocol; cycling used approximately 120% peak power output, the program used 2-3 Tabata sets per session, there was no non-exercise control arm, and the sample was small and male-only.
    displayPriority: 50
evidenceBucket: direct_practical_20_10_trials
whyItMatters: This is one of the most directly practical 20/10 training studies for a home-friendly bodyweight variant, while also preserving null findings for strength, sprint, and body composition.
potentialMurphEndpoints:
  - Estimated VO2max or aerobic-power proxy
  - Critical power or work-capacity proxy
  - Session completion and perceived effort
  - Body composition
  - 30 m sprint or comparable anaerobic-performance proxy
protocolTakeaway: Use as direct but mixed support: practical 20/10 cycling or bodyweight sets can improve aerobic-power endpoints over 8 weeks, but this source should not be used to promise fat loss, sprint gains, or strength gains.
murphTakeaway: For a starter Murph Commons experiment, this source supports tracking aerobic work capacity and adherence, and supports offering calisthenic alternatives, while setting expectations that body composition and strength may not change from Tabata alone.
studyDesign: Randomized controlled training study
modality: Cycling ergometer and bodyweight calisthenics: squat, burpee, mountain climber, glute bridge
claimUse: supports-protocol
murphV1Priority: High
pdfRightsStatus: open_access
sourceExtractionBatch: 12-source-extraction-002
---
This source is included for **direct_practical_20_10_trials**.

**Findings:** In `source_artifact:kul-tabata-cycling-calisthenics-2022-07-15`, 17 sedentary men completed an 8-week randomized comparison of cycling HIIT and calisthenics HIIT using an 8 x 20 seconds work / 10 seconds rest structure. Both groups improved peak power output, estimated VO2max, and critical power, with no clear between-group advantage. Body mass, BMI, body-fat percentage, 1RM strength, and sprint outcomes did not show clear improvements.

**Why it matters:** This is directly relevant to practical 20/10 programming because it tests both cycling and low-equipment bodyweight modes in sedentary men.

**Potential experiment signals:** Estimated VO2max proxy, power/work-capacity proxy, completion rate, RPE, and bodyweight or body-composition checks.

**Protocol takeaway:** Direct but mixed support. The useful claim is about aerobic-power/work-capacity potential, not broad body-composition, strength, or sprint improvement.

**Claim use:** `supports-protocol`.
