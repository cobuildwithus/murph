---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct05425407-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct05425407-2026-04-25
title: Effects of Collagen Peptide on Acute and Short-term Muscle and Connective Tissue Responses
summary: ClinicalTrials.gov registry record for an acute/short-term physiology trial of collagen peptide effects on muscle and connective tissue responses.
status: draft
quality: usable
aliases:
- clinicaltrials-gov-nct05425407-2026-04-25
- Effects of Collagen Peptide on Acute and Short-term Muscle and Connective Tissue Responses
- NCT05425407
categories:
- collagen-supplementation
- exercise-performance-recovery
- adjacent_variant
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
    registryId: NCT05425407
    url: https://clinicaltrials.gov/study/NCT05425407
  canonicalUrl: https://clinicaltrials.gov/study/NCT05425407
  identityAliases:
  - clinicaltrials-gov-nct05425407-2026-04-25
  - Effects of Collagen Peptide on Acute and Short-term Muscle and Connective Tissue Responses
  - NCT05425407
source:
  kind: web_page
  title: Effects of Collagen Peptide on Acute and Short-term Muscle and Connective Tissue Responses
  authors: ClinicalTrials.gov record; sponsor/investigators not extracted
  citation: ClinicalTrials.gov. Effects of Collagen Peptide on Acute and Short-term Muscle and Connective Tissue Responses. NCT05425407. Registry record accessed 2026-04-25.
  year: 2022
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT05425407
researchEvidence:
  designKind: acute_mechanistic
  designLabel: Trial registry record for acute physiology study
  populationLabel: Exercise participants; full eligibility not extracted
  durationLabel: Acute and short-term responses; exact duration not extracted
  cohortKey: clinicaltrials-gov-nct05425407-2026-04-25
  aggregateRole: primary
evidenceBucket: exercise-performance-recovery
whyItMatters: Unpublished/registry context for adjacent physiology evidence.
potentialMurphEndpoints:
- muscle response
- connective tissue response
- acute physiology
protocolTakeaway: Treat as adjacent registry context unless the final publication confirms an isolated HCP intervention.
murphTakeaway: Treat as adjacent registry context unless the final publication confirms an isolated HCP intervention. Preserve directness and comparator boundaries when synthesizing.
studyDesign: Trial registry record for acute physiology study
modality: Collagen peptide or collagen-plus-whey acute physiology registry
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: exercise-performance-recovery
  directness: adjacent_variant
  claimUse: context-only
  priority: medium
  batchId: batch-007
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **exercise-performance-recovery**.

**Findings:** Registry context only; no outcome results extracted.

**Why it matters:** Unpublished/registry context for adjacent physiology evidence.

**Potential experiment signals:** muscle response, connective tissue response, acute physiology.

**Protocol takeaway:** Treat as adjacent registry context unless the final publication confirms an isolated HCP intervention.

**Claim use:** `context-only`.

**Directness and boundary:** `adjacent_variant`. Dose, comparator, and isolated-collagen status require verification.

**Safety notes:** Registry source; adverse events/results not extracted here.

**Limitations:** Registry only.; Intervention may be a collagen-plus-whey mixture rather than isolated collagen.; Exact dose and comparator not verified.

**Population mismatch:** Adjacent physiology trial, not direct HCP-alone clinical outcome evidence.

**Artifact notes:** No redistributable PDF stored; keep metadata/manifest candidate only unless rights are clearly open.
