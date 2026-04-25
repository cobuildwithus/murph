---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06240429-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06240429-2026-04-25
title: Collagen Peptide Supplementation and Physical Exercise in Chronic Ankle Instability
summary: ClinicalTrials.gov registry for collagen peptide supplementation plus exercise in chronic ankle instability; extraction should be verified before final synthesis due to sparse registry details.
status: draft
quality: usable
aliases:
- Collagen Peptide Supplementation and Physical Exercise in Chronic Ankle Instability
- NCT06240429
categories:
- collagen-supplementation
- tendon-loading-ligament
- direct_protocol
- context-only
relations:
-
  type: related_protocol
  target: protocol_variant:collagen-supplementation/hydrolyzed-collagen-peptides
-
  type: parent_family
  target: experiment_family:collagen-supplementation
sourceIdentity:
  identityKind: trial_registry
  canonicalIdBasis: url
  identifiers:
    registryId: NCT06240429
    url: https://clinicaltrials.gov/study/NCT06240429
  canonicalUrl: https://clinicaltrials.gov/study/NCT06240429
  identityAliases:
  - Collagen Peptide Supplementation and Physical Exercise in Chronic Ankle Instability
  - NCT06240429
source:
  kind: web_page
  title: Collagen Peptide Supplementation and Physical Exercise in Chronic Ankle Instability
  authors: ClinicalTrials.gov
  citation: 'ClinicalTrials.gov. NCT06240429: Collagen Peptide Supplementation and Physical Exercise in Chronic Ankle Instability. First posted 5 Feb 2024.'
  year: 2024
  journal: ClinicalTrials.gov trial registry
  url: https://clinicaltrials.gov/study/NCT06240429
researchEvidence:
  designKind: randomized_controlled_trial
  designLabel: rct
  populationLabel: People with chronic ankle instability; exact age/count not extracted.
  durationLabel: Not available in extracted record
  cohortKey: clinicaltrials-gov-nct06240429-2026-04-25
  aggregateRole: context
evidenceBucket: tendon-loading-ligament
whyItMatters: It extends the ankle-instability evidence lineage beyond the 2018 athlete RCT.
potentialMurphEndpoints:
- CAIT or ankle stability measures
- functional ankle scores
- re-injury episodes
- pain with activity
protocolTakeaway: Keep this as context-only registry evidence, especially because ankle instability is not the same endpoint family as tendon pain.
murphTakeaway: Keep this as context-only registry evidence, especially because ankle instability is not the same endpoint family as tendon pain.
studyDesign: rct
modality: collagen_peptides_plus_physical_exercise_registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: tendon-loading-ligament
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-006
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **tendon-loading-ligament**.

**Findings:** Registry record only; no results extracted.

**Population and intervention:** Registry for collagen peptide supplementation and physical exercise in chronic ankle instability; extracted snippets did not provide a reliable sample count. Intervention/exposure: Collagen peptide supplementation plus physical exercise. Comparator/control: Control or comparator arm not fully extracted from available snippets. Duration/follow-up: Not available in extracted record.

**Endpoints:** Ankle stability, joint function, pain or re-injury outcomes expected from registry theme; exact endpoint list not fully extracted.

**Safety notes:** No adverse-event results extracted.

**Limitations:** Registry-only source.; Extracted snippets were sparse and showed some title/population ambiguity.; No outcomes or participant count extracted.

**Population mismatch:** Direct to ankle-instability protocol, but ligament/joint function rather than tendon-specific clinical outcomes.

**Why it matters:** It extends the ankle-instability evidence lineage beyond the 2018 athlete RCT.

**Potential experiment signals:** CAIT or ankle stability measures; functional ankle scores; re-injury episodes; pain with activity

**Protocol takeaway:** Keep this as context-only registry evidence, especially because ankle instability is not the same endpoint family as tendon pain.

**Claim use:** `context-only`. Directness: `direct_protocol`. Source key: `source_artifact:clinicaltrials-gov-nct06240429-2026-04-25`.
