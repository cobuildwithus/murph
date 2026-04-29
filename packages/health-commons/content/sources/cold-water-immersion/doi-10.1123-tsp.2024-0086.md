---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1123-tsp.2024-0086
slug: sources/cold-water-immersion/doi-10.1123-tsp.2024-0086
title: The Relationship Between Cold-Water-Immersion Activities, Mental Health, Self-Efficacy, Resilience, and Mental Toughness
summary: Observational study linking self-reported CWI activity engagement with mental health and psychological trait outcomes.
status: draft
quality: usable
categories:
- cold-water-immersion
- cold-plunge
relations:
- type: parent_family
  target: experiment_family:cold-water-immersion
- type: related_protocol
  target: protocol_variant:cold-water-immersion/cold-plunge
source:
  kind: journal_article
  title: The Relationship Between Cold-Water-Immersion Activities, Mental Health, Self-Efficacy, Resilience, and Mental Toughness
  authors: Annmarie Mullooly; Dylan Colbert
  year: 2024
  journal: The Sport Psychologist
  doi: 10.1123/tsp.2024-0086
  url: https://doi.org/10.1123/tsp.2024-0086
  citation: Mullooly A, Colbert D. The Relationship Between Cold-Water-Immersion Activities, Mental Health, Self-Efficacy, Resilience, and Mental Toughness. The Sport Psychologist. 2024. doi:10.1123/tsp.2024-0086.
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1123/tsp.2024-0086
    titleHash: 7e7e170922d1e7e9cf5d47d4a030b082a2b7574b176b935fa1bf05b50a1ea43d
    url: https://doi.org/10.1123/tsp.2024-0086
  canonicalUrl: https://doi.org/10.1123/tsp.2024-0086
  identityAliases:
  - doi:10.1123/tsp.2024-0086
  - Annmarie Mullooly 2024
  - The Relationship Between Cold-Water-Immersion Activities, Mental Health, Self-Efficacy, Resilience, and Mental Toughness
researchEvidence:
  designKind: prospective_cohort
  designLabel: Observational cohort/cross-sectional comparison
  populationLabel: Self-reported CWI activity users and non-users
  durationLabel: Not an intervention duration; engagement/frequency self-reported
  cohortKey: cohort:mullooly-colbert-2024-cwi-mental-health-correlates
  participantCount: 164
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: CWI activities including sea swimming, ice baths, and cold showers'
  - 'Comparator/control: Non-users of CWI activities'
  - 'Endpoints: depression; anxiety; stress; resilience; self-efficacy; mental toughness'
  - 'Effect direction: Associations favored CWI activity users for lower depression/anxiety/stress and higher resilience/self-efficacy/mental toughness; not causal.'
  - 'Safety/adverse-event notes: Safety outcomes were not the extracted focus.'
  - 'Limitations: Observational self-selection and confounding.; Multiple CWI modalities were combined.; No randomized assignment or isolated dose protocol.'
  - 'Population/directness caveat: Self-selected CWI activity users; modalities include sea swimming, ice baths, and cold showers.'
  - 'Directness to Cold Plunge: same_mechanism'
  - 'Cold Plunge extraction context: bucket=Mental health, stress, mood, and wellbeing context; directness=same_mechanism; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.1123-tsp.2024-0086:cwi-mental-health-correlates
  sourceKey: source_artifact:doi-10.1123-tsp.2024-0086
  extractedFromArtifactId: art_doi_10_1123_tsp_2024_0086
  findingKind: context
  population: Cold-water immersion activity users and non-users
  exposure: Self-reported engagement in CWI activities including sea swimming, ice baths, and cold showers
  outcome: Depression, anxiety, stress, resilience, self-efficacy, mental toughness
  summary: Observational comparison of 164 participants found CWI activity users reported lower depression, anxiety, and stress and higher resilience, self-efficacy, and mental toughness after controlling daily stress. Frequency was associated with mental toughness and self-efficacy. The design cannot establish causality or rule out self-selection.
  evidenceUse:
  - context
  - measurement
coldPlungeExtraction:
  batchId: batch-006
  evidenceBucket: Mental health, stress, mood, and wellbeing context
  directness: same_mechanism
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: permission_required
  identityResolutionStatus: new_source
aliases:
- doi:10.1123/tsp.2024-0086
- Annmarie Mullooly 2024
- The Relationship Between Cold-Water-Immersion Activities, Mental Health, Self-Efficacy, Resilience, and Mental Toughness
- 10.1123/tsp.2024-0086
---

This source is included for **Mental health, stress, mood, and wellbeing context**.

**Findings:** Observational comparison of 164 participants found CWI activity users reported lower depression, anxiety, and stress and higher resilience, self-efficacy, and mental toughness after controlling daily stress. Frequency was associated with mental toughness and self-efficacy. The design cannot establish causality or rule out self-selection.

**Why it matters:** Useful for community-outcome hypotheses and endpoint selection, while requiring explicit non-causal framing.

**Potential experiment signals:** depression symptoms, anxiety symptoms, stress, resilience, self-efficacy, mental toughness.

**Protocol takeaway:** Use as observational context only; do not infer that cold plunges cause improved mental health from this source.

**Claim use:** `context-only`.
