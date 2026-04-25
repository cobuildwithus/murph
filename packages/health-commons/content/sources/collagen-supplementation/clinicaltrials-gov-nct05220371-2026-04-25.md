---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05220371-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05220371-2026-04-25
title: Specific Collagen Peptides in Recovery After Exercise-Induced Muscle Damage
summary: ClinicalTrials.gov registry anchor for the specific-collagen-peptide exercise-induced muscle-damage recovery program with companion publications.
status: draft
quality: usable
aliases:
- clinicaltrials-gov-nct05220371-2026-04-25
- Specific Collagen Peptides in Recovery After Exercise-Induced Muscle Damage
- NCT05220371
categories:
- collagen-supplementation
- exercise-performance-recovery
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
    registryId: NCT05220371
    url: https://clinicaltrials.gov/study/NCT05220371
  canonicalUrl: https://clinicaltrials.gov/study/NCT05220371
  identityAliases:
  - clinicaltrials-gov-nct05220371-2026-04-25
  - Specific Collagen Peptides in Recovery After Exercise-Induced Muscle Damage
  - NCT05220371
source:
  kind: web_page
  title: Specific Collagen Peptides in Recovery After Exercise-Induced Muscle Damage
  authors: ClinicalTrials.gov record; sponsor/investigators not extracted
  citation: ClinicalTrials.gov. Specific Collagen Peptides in Recovery After Exercise-Induced Muscle Damage. NCT05220371. Registry record accessed 2026-04-25.
  year: 2022
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05220371
researchEvidence:
  designKind: other
  designLabel: Trial registry record for randomized recovery trial
  populationLabel: Sedentary or moderately active men in companion publications; full registry eligibility not extracted
  durationLabel: 12-week concurrent training and EIMD recovery assessments in companion publications
  cohortKey: clinicaltrials-gov-nct05220371-2026-04-25
  aggregateRole: primary
evidenceBucket: exercise-performance-recovery
whyItMatters: Registry anchor for multiple direct recovery publications.
potentialMurphEndpoints:
- EIMD recovery
- biomechanics
- MYO
- CK
- LDH
- body composition
protocolTakeaway: Use NCT05220371 to connect the companion recovery RCTs and prevent double-counting.
murphTakeaway: Use NCT05220371 to connect the companion recovery RCTs and prevent double-counting. Preserve directness and comparator boundaries when synthesizing.
studyDesign: Trial registry record for randomized recovery trial
modality: Specific collagen peptides with concurrent training/EIMD recovery protocol
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: exercise-performance-recovery
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-007
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **exercise-performance-recovery**.

**Findings:** Registry/context source; companion publications provide biomechanical and biomarker results.

**Why it matters:** Registry anchor for multiple direct recovery publications.

**Potential experiment signals:** EIMD recovery, biomechanics, MYO, CK, LDH, body composition.

**Protocol takeaway:** Use NCT05220371 to connect the companion recovery RCTs and prevent double-counting.

**Claim use:** `context-only`.

**Directness and boundary:** `direct_protocol`. Do not cite registry alone for results.

**Safety notes:** Registry source; adverse events/results not extracted here.

**Limitations:** Registry record, not peer-reviewed results.; Eligibility and outcomes should be reconciled with companion publications.; Not all registry details were accessible through parsed sources.

**Population mismatch:** Registry context only; use publications for population specifics.

**Artifact notes:** No redistributable PDF stored; keep metadata/manifest candidate only unless rights are clearly open.
