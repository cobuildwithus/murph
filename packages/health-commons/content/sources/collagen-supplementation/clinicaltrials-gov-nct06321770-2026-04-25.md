---
schemaVersion: murph.commons.page.v1
entityType: source_artifact
key: source_artifact:clinicaltrials-gov-nct06321770-2026-04-25
slug: sources/collagen-supplementation/clinicaltrials-gov-nct06321770-2026-04-25
title: Oral Supplementation With Active Collagen Peptides and Skin Health
summary: Completed ClinicalTrials.gov registry for 2.5 g/day low-molecular-weight collagen peptides over 6 weeks; no registry results posted, but it maps endpoints and dose clearly.
status: draft
quality: usable
aliases:
- Oral Supplementation With Active Collagen Peptides and Skin Health
- NCT06321770
categories:
- collagen-supplementation
- skin-aging
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
    registryId: NCT06321770
    url: https://clinicaltrials.gov/study/NCT06321770
  canonicalUrl: https://clinicaltrials.gov/study/NCT06321770
  identityAliases:
  - Oral Supplementation With Active Collagen Peptides and Skin Health
  - NCT06321770
source:
  kind: web_page
  title: Oral Supplementation With Active Collagen Peptides and Skin Health
  authors: Gala Servicios Clinicos S.L.
  citation: ClinicalTrials.gov. NCT06321770. Oral Supplementation With Active Collagen Peptides and Skin Health Improvement. First posted 20 Mar 2024; last updated 11 Jul 2024.
  year: 2024
  journal: ClinicalTrials.gov
  url: https://clinicaltrials.gov/study/NCT06321770
researchEvidence:
  designKind: other
  designLabel: Completed randomized double-blind placebo-controlled single-center trial registry
  populationLabel: Healthy women aged 30-65 years with visible natural/photoaging signs and crow's-feet wrinkles.
  durationLabel: 6 weeks
  cohortKey: cohort:registry-direct-skin-aging
  participantCount: 80
  participantCountKind: approximate
  aggregateRole: primary
evidenceBucket: skin-aging
whyItMatters: It offers clear dose, comparator, and biometric endpoint definitions for a direct collagen-peptide skin trial.
potentialMurphEndpoints:
- 2.5 g/day
- wrinkle morphology
- Cutometer elasticity
- Corneometer hydration
- adverse events
protocolTakeaway: Use for registry context only until paired with the peer-reviewed results source.
murphTakeaway: Six-week tracking windows may be used in trials, but self-experiment outcomes still require a stable skincare routine and exposure logging.
studyDesign: rct
modality: oral low-molecular-weight hydrolyzed collagen peptides
claimUse: context-only
murphV1Priority: Medium
pdfRightsStatus: unknown
ledgerClassification:
  evidenceBucket: skin-aging
  directness: direct_protocol
  claimUse: context-only
  priority: medium
  batchId: batch-005
  needsArtifactManifestEntry: false
  artifactRightsStatusGuess: unknown
---

This source is included for **skin-aging**.

**Findings:** Direct collagen-peptide registry with clean 2.5 g/day placebo comparison, but no posted registry results. Endpoints captured: wrinkle volume; wrinkle area; wrinkle depth; R0 firmness; R2 gross elasticity; R5 net elasticity; R7 elastic recovery; R9 skin fatigue; skin hydration; satisfaction; adverse events.

**Why it matters:** It offers clear dose, comparator, and biometric endpoint definitions for a direct collagen-peptide skin trial.

**Potential experiment signals:** 2.5 g/day, wrinkle morphology, Cutometer elasticity, Corneometer hydration, adverse events.

**Protocol takeaway:** Use for registry context only until paired with the peer-reviewed results source.

**Claim use:** `context-only`.
