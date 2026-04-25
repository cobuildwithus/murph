---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:mjmh-tabata-immune-cell-response-2021
slug: sources/tabata-interval-training/mjmh-tabata-immune-cell-response-2021
title: Effects of Tabata workouts on the immune cell response in physically inactive individuals
summary: A small 6-week Tabata-workout study in physically inactive young adults reporting increases in total leukocyte and neutrophil counts, a monocyte trend, no clear lymphocyte change, and no clear body-composition change. Extraction is limited because accessible pages provided metadata and abstracts rather than reusable full text.
status: draft
quality: usable
aliases:
  - Effects of Tabata workouts on the immune cell response in healthy men
  - Noor Muhamad Malik 2021 Tabata immune cells
  - doi:10.4103/mohe.mohe_21_21
  - source_artifact:mjmh-tabata-immune-cell-response-2021
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
  title: Effects of Tabata workouts on the immune cell response in physically inactive individuals
  authors: Nur Ain Syahira Mohd Noor, Ayu Suzailiana Muhamad, Adam Abdul Malik
  year: 2021
  journal: Malaysian Journal of Movement, Health & Exercise
  doi: 10.4103/mohe.mohe_21_21
  url: https://journals.lww.com/mjmh/fulltext/2021/10020/effects_of_tabata_workouts_on_the_immune_cell.6.aspx
  citation: Noor NASM, Muhamad AS, Malik AA. Effects of Tabata workouts on the immune cell response in physically inactive individuals. Malaysian Journal of Movement, Health & Exercise. 2021;10(2):99-104. doi:10.4103/mohe.mohe_21_21.
researchEvidence:
  designKind: single_arm_trial
  designLabel: Six-week uncontrolled Tabata-workout intervention
  participantCount: 12
  participantCountKind: reported
  populationLabel: Physically inactive university-age individuals; accessible article abstracts report mean age about 22 years, while sex breakdown was not fully verified from reusable article text
  durationLabel: 6 weeks; 3 sessions/week; four Tabata sets per session; each set used two exercise types with 20 seconds exercise and 10 seconds rest
  cohortKey: tabata-batch-002-mjmh-physically-inactive
  aggregateRole: context
evidenceBucket: direct_practical_20_10_trials
whyItMatters: This source broadens the endpoint map beyond fitness by showing immune-cell biomarkers were measured during a practical Tabata-workout intervention, but it should not be treated as strong causal efficacy evidence.
potentialMurphEndpoints:
  - Session HR
  - Session RPE
  - Body weight and body-fat percentage
  - Immune-cell count only in research settings
protocolTakeaway: Use cautiously as direct practical Tabata biomarker context. Do not use it to claim immune protection or clinical benefit.
murphTakeaway: Can inform things-to-watch and optional research-grade biomarkers, but Murph V1 should prioritize safer, user-accessible endpoints such as HR, RPE, completion, and recovery.
studyDesign: Uncontrolled training intervention
modality: Repeated practical Tabata workouts
claimUse: supports-protocol
murphV1Priority: Medium
pdfRightsStatus: unknown
sourceExtractionBatch: 12-source-extraction-002
---
This source is included for **direct_practical_20_10_trials**.

**Findings:** In `source_artifact:mjmh-tabata-immune-cell-response-2021`, 12 physically inactive young adults completed a 6-week Tabata-workout program. The study reported significant increases in total leukocyte and neutrophil counts, a non-significant monocyte trend, no clear lymphocyte change, and maintained body weight, BMI, and body-fat percentage.

**Why it matters:** It is direct practical Tabata-workout evidence, but its endpoints are surrogate biomarkers and the uncontrolled design makes causal claims weak.

**Potential experiment signals:** HR, RPE, body weight, body-fat percentage, and research-only immune-cell counts.

**Protocol takeaway:** Direct but low-strength and mixed. Keep claims narrow and avoid immune-health promises.

**Claim use:** `supports-protocol`.
