---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.1371-journal.pone.0322416
slug: sources/cold-water-immersion/doi-10.1371-journal.pone.0322416
title: 'No acceleration of recovery from exercise-induced muscle damage after cold or hot water immersion in women: A randomised controlled trial'
summary: Recent women-only RCT found no 72-hour recovery acceleration from acute cold- or hot-water immersion after exercise-induced muscle damage.
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
  title: 'No acceleration of recovery from exercise-induced muscle damage after cold or hot water immersion in women: A randomised controlled trial'
  authors: Wellauer V; Clijsen R; Bianchi G; Riggi E; Hohenauer E
  year: 2025
  journal: PLOS ONE
  doi: 10.1371/journal.pone.0322416
  url: https://doi.org/10.1371/journal.pone.0322416
  citation: 'Wellauer V; Clijsen R; Bianchi G; Riggi E; Hohenauer E. No acceleration of recovery from exercise-induced muscle damage after cold or hot water immersion in women: A randomised controlled trial. PLOS ONE. 2025. doi:10.1371/journal.pone.0322416.'
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    doi: 10.1371/journal.pone.0322416
    titleHash: ceb25d02d852cfbfee89ce9af1154a4c4da56dd8f74b804e45af585ddfc512be
    url: https://doi.org/10.1371/journal.pone.0322416
  canonicalUrl: https://doi.org/10.1371/journal.pone.0322416
  identityAliases:
  - DOI 10.1371/journal.pone.0322416
  - 'No acceleration of recovery from exercise-induced muscle damage after cold or hot water immersion in women: A randomised controlled trial'
  - No acceleration of recovery from exercise-induced muscle damage through acute cold-water immersion, whole body cryostimulation or local cryotherapy
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: Randomized controlled trial
  populationLabel: Healthy women after exercise-induced muscle damage from drop jumps
  durationLabel: Recovery outcomes followed for 72 hours after the muscle-damaging exercise bout
  cohortKey: cohort:doi-10-1371-journal-pone-0322416
  participantCount: 30
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - 'Intervention/exposure: 10-minute cold-water immersion or hot-water immersion immediately and 120 minutes after exercise'
  - 'Comparator/control: No-immersion control condition'
  - 'Endpoints: muscle oxygen saturation; skin temperature; maximal voluntary isometric contraction; swelling; soreness; creatine kinase; subjective recovery'
  - 'Effect direction: CWI changed acute physiological measures such as SmO2 and skin temperature, but neither CWI nor HWI improved subjective or objective 72-hour recovery versus control.'
  - 'Safety/adverse-event notes: No adverse-event signal was extracted from accessible metadata.'
  - 'Limitations: Healthy young women only.; Menstrual-cycle timing was not standardized in the accessible article limitations.; Exercise-induced muscle damage model rather than general wellness cold plunging.'
  - 'Population/directness caveat: Healthy women after drop-jump muscle damage; not resting cold-plunge users or broad clinical populations.'
  - 'Directness to Cold Plunge: adjacent_variant'
  - 'Cold Plunge extraction context: bucket=Sports recovery and training-adaptation boundary; directness=adjacent_variant; claimUse=context-only; priority=medium'
sourceFindings:
- findingId: finding:doi-10-1371-journal-pone-0322416:null-recovery-women
  sourceKey: source_artifact:doi-10.1371-journal.pone.0322416
  extractedFromArtifactId: art_doi_10_1371_journal_pone_0322416
  findingKind: intervention_result
  population: Healthy women after drop-jump exercise-induced muscle damage
  exposure: Cold-water immersion or hot-water immersion after exercise
  outcome: 72-hour subjective and objective recovery
  summary: The trial randomized 30 healthy women and found that neither CWI nor HWI improved subjective or objective recovery markers versus control over 72 hours.
  evidenceUse:
  - adjacent_variant
  - efficacy
- findingId: finding:doi-10-1371-journal-pone-0322416:physiology-not-recovery
  sourceKey: source_artifact:doi-10.1371-journal.pone.0322416
  extractedFromArtifactId: art_doi_10_1371_journal_pone_0322416
  findingKind: mechanistic
  population: Healthy women after exercise-induced muscle damage
  exposure: Acute post-exercise CWI
  outcome: SmO2 and skin temperature
  summary: CWI reduced acute SmO2 and skin temperature measures, but those physiological changes did not translate into faster recovery in the reported endpoints.
  evidenceUse:
  - mechanism
  - context
coldPlungeExtraction:
  batchId: batch-009
  evidenceBucket: Sports recovery and training-adaptation boundary
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- DOI 10.1371/journal.pone.0322416
- 'No acceleration of recovery from exercise-induced muscle damage after cold or hot water immersion in women: A randomised controlled trial'
- No acceleration of recovery from exercise-induced muscle damage through acute cold-water immersion, whole body cryostimulation or local cryotherapy
- 10.1371/journal.pone.0322416
---

This source is included for **Sports recovery and training-adaptation boundary**.

**Findings:** The trial randomized 30 healthy women and found that neither CWI nor HWI improved subjective or objective recovery markers versus control over 72 hours.; CWI reduced acute SmO2 and skin temperature measures, but those physiological changes did not translate into faster recovery in the reported endpoints.

**Why it matters:** It preserves null evidence and helps avoid one-sided soreness/recovery claims.

**Potential experiment signals:** muscle oxygen saturation; skin temperature; maximal voluntary isometric contraction; swelling; soreness; creatine kinase; subjective recovery.

**Protocol takeaway:** Use as a does-not-confirm source for recovery claims; physiological cooling does not guarantee faster recovery.

**Claim use:** `context-only`.

**Population mismatch:** Healthy women after drop-jump muscle damage; not resting cold-plunge users or broad clinical populations.

**Limitations:** Healthy young women only.; Menstrual-cycle timing was not standardized in the accessible article limitations.; Exercise-induced muscle damage model rather than general wellness cold plunging.

**Artifact and rights note:** PDF rights status is `open_access`. This extraction creates a source-page draft and metadata/artifact candidate only; no copyrighted PDF is included in Git.
