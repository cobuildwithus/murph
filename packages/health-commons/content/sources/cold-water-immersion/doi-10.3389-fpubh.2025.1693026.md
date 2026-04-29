---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3389-fpubh.2025.1693026
slug: sources/cold-water-immersion/doi-10.3389-fpubh.2025.1693026
title: 'Mindfulness training combined with cold water immersion effects on mood and perception of executive functioning in middle-aged and older adults: a pilot study'
summary: Pilot study of combined mindfulness training and progressive cold-water immersion in middle-aged and older adults, with mood and executive-function perception endpoints.
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
  title: 'Mindfulness training combined with cold water immersion effects on mood and perception of executive functioning in middle-aged and older adults: a pilot study'
  authors: Ambra Gentile; Simona Vivirito; Merve Kirkar; Konstantinos Paschos; Lana Tuđan; Jiří Kulhánek; Pinar Öztürk; Marianna Alesi
  year: 2025
  journal: Frontiers in Public Health
  doi: 10.3389/fpubh.2025.1693026
  url: https://doi.org/10.3389/fpubh.2025.1693026
  citation: 'Gentile A, Vivirito S, Kirkar M, Paschos K, Tuđan L, Kulhánek J, et al. Mindfulness training combined with cold water immersion effects on mood and perception of executive functioning in middle-aged and older adults: a pilot study. Frontiers in Public Health. 2025;13:1693026. doi:10.3389/fpubh.2025.1693026.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.3389/fpubh.2025.1693026
    titleHash: 9fbaeff5b8c48d8622fc39069d8903e97c2212c20e51418fea7a40c86d9866a6
    url: https://doi.org/10.3389/fpubh.2025.1693026
  canonicalUrl: https://doi.org/10.3389/fpubh.2025.1693026
  identityAliases:
  - doi:10.3389/fpubh.2025.1693026
  - Ambra Gentile 2025
  - 'Mindfulness training combined with cold water immersion effects on mood and perception of executive functioning in middle-aged and older adults: a pilot study'
researchEvidence:
  designKind: pilot_intervention
  designLabel: Uncontrolled pilot pre/post study
  populationLabel: Middle-aged and older adults, mean age about 60 years, mostly female
  durationLabel: Programme reported as 3 months/40 sessions in extracted methods; abstract/context also described longer implementation timing
  cohortKey: cohort:gentile-2025-mindfulness-cwi-pilot
  participantCount: 46
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: Mindfulness training combined with progressive cold-water immersion'
  - 'Comparator/control: No control group or single-component arms'
  - 'Endpoints: depression symptoms; anxiety symptoms; perceived executive functioning'
  - 'Effect direction: Depression and anxiety decreased; executive-function perception change was not statistically significant in extracted results.'
  - 'Safety/adverse-event notes: No side effects were reported in the extracted methods/results.'
  - 'Limitations: No control group.; No mindfulness-only or CWI-only arm.; Small, unbalanced sample.; Self-reported cognitive/executive function measure.; Prior cold exposure and other confounders not fully assessed.'
  - 'Population/directness caveat: Middle-aged/older supervised participants and combined mindfulness+CWI programme differ from general adult cold-plunge use.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Mental health, stress, mood, and wellbeing context; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10.3389-fpubh.2025.1693026:mindfulness-cwi-mood
  sourceKey: source_artifact:doi-10.3389-fpubh.2025.1693026
  extractedFromArtifactId: art_doi_10_3389_fpubh_2025_1693026
  findingKind: intervention_result
  population: Middle-aged and older adults in a pilot programme
  exposure: Mindfulness training combined with cold-water immersion
  outcome: Depression, anxiety, and perceived executive functioning
  summary: Pilot study in 46 adults reported reductions in depression and anxiety after a combined mindfulness plus CWI programme; perceived executive functioning did not reach statistical significance. The intervention had no control group and could not separate mindfulness from CWI.
  evidenceUse:
  - adjacent_variant
  - context
  - efficacy
- findingId: finding:doi-10.3389-fpubh.2025.1693026:mindfulness-cwi-no-side-effects
  sourceKey: source_artifact:doi-10.3389-fpubh.2025.1693026
  extractedFromArtifactId: art_doi_10_3389_fpubh_2025_1693026
  findingKind: safety
  population: Middle-aged and older adults in a supervised pilot programme
  exposure: Mindfulness training plus progressive cold-water immersion
  outcome: Side effects during programme
  summary: Extracted methods/results reported no side effects during the programme, within a screened and supervised context.
  evidenceUse:
  - safety
  - context
coldPlungeExtraction:
  batchId: batch-006
  evidenceBucket: Mental health, stress, mood, and wellbeing context
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- doi:10.3389/fpubh.2025.1693026
- Ambra Gentile 2025
- 'Mindfulness training combined with cold water immersion effects on mood and perception of executive functioning in middle-aged and older adults: a pilot study'
- 10.3389/fpubh.2025.1693026
---

This source is included for **Mental health, stress, mood, and wellbeing context**.

**Findings:** Pilot study in 46 adults reported reductions in depression and anxiety after a combined mindfulness plus CWI programme; perceived executive functioning did not reach statistical significance. The intervention had no control group and could not separate mindfulness from CWI. Extracted methods/results reported no side effects during the programme, within a screened and supervised context.

**Why it matters:** Recent combined-intervention source relevant to mood endpoints, but it must stay separate from isolated cold-plunge claims.

**Potential experiment signals:** depression symptoms, anxiety symptoms, executive-function perception, side effects.

**Protocol takeaway:** Use as adjacent combined-programme context only; no isolated cold-plunge efficacy inference.

**Claim use:** `context-only`.
