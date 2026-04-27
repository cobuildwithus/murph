---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1016-s0005-7894-76-80064-0
slug: sources/pre-sleep-downshift-practices/doi-10.1016-s0005-7894-76-80064-0
title: Meditation training as a treatment for insomnia
summary: Historical insomnia trial comparing meditation-derived attention focusing with progressive relaxation and waiting list; relevant to sleep-onset latency but not a modern silent bedtime protocol.
status: draft
quality: usable
aliases:
  - Meditation training as a treatment for insomnia
categories:
  - pre-sleep-downshift-practices
relations:
  -
    type: related_protocol
    target: protocol_variant:pre-sleep-downshift-practices/pre-sleep-silent-meditation
  -
    type: parent_family
    target: experiment_family:pre-sleep-downshift-practices
source:
  kind: journal_article
  title: Meditation training as a treatment for insomnia
  authors: Woolfolk RL; Carr-Kaffashan L; McNulty TF; Lehrer PM
  year: 1976
  journal: Behavior Therapy
  citation: "Woolfolk RL, Carr-Kaffashan L, McNulty TF, Lehrer PM. Meditation training as a treatment for insomnia. Behavior Therapy. 1976;7(3):359-365. doi:10.1016/S0005-7894(76)80064-0."
  doi: 10.1016/s0005-7894(76)80064-0
  url: https://doi.org/10.1016/s0005-7894(76)80064-0
sourceKind: journal_article
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1016/s0005-7894(76)80064-0
    titleHash: a7ecc073889f2b43116bf168678dff0c0f24b359148b823563951019f1622c3f
    url: https://doi.org/10.1016/s0005-7894(76)80064-0
  canonicalUrl: https://doi.org/10.1016/s0005-7894(76)80064-0
researchEvidence:
  designKind: controlled_trial
  designLabel: "Historical controlled trial comparing meditation, progressive relaxation, and waiting list"
  populationLabel: Community-recruited adults with insomnia
  durationLabel: Treatment period with 6-month follow-up reported; exact bedtime timing not extracted
  aggregateRole: primary
  cohortKey: cohort-doi-10.1016-s0005-7894-76-80064-0
  notes:
    - "Directness to target protocol: clinical_supervised."
    - "Claim-use boundary: context-only."
    - No direct silent/unguided bedtime-only protocol claim should be derived from this source unless separately verified.
  participantCount: 24
  participantCountKind: reported
evidenceBucket: clinical_insomnia_mindfulness
whyItMatters: It is one of the earliest meditation-only insomnia comparator sources and helps preserve historical null/mixed comparator context.
potentialMurphEndpoints:
  - sleep-onset latency
  - subjective sleep
  - treatment adherence
protocolTakeaway: Use as clinical-supervised historical context; meditation was superior to no treatment for sleep-onset latency but not superior to progressive relaxation.
murphTakeaway: "Meditation-like attention focusing may reduce sleep-onset latency, yet relaxation achieved similar effects in this small historical trial."
studyDesign: Controlled trial
modality: Attention-focusing meditation training
directnessToProtocol: clinical_supervised
claimUse: context-only
limitations:
  - Small historical trial.
  - "Meditation technique, delivery format, and immediate bedtime silent practice are not equivalent to the target protocol."
  - Limited extractable detail beyond abstract-level results.
populationMismatch: Community insomnia sample and historical treatment context.
sourceFindings:
  -
    findingId: finding:doi-10.1016-s0005-7894-76-80064-0/sleep-onset-latency
    sourceKey: source_artifact:doi-10.1016-s0005-7894-76-80064-0
    extractedFromArtifactId: art-doi-10-1016-s0005-7894-76-80064-0
    findingKind: intervention_result
    population: Twenty-four community-recruited adults with insomnia.
    exposure: Attention-focusing meditation training compared with progressive relaxation and waiting-list control.
    outcome: Sleep-onset latency and follow-up sleep improvement.
    summary: "Meditation and progressive relaxation were both superior to no treatment for reducing sleep-onset latency, but the two active treatments did not differ in effectiveness; active-treatment gains were reported at 6-month follow-up."
    evidenceUse:
      - efficacy
      - adjacent_variant
      - context
murphV1Priority: High
pdfRightsStatus: unknown
---
This source is included for **clinical_insomnia_mindfulness**.

**Findings:** Meditation and progressive relaxation were both superior to no treatment for reducing sleep-onset latency, but the two active treatments did not differ in effectiveness; active-treatment gains were reported at 6-month follow-up.

**Why it matters:** It is one of the earliest meditation-only insomnia comparator sources and helps preserve historical null/mixed comparator context.

**Potential experiment signals:** sleep-onset latency, subjective sleep, treatment adherence.

**Protocol takeaway:** Use as clinical-supervised historical context; meditation was superior to no treatment for sleep-onset latency but not superior to progressive relaxation.

**Claim use:** `context-only`.
