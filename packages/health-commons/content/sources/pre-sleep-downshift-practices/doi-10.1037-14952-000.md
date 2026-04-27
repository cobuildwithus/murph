---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1037-14952-000
slug: sources/pre-sleep-downshift-practices/doi-10.1037-14952-000
title: Mindfulness-Based Therapy for Insomnia
summary: "The MBTI manual is a protocol-context source for dose, sequencing, home practice, and how mindfulness is integrated with insomnia therapy; it is not standalone efficacy evidence."
status: draft
quality: usable
aliases:
  - Mindfulness-Based Therapy for Insomnia
  - doi:10.1037/14952-000
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
  kind: other
  title: Mindfulness-Based Therapy for Insomnia
  authors: Ong JC
  year: 2017
  journal: American Psychological Association Books
  citation: "Ong JC. Mindfulness-Based Therapy for Insomnia. Washington, DC: American Psychological Association; 2017. doi:10.1037/14952-000."
  doi: 10.1037/14952-000
  url: https://doi.org/10.1037/14952-000
sourceKind: other
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1037/14952-000
    titleHash: 4755b8f78c5965b52ed8bc3fd2c3e7afa5ab0a907c819314a026623385d10644
    url: https://doi.org/10.1037/14952-000
  canonicalUrl: https://doi.org/10.1037/14952-000
researchEvidence:
  designKind: expert_protocol
  designLabel: Clinical treatment manual for Mindfulness-Based Therapy for Insomnia
  populationLabel: Clinicians and patients using MBTI for insomnia; not a trial cohort.
  durationLabel: Manual/program context; not an outcome follow-up study.
  aggregateRole: context
  cohortKey: cohort-doi-10.1037-14952-000
  notes:
    - "Original extracted designKind: treatment_manual."
    - "Original extracted aggregateRole: background."
    - "Intervention or exposure: Manualized Mindfulness-Based Therapy for Insomnia, including meditation practice, behavioral sleep principles, and cognitive/acceptance components."
    - "Comparator or control: Not applicable."
    - "Endpoints: practice duration; home practice burden; clinical sequencing; wakefulness/frustration handling"
    - "Effect estimate or direction: Not outcome evidence; provides clinical protocol structure and likely copyrighted manual context for MBTI dose and sequencing."
    - "Adverse events or safety notes: Manual/source context only; no standalone adverse-event rate extracted."
evidenceBucket: dose_duration_adherence_context
whyItMatters: "Helps avoid inventing a 10-, 30-, or 60-minute silent bedtime dose from MBTI trials by showing that MBTI is a bundled clinical program."
potentialMurphEndpoints:
  - practice duration
  - home practice burden
  - clinical sequencing
  - wakefulness/frustration handling
protocolTakeaway: Use as manual/context only; do not cite as direct outcome support for Silent Meditation Before Bed.
murphTakeaway: "MBTI provides a structured clinical reference point, but a Murph bedtime variant should stay separate from full MBTI."
studyDesign: Clinical treatment manual for Mindfulness-Based Therapy for Insomnia
modality: Mindfulness-Based Therapy for Insomnia manual
directnessToProtocol: background
populationMismatch: Clinical insomnia treatment manual rather than a general self-guided bedtime practice.
limitations:
  - "Treatment manual, not an empirical outcome study."
  - Likely copyrighted; use metadata and paraphrased protocol context only.
  - Manualized therapist-guided MBTI differs from silent unguided meditation before bed.
claimUse: context-only
sourceFindings:
  -
    findingId: finding:doi-10.1037-14952-000-mbti-manual-dose-context
    sourceKey: source_artifact:doi-10.1037-14952-000
    extractedFromArtifactId: art_doi_10_1037_14952_000_publisher_record
    findingKind: context
    population: Clinicians and patients using MBTI for insomnia; not a trial cohort.
    exposure: "Manualized Mindfulness-Based Therapy for Insomnia, including meditation practice, behavioral sleep principles, and cognitive/acceptance components."
    outcome: practice duration; home practice burden; clinical sequencing; wakefulness/frustration handling
    summary: "The MBTI manual is a protocol-context source for dose, sequencing, home practice, and how mindfulness is integrated with insomnia therapy; it is not standalone efficacy evidence."
    evidenceUse:
      - context
murphV1Priority: High
pdfRightsStatus: permission_required
---
This source is included for **dose_duration_adherence_context**.

**Findings:** The MBTI manual is a protocol-context source for dose, sequencing, home practice, and how mindfulness is integrated with insomnia therapy; it is not standalone efficacy evidence.

**Why it matters:** Helps avoid inventing a 10-, 30-, or 60-minute silent bedtime dose from MBTI trials by showing that MBTI is a bundled clinical program.

**Potential experiment signals:** practice duration, home practice burden, clinical sequencing, wakefulness/frustration handling.

**Protocol takeaway:** Use as manual/context only; do not cite as direct outcome support for Silent Meditation Before Bed.

**Claim use:** `context-only`.
