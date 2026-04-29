---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1891-0889-8391.23.3.198
slug: sources/pre-sleep-downshift-practices/doi-10.1891-0889-8391.23.3.198
title: Do mindfulness meditation participants do their homework? And does it make a difference? A review of the empirical evidence
summary: The review found incomplete homework reporting and only partial evidence that mindfulness home-practice amount related to outcomes; reported daily practice in 11 studies averaged about 31.8 minutes/day but vari…
status: draft
quality: usable
aliases:
  - Do mindfulness meditation participants do their homework? And does it make a difference? A review of the empirical evidence
  - doi:10.1891/0889-8391.23.3.198
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
  kind: review
  title: Do mindfulness meditation participants do their homework? And does it make a difference? A review of the empirical evidence
  authors: Vettese LC; Toneatto T; Stea JN; Nguyen L; Wang JJ
  year: 2009
  journal: Journal of Cognitive Psychotherapy
  citation: "Vettese LC, Toneatto T, Stea JN, Nguyen L, Wang JJ. Do mindfulness meditation participants do their homework? And does it make a difference? A review of the empirical evidence. Journal of Cognitive Psychotherapy. 2009;23(3):198-225. doi:10.1891/0889-8391.23.3.198."
  doi: 10.1891/0889-8391.23.3.198
  url: https://doi.org/10.1891/0889-8391.23.3.198
sourceKind: review
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1891/0889-8391.23.3.198
    titleHash: 549df6abf9b69642917af26da9550312b5bb8dabef276400fdb880a3e58de026
    url: https://doi.org/10.1891/0889-8391.23.3.198
  canonicalUrl: https://doi.org/10.1891/0889-8391.23.3.198
researchEvidence:
  designKind: systematic_review
  designLabel: Systematic review of mindfulness homework adherence and outcomes
  populationLabel: Participants in mindfulness meditation intervention studies across heterogeneous clinical and nonclinical settings.
  durationLabel: Varied by included study.
  aggregateRole: synthesis
  cohortKey: cohort-doi-10.1891-0889-8391.23.3.198
  notes:
    - "Intervention or exposure: Mindfulness home practice/homework assignments."
    - "Comparator or control: Review of associations rather than a single comparator."
    - "Endpoints: home-practice minutes; practice-log completion; clinical and psychological outcomes"
    - "Effect estimate or direction: Among 98 reviewed studies, 24 assessed home-practice/outcome associations; just over half of those studies found partial support, and only two documented completion rates of practice logs. Mean/median daily practice reported in 11 studies averaged 31.8 minutes/day with a 5-58 minute range."
    - "Adverse events or safety notes: No adverse-event rate extracted; adherence/burden focus only."
evidenceBucket: dose_duration_adherence_context
whyItMatters: Useful for burden and adherence framing; it warns against assuming users complete longer assigned practices.
potentialMurphEndpoints:
  - home-practice minutes
  - practice-log completion
  - clinical and psychological outcomes
protocolTakeaway: "Use as adherence/burden context, not as evidence that a specific bedtime dose works."
murphTakeaway: Murph should measure actual minutes practiced and completion rather than assuming assigned practice equals delivered dose.
studyDesign: Systematic review of mindfulness homework adherence and outcomes
modality: Mindfulness homework adherence review
directnessToProtocol: population_mismatch
populationMismatch: "Heterogeneous mindfulness populations, not a bedtime sleep protocol."
limitations:
  - Older evidence base.
  - Heterogeneous interventions and outcomes.
  - Adherence reporting was often incomplete.
  - Not sleep-specific.
claimUse: context-only
sourceFindings:

  -
    findingId: finding:doi-10.1891-0889-8391.23.3.198-homework-adherence-review
    sourceKey: source_artifact:doi-10.1891-0889-8391.23.3.198
    extractedFromArtifactId: art_doi_10_1891_0889_8391_23_3_198_publisher_record
    findingKind: context
    population: Participants in mindfulness meditation intervention studies across heterogeneous clinical and nonclinical settings.
    exposure: Mindfulness home practice/homework assignments.
    outcome: home-practice minutes; practice-log completion; clinical and psychological outcomes
    summary: The review found incomplete homework reporting and only partial evidence that mindfulness home-practice amount related to outcomes; reported daily practice in 11 studies averaged about 31.8 minutes/day but varied widely.
    evidenceUse:
      - context
murphV1Priority: High
pdfRightsStatus: permission_required
---
This source is included for **dose_duration_adherence_context**.

**Findings:** The review found incomplete homework reporting and only partial evidence that mindfulness home-practice amount related to outcomes; reported daily practice in 11 studies averaged about 31.8 minutes/day but varied widely.

**Why it matters:** Useful for burden and adherence framing; it warns against assuming users complete longer assigned practices.

**Potential experiment signals:** home-practice minutes, practice-log completion, clinical and psychological outcomes.

**Protocol takeaway:** Use as adherence/burden context, not as evidence that a specific bedtime dose works.

**Claim use:** `context-only`.
