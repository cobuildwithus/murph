---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:doi-10.3389-fphys.2025.1679550
slug: sources/cold-water-immersion/doi-10.3389-fphys.2025.1679550
title: Cold-induced stress responses during a self-rescue exercise from accidental immersion in ice water in military personnel
summary: Field study of cold-induced stress responses during a military self-rescue exercise in ice water.
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
  title: Cold-induced stress responses during a self-rescue exercise from accidental immersion in ice water in military personnel
  authors: Yannick Beres; Raimund Lechner; Elias August; Andreas Koch; Peter Radermacher; Martin Kulla; Enrico Staps
  year: 2025
  journal: Frontiers in Physiology
  doi: 10.3389/fphys.2025.1679550
  url: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12678073/
  citation: Yannick Beres; Raimund Lechner; Elias August; Andreas Koch; Peter Radermacher; Martin Kulla; Enrico Staps. Cold-induced stress responses during a self-rescue exercise from accidental immersion in ice water in military personnel. Frontiers in Physiology. 2025. doi:10.3389/fphys.2025.1679550
sourceIdentity:
  identityKind: scholarly_work
  canonicalIdBasis: doi
  identifiers:
    pmcid: PMC12678073
    doi: 10.3389/fphys.2025.1679550
    titleHash: cccb2c1b710aca66fcb46a657950f2ff0b4d400588f701afc7519ad81f844261
    url: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12678073/
  canonicalUrl: https://doi.org/10.3389/fphys.2025.1679550
  identityAliases:
  - doi:10.3389/fphys.2025.1679550
  - PMC12678073
  - Yannick Beres 2025
  - Cold-induced stress responses during a self-rescue exercise from accidental immersion in ice water in military personnel
researchEvidence:
  designKind: prospective_cohort
  designLabel: Prospective observational field study during military ice-water self-rescue training
  populationLabel: Mostly young healthy German Armed Forces personnel in self-rescue training
  durationLabel: Thirty-second immersion in 0.5°C ice water followed by self-rescue and field monitoring
  cohortKey: cohort:doi-10.3389-fphys.2025.1679550
  participantCount: 80
  participantCountKind: reported
  aggregateRole: primary
  notes:
  - Generated source-index.json was absent from the supplied snapshot; resolved against canonical ledger and local candidate records only.
  - 'Canonical ledger note: Candidate shards: 04-discovery-acute-cardiovascular-autonomic; raw candidate rows merged: 1. Candidate IDs: candidate:acute-cardiovascular-autonomic:038. Generated source-index.json was absent from supplied snapshot; no existing cold-water source inventory was available, so this is a provisional new-source resolution pending generated-index check. Safety-only: use for screens, stop rules, contraindications, or adverse-event context, not benefit claims.'
  - 'Cold Plunge extraction context: bucket=Safety, adverse events, and cold-shock boundaries; directness=same_mechanism; claimUse=safety-only; priority=high'
sourceFindings:
- findingId: finding:doi-10.3389-fphys.2025.1679550:ice-water-stress-response
  sourceKey: source_artifact:doi-10.3389-fphys.2025.1679550
  extractedFromArtifactId: art_doi_10_3389_fphys_2025_1679550
  findingKind: mechanistic
  population: Mostly young healthy military personnel during supervised self-rescue training
  exposure: Thirty-second immersion in approximately 0.5°C ice water followed by self-rescue
  outcome: ECG/heart-rate stress response and observed acute safety
  summary: In this prospective field study, 80 training participants were exposed to a 30-second ice-water self-rescue exercise; analyzable physiological subsets were smaller. Heart rate rose acutely, and the authors reported no malignant arrhythmias, with participants hemodynamically stable and symptom-free. The selected military population and field artifacts limit generalization.
  evidenceUse:
  - mechanism
  - safety
- findingId: finding:doi-10.3389-fphys.2025.1679550:temperature-measurement-limit
  sourceKey: source_artifact:doi-10.3389-fphys.2025.1679550
  extractedFromArtifactId: art_doi_10_3389_fphys_2025_1679550
  findingKind: measurement_validation
  population: Military training participants with paired temperature measures
  exposure: Ice-water self-rescue exercise with tympanic and ingestible capsule temperature monitoring
  outcome: Temperature measurement validity after cold-water exposure
  summary: Tympanic temperature readings diverged from ingestible capsule measurements after ice-water immersion, supporting caution against relying on tympanic temperature alone as a post-immersion core-temperature proxy.
  evidenceUse:
  - measurement
  - safety
coldPlungeExtraction:
  batchId: batch-005
  evidenceBucket: Safety, adverse events, and cold-shock boundaries
  directness: same_mechanism
  claimUse: safety-only
  priority: high
  artifactRightsStatusGuess: open_access
  identityResolutionStatus: new_source
aliases:
- doi:10.3389/fphys.2025.1679550
- PMC12678073
- Yannick Beres 2025
- Cold-induced stress responses during a self-rescue exercise from accidental immersion in ice water in military personnel
- 10.3389/fphys.2025.1679550
---

This source is included for **Safety, adverse events, and cold-shock boundaries**.

**Findings:** In this prospective field study, 80 training participants were exposed to a 30-second ice-water self-rescue exercise; analyzable physiological subsets were smaller. Heart rate rose acutely, and the authors reported no malignant arrhythmias, with participants hemodynamically stable and symptom-free. The selected military population and field artifacts limit generalization.; Tympanic temperature readings diverged from ingestible capsule measurements after ice-water immersion, supporting caution against relying on tympanic temperature alone as a post-immersion core-temperature proxy.

**Why it matters:** This provides contemporary direct cold-stress physiology and measurement context for extreme ice-water exposure, while preserving the selected-population caveat.

**Potential experiment signals:** heart rate, ECG rhythm, respiratory response, core temperature measurement validity, symptoms during/after plunge.

**Protocol takeaway:** Use as safety/mechanistic and measurement evidence for acute extreme cold exposure; do not generalize the absence of malignant arrhythmias to all users.

**Claim use:** `safety-only`.

## Extraction notes

- Directness to Cold Plunge: `same_mechanism`.
- Population mismatch: Young military personnel in supervised self-rescue training differ from general home-plunge users and high-risk populations.
- Limitations: Healthy military selection bias and field training context.; No randomized or non-immersion control group.; Motion artifacts and incomplete sensor data reduced analyzable ECG and temperature datasets.; Extreme ice-water self-rescue is not a consumer wellness dose.
- Artifact rights: `open_access`. No copyrighted PDF is included in Git; this draft records metadata and candidate artifact information only.
